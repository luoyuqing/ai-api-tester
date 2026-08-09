/**
 * EvaluationEngine — the orchestrator (architecture §3 / §6 T03).
 *
 * Per provider it: warms up the endpoint once (discarded), schedules every
 * supported probe through the Scheduler (lane-per-provider, cross-provider
 * parallel), collects ProbeResults, then aggregates them into a
 * DimensionScore[] + overall score. All progress reaches the UI as RunEvents;
 * this module never touches a store or React.
 */
import type {
  Dimension,
  EngineDeps,
  EngineHooks,
  EvaluationConfig,
  EvaluationHandle,
  EvaluationResult,
  LogLevel,
  LogTag,
  PlanUnit,
  ProbeResult,
  Provider,
  RunEvent,
} from '@/types';
// ProviderAdapter 是引擎内部契约，不属于跨层公共类型，因此从 adapters 直接取。
import type { ProviderAdapter } from '@/engine/adapters/ProviderAdapter';
import { defaultProbeRegistry } from '@/engine/ProbeRegistry';
import { AdapterFactory } from '@/engine/adapters/AdapterFactory';
import { createScorer } from '@/engine/scorers';
import { Scheduler } from '@/engine/Scheduler';
import { errorResult, type Probe, type ProbePlanInput, type ProbeRunContext } from '@/engine/probes/Probe';
import { collectCases, suiteVersionMap } from '@/data/testsets';
import { buildResult as buildEvaluationResult } from '@/engine/aggregate/aggregator';
import { dimensionToLogTag } from '@/constants/dimensions';
import { nextShortId } from '@/lib/id';
import { isCancellation } from '@/engine/errors';

export const ENGINE_VERSION = '1.0.0';

interface UnitMeta {
  provider: Provider;
  adapter: ProviderAdapter;
  probe: Probe;
  plan: ProbePlanInput;
}

function warmup(
  adapter: ProviderAdapter,
  config: EvaluationConfig,
  signal: AbortSignal,
  log: (level: LogLevel, message: string) => void,
): Promise<void> {
  return adapter
    .chat(
      { messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
      { timeoutMs: config.timeoutMs, signal, stream: false, maxRetries: 0 },
    )
    .then(() => log('info', '连通性预热完成（该请求不计入评测）'))
    .catch((err: unknown) =>
      log('warn', `预热请求失败（不阻断评测）：${err instanceof Error ? err.message : String(err)}`),
    );
}

export function runEvaluation(
  config: EvaluationConfig,
  deps: EngineDeps,
  hooks: EngineHooks = {},
): EvaluationHandle {
  const taskId = String(nextShortId());
  const startedAt = Date.now();

  const emit = (e: RunEvent): void => {
    try {
      hooks.onEvent?.(e);
    } catch {
      /* a broken listener must never crash the run */
    }
  };

  const log = (
    level: LogLevel,
    tag: LogTag,
    providerName: string,
    message: string,
  ): void => {
    emit({ type: 'log', level, tag, providerName, message, ts: Date.now() });
  };

  const scheduler = new Scheduler(config.concurrency, {
    onProgress: (done, total, providerId) =>
      emit({
        type: 'progress',
        done,
        total,
        percent: total > 0 ? Math.round((done / total) * 100) : 0,
        providerId,
      }),
    onPaused: () => emit({ type: 'task:paused', taskId }),
    onResumed: () => emit({ type: 'task:resumed', taskId }),
    onCancelled: () => emit({ type: 'task:cancelled', taskId }),
  });

  const factory = new AdapterFactory(deps.createTransport);
  const adapters = new Map<string, ProviderAdapter>();
  deps.providers.forEach((p) => adapters.set(p.id, factory.create(p, deps.secrets[p.id] ?? '')));

  // Optional judge adapter for llm-judge / hybrid scoring.
  let judgeAdapter: ProviderAdapter | undefined;
  if (config.scoring.mode !== 'rule' && config.scoring.judgeProviderId) {
    const judgeProvider = deps.providers.find((p) => p.id === config.scoring.judgeProviderId);
    if (judgeProvider) judgeAdapter = factory.create(judgeProvider, deps.secrets[judgeProvider.id] ?? '');
  }
  const scorer = createScorer(config, judgeAdapter);

  // ── plan: which probes actually run for each provider ──
  const unitMeta = new Map<string, UnitMeta>();
  const allUnits: PlanUnit[] = [];
  const providerPlans: { provider: Provider; adapter: ProviderAdapter; totalUnits: number }[] = [];

  for (const provider of deps.providers) {
    const adapter = adapters.get(provider.id);
    if (!adapter) continue;
    let totalUnits = 0;
    for (const dimension of config.dimensions as Dimension[]) {
      for (const probe of defaultProbeRegistry.resolve(dimension)) {
        const cases = collectCases(deps.suites, probe.caseKind);
        const plan: ProbePlanInput = {
          provider,
          config,
          cases,
          placeholders: deps.placeholders ?? {},
        };
        const verdict = probe.supports(plan);
        if (!verdict.supported) {
          emit({ type: 'probe:skip', providerId: provider.id, probeId: probe.id, reason: verdict.reason ?? '不适用' });
          continue;
        }
        const units = probe.estimateUnits(plan);
        totalUnits += units;
        const unitId = `${provider.id}:${probe.id}`;
        allUnits.push({ id: unitId, providerId: provider.id, probeId: probe.id, dimension, units });
        unitMeta.set(unitId, { provider, adapter, probe, plan });
      }
    }
    providerPlans.push({ provider, adapter, totalUnits });
  }

  const totalUnits = allUnits.reduce((sum, u) => sum + u.units, 0);
  scheduler.setTotal(totalUnits);

  const providerResults = new Map<string, ProbeResult[]>();
  deps.providers.forEach((p) => providerResults.set(p.id, []));

  const warmed = new Set<string>();

  const worker = async (unit: PlanUnit): Promise<void> => {
    const meta = unitMeta.get(unit.id);
    if (!meta) return;
    const { provider, adapter, probe, plan } = meta;

    if (!warmed.has(provider.id)) {
      warmed.add(provider.id);
      await warmup(adapter, config, scheduler.signal, (lvl, msg) =>
        log(lvl, 'SYS', provider.name, msg),
      );
    }

    emit({ type: 'probe:start', providerId: provider.id, probeId: probe.id });

    const ctx: ProbeRunContext = {
      provider,
      config,
      cases: plan.cases,
      placeholders: plan.placeholders,
      adapter,
      scorer,
      signal: scheduler.signal,
      gate: () => scheduler.gate(),
      checkpoint: () => scheduler.checkpoint(),
      tick: () => scheduler.tick(provider.id),
      log: (lvl, msg) => log(lvl, dimensionToLogTag(probe.dimension), provider.name, msg),
    };

    try {
      const result: ProbeResult = await probe.run(ctx);
      providerResults.get(provider.id)!.push(result);
      emit({ type: 'probe:done', providerId: provider.id, result });
    } catch (err) {
      if (isCancellation(err)) throw err; // abort the whole lane
      const failed = errorResult(probe, provider.id, err, Date.now());
      providerResults.get(provider.id)!.push(failed);
      emit({ type: 'probe:done', providerId: provider.id, result: failed });
    }
  };

  // Announce providers before submission so the UI can size per-provider bars.
  providerPlans.forEach((pl) =>
    emit({ type: 'provider:start', providerId: pl.provider.id, providerName: pl.provider.name, totalUnits: pl.totalUnits }),
  );
  emit({ type: 'task:start', taskId, totalUnits });

  const promise = (async (): Promise<EvaluationResult[]> => {
    try {
      await scheduler.submit(allUnits, worker);
    } catch (err) {
      if (!isCancellation(err)) {
        emit({ type: 'task:error', taskId, error: (err as Error).message });
      }
    }

    const results: EvaluationResult[] = [];
    for (const pl of providerPlans) {
      const probeResults = providerResults.get(pl.provider.id) ?? [];
      const result = buildEvaluationResult({
        taskId,
        providerId: pl.provider.id,
        providerName: pl.provider.name,
        model: pl.provider.model,
        probeResults,
        config,
        engineVersion: ENGINE_VERSION,
        suiteVersions: suiteVersionMap(deps.suites),
        startedAt,
        endedAt: Date.now(),
      });
      results.push(result);
      emit({ type: 'provider:done', providerId: pl.provider.id, result });
    }

    if (scheduler.isCancelled) {
      emit({ type: 'task:cancelled', taskId });
    } else {
      emit({ type: 'task:done', taskId, results });
    }
    return results;
  })();

  return {
    taskId,
    cancel: () => scheduler.cancel(),
    pause: () => scheduler.pause(),
    resume: () => scheduler.resume(),
    promise,
  };
}

export default runEvaluation;
