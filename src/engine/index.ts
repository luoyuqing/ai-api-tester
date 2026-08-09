/**
 * Engine public surface. The UI layer imports `runEvaluation` (and the engine
 * types) exclusively from here; nothing else in `src/engine` is part of the
 * contract, so the internals can evolve without touching the stores.
 */
export { runEvaluation, ENGINE_VERSION } from './EvaluationEngine';
export { default } from './EvaluationEngine';

export {
  default as ProbeRegistry,
  createDefaultRegistry,
  defaultProbeRegistry,
} from './ProbeRegistry';

export { aggregate, buildResult } from './aggregate/aggregator';
export { buildMetricRecords, buildDimensionRecords } from './aggregate/normalize';

export type {
  EvaluationConfig,
  EvaluationHandle,
  EvaluationResult,
  EngineDeps,
  EngineHooks,
  PlanUnit,
  RunEvent,
  Dimension,
} from '@/types';
