import type { EvaluationConfig } from '@/types';
import type { ProviderAdapter } from '@/engine/adapters/ProviderAdapter';
import type { Scorer } from '@/engine/scorers/Scorer';
import { RuleScorer } from '@/engine/scorers/RuleScorer';
import { LlmJudgeScorer } from '@/engine/scorers/LlmJudgeScorer';
import { CompositeScorer } from '@/engine/scorers/CompositeScorer';

export type { Scorer, ScoreInput, ScoreOutput, RuleCheck } from '@/engine/scorers/Scorer';
export { checksToScore, checksToEvidence } from '@/engine/scorers/Scorer';
export { RuleScorer } from '@/engine/scorers/RuleScorer';
export { LlmJudgeScorer, type LlmJudgeDeps } from '@/engine/scorers/LlmJudgeScorer';
export { CompositeScorer } from '@/engine/scorers/CompositeScorer';

/**
 * Build the scorer for one evaluation run.
 *
 *  - `rule`      → deterministic, offline, free (default)
 *  - `llm-judge` → the judge provider is driven through the same adapter stack
 *  - `hybrid`    → CompositeScorer blends rule + judge
 *
 * When `llm-judge` / `hybrid` is requested but no judge adapter could be built
 * (judge provider missing, key missing, or the judge is the model under test),
 * the factory silently degrades to the rule scorer. A fabricated judge score
 * would be worse than an honest deterministic one (architecture §7.4).
 */
export function createScorer(config: EvaluationConfig, judgeAdapter?: ProviderAdapter): Scorer {
  const rule = new RuleScorer();
  const mode = config.scoring.mode;

  if (mode === 'rule' || !judgeAdapter) return rule;

  const judge = new LlmJudgeScorer({ adapter: judgeAdapter, fallback: rule });
  if (mode === 'hybrid') return new CompositeScorer({ rule, judge });
  return judge;
}

export default createScorer;
