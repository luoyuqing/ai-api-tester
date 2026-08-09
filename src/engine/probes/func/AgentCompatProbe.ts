import type {
  CaseKind,
  Dimension,
  HandshakeLevel,
  HandshakeOutcome,
  ProbeResult,
  RequestSample,
  TestCase,
} from '@/types';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import { AGENT_LEVEL_LABELS, AGENT_LEVEL_SCORE, round1 } from '@/constants/scoring';
import { isCancellation } from '@/engine/errors';
import {
  BaseProbe,
  categoryMetrics,
  type ProbePlanContext,
  type ProbeRunContext,
} from '@/engine/probes/Probe';

export const AGENT_METRIC_KEYS = {
  FRAMEWORKS: 'frameworkCount',
  CASES: 'caseCount',
  SCORE: 'weightedScore',
} as const;

const DEFAULT_FRAMEWORK = 'workbuddy';

interface FrameworkTally {
  framework: string;
  weightSum: number;
  scoreSum: number;
  levels: HandshakeLevel[];
}

/**
 * FUNC-04 — Agent framework handshake compatibility.
 *
 * PASS=100 / PARTIAL=60 / FAIL=0，先在框架内按用例权重求均值，再对各框架取
 * **等权均值**（§7.4「各框架均值」），这样一个框架多写几个用例不会稀释另一个。
 *
 * The judgement itself lives in `AgentHandshakeAdapter`; this probe only drives
 * the cases, tallies the levels and produces evidence.
 */
export class AgentCompatProbe extends BaseProbe {
  public readonly id = 'probe.func.agent';

  public readonly caseKind: CaseKind = 'func.agent';

  public readonly dimension: Dimension = 'functionality';

  public estimateUnits(plan: ProbePlanContext): number {
    return plan.cases.length;
  }

  public async run(ctx: ProbeRunContext): Promise<ProbeResult> {
    const startedAt = Date.now();
    const cases = ctx.cases;
    if (cases.length === 0) {
      return this.skipped(ctx, startedAt, '所选用例集中没有 func.agent 用例');
    }
    if (!ctx.adapter.handshake) {
      return this.skipped(ctx, startedAt, '当前协议适配器未实现 Agent 握手，记为 N/A');
    }

    const samples: RequestSample[] = [];
    const evidence: string[] = [];
    const tallies = new Map<string, FrameworkTally>();
    const metrics: Record<string, number | string | boolean | null> = {};
    let executed = 0;

    for (const testCase of cases) {
      await ctx.gate();
      const framework = (testCase.agentFramework ?? DEFAULT_FRAMEWORK).toLowerCase();
      const weight = testCase.weight > 0 ? testCase.weight : 1;
      try {
        const outcome = await ctx.adapter.handshake(framework, {
          ...this.callOptions(ctx, { stream: false }),
          prompt: testCase.prompt,
          caseId: testCase.id,
        });
        samples.push(this.handshakeSample(outcome));
        executed += 1;
        this.tally(tallies, framework, weight, outcome.level);
        metrics[`case.${testCase.id}.level`] = AGENT_LEVEL_LABELS[outcome.level];
        metrics[`case.${testCase.id}.score`] = AGENT_LEVEL_SCORE[outcome.level];

        evidence.push(`【${testCase.title}】${AGENT_LEVEL_LABELS[outcome.level]} — ${outcome.reason}`);
        outcome.evidence.slice(0, 3).forEach((line) => evidence.push(`  ${this.snippet(line, 400)}`));
        ctx.log(
          outcome.level === 'pass' ? 'info' : outcome.level === 'partial' ? 'warn' : 'error',
          `${testCase.title}（${framework}）握手结果 ${AGENT_LEVEL_LABELS[outcome.level]}`,
        );
      } catch (err) {
        if (isCancellation(err)) throw err;
        samples.push({
          ok: false,
          ttftMs: null,
          e2eMs: 0,
          errorCategory: ERROR_CATEGORY.UNKNOWN,
          retried: 0,
          rawSnippet: (err as Error).message,
        });
        executed += 1;
        this.tally(tallies, framework, weight, 'fail');
        metrics[`case.${testCase.id}.level`] = AGENT_LEVEL_LABELS.fail;
        metrics[`case.${testCase.id}.score`] = 0;
        evidence.push(`【${testCase.title}】执行异常：${(err as Error).message}，按 FAIL 计`);
        ctx.log('error', `${testCase.title} 握手异常：${(err as Error).message}`);
      } finally {
        ctx.tick();
      }
    }

    if (executed === 0 || tallies.size === 0) {
      return this.compose(ctx, startedAt, {
        status: 'error',
        samples,
        metrics: { [AGENT_METRIC_KEYS.CASES]: cases.length, ...categoryMetrics(samples) },
        evidence,
        errorMessage: '未能完成任何 Agent 握手用例',
      });
    }

    const frameworkScores: number[] = [];
    tallies.forEach((tally) => {
      const score = tally.weightSum > 0 ? tally.scoreSum / tally.weightSum : 0;
      frameworkScores.push(score);
      metrics[`framework.${tally.framework}.score`] = round1(score);
      metrics[`framework.${tally.framework}.levels`] = tally.levels
        .map((l) => AGENT_LEVEL_LABELS[l])
        .join('/');
      evidence.push(
        `框架 ${tally.framework}：${tally.levels.map((l) => AGENT_LEVEL_LABELS[l]).join(' / ')} → ${round1(score)} 分`,
      );
    });

    const rawScore = round1(frameworkScores.reduce((a, b) => a + b, 0) / frameworkScores.length);
    metrics[AGENT_METRIC_KEYS.FRAMEWORKS] = tallies.size;
    metrics[AGENT_METRIC_KEYS.CASES] = cases.length;
    metrics[AGENT_METRIC_KEYS.SCORE] = rawScore;
    Object.assign(metrics, categoryMetrics(samples));
    evidence.push(`${tallies.size} 个框架等权平均 = ${rawScore}`);

    return this.compose(ctx, startedAt, {
      status: rawScore > 0 ? 'pass' : 'fail',
      samples,
      metrics,
      rawScore,
      scoringMode: 'rule',
      evidence,
    });
  }

  private tally(
    tallies: Map<string, FrameworkTally>,
    framework: string,
    weight: number,
    level: HandshakeLevel,
  ): void {
    const existing = tallies.get(framework) ?? {
      framework,
      weightSum: 0,
      scoreSum: 0,
      levels: [] as HandshakeLevel[],
    };
    existing.weightSum += weight;
    existing.scoreSum += weight * AGENT_LEVEL_SCORE[level];
    existing.levels.push(level);
    tallies.set(framework, existing);
  }

  private handshakeSample(outcome: HandshakeOutcome): RequestSample {
    return {
      ok: outcome.ok,
      ttftMs: null,
      e2eMs: Math.round(outcome.e2eMs * 10) / 10,
      errorCategory: outcome.errorCategory,
      retried: outcome.retried,
      rawSnippet: outcome.reason,
    };
  }
}

/** Exported for tests / future framework additions driven by agent.default.json. */
export function frameworksOf(cases: readonly TestCase[]): string[] {
  const set = new Set<string>();
  cases.forEach((c) => set.add((c.agentFramework ?? DEFAULT_FRAMEWORK).toLowerCase()));
  return Array.from(set).sort();
}

export default AgentCompatProbe;
