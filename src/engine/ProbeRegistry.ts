import type { CaseKind, Dimension } from '@/types';
import { DIMENSION_CASE_KINDS } from '@/constants/dimensions';
import type { Probe } from '@/engine/probes/Probe';
import { LatencyProbe } from '@/engine/probes/perf/LatencyProbe';
import { StabilityProbe } from '@/engine/probes/perf/StabilityProbe';
import { ContextWindowProbe } from '@/engine/probes/perf/ContextWindowProbe';
import { ChatQualityProbe } from '@/engine/probes/func/ChatQualityProbe';
import { ImageGenProbe } from '@/engine/probes/func/ImageGenProbe';
import { MultimodalProbe } from '@/engine/probes/func/MultimodalProbe';
import { AgentCompatProbe } from '@/engine/probes/func/AgentCompatProbe';
import { ModerationProbe } from '@/engine/probes/safe/ModerationProbe';
import { SensitiveWordProbe } from '@/engine/probes/safe/SensitiveWordProbe';
import { JailbreakProbe } from '@/engine/probes/safe/JailbreakProbe';

/**
 * Probe registry — the single place that knows which probe owns which case kind.
 *
 * Adding a sub-metric means: write the probe, register it here, add its meta to
 * `constants/dimensions.ts` and map it in `aggregate/aggregator.ts`. Nothing
 * else in the engine has to change.
 */
export class ProbeRegistry {
  private readonly byKind = new Map<CaseKind, Probe>();

  private readonly byId = new Map<string, Probe>();

  /** Register (or replace) the probe owning a case kind. */
  public register(probe: Probe): this {
    this.byKind.set(probe.caseKind, probe);
    this.byId.set(probe.id, probe);
    return this;
  }

  public get(kind: CaseKind): Probe | undefined {
    return this.byKind.get(kind);
  }

  public getById(probeId: string): Probe | undefined {
    return this.byId.get(probeId);
  }

  public all(): Probe[] {
    return Array.from(this.byKind.values());
  }

  /**
   * Probes belonging to a dimension, in the canonical display order defined by
   * `DIMENSION_CASE_KINDS`. Capability filtering is NOT done here — the engine
   * calls `probe.supports(plan)` so that an unsupported probe can be reported
   * as a skip with a reason instead of silently disappearing.
   */
  public resolve(dimension: Dimension): Probe[] {
    const kinds = DIMENSION_CASE_KINDS[dimension] ?? [];
    return kinds
      .map((kind) => this.byKind.get(kind))
      .filter((probe): probe is Probe => probe !== undefined);
  }
}

/** A registry pre-loaded with all eleven built-in probes. */
export function createDefaultRegistry(): ProbeRegistry {
  return new ProbeRegistry()
    .register(new LatencyProbe())
    .register(new StabilityProbe())
    .register(new ContextWindowProbe())
    .register(new ChatQualityProbe())
    .register(new ImageGenProbe())
    .register(new MultimodalProbe())
    .register(new AgentCompatProbe())
    .register(new ModerationProbe())
    .register(new SensitiveWordProbe())
    .register(new JailbreakProbe());
}

/** Shared instance used by `runEvaluation` — probes are stateless. */
export const defaultProbeRegistry: ProbeRegistry = createDefaultRegistry();

export default ProbeRegistry;
