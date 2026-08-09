import type { ScoringMode } from '@/types';
import { round1 } from '@/constants/scoring';
import type { ScoreInput, ScoreOutput, Scorer } from '@/engine/scorers/Scorer';

/**
 * Hybrid scorer: deterministic checks anchor the score, the judge supplies the
 * qualitative half. Rule checks are objective but shallow; the judge is deep
 * but noisy, so the judge gets the larger share while the rules keep an
 * obviously broken answer from being talked up.
 */
export const RULE_SHARE = 0.4;
export const JUDGE_SHARE = 0.6;

export class CompositeScorer implements Scorer {
  public readonly mode: ScoringMode = 'hybrid';

  private readonly ruleScorer: Scorer;

  private readonly judgeScorer: Scorer;

  public constructor(deps: { rule: Scorer; judge: Scorer }) {
    this.ruleScorer = deps.rule;
    this.judgeScorer = deps.judge;
  }

  public async score(input: ScoreInput): Promise<ScoreOutput> {
    const [rule, judge] = await Promise.all([
      this.ruleScorer.score(input),
      this.judgeScorer.score(input),
    ]);

    // The judge degrades to the rule scorer on failure; blending a rule score
    // with itself would be meaningless, so detect it and report rule-only.
    if (judge.mode !== 'llm-judge') {
      return {
        score: rule.score,
        evidence: ['⚠ 裁判模型不可用，混合判分退化为规则判分', ...rule.evidence, ...judge.evidence],
        mode: rule.mode,
      };
    }

    const blended = round1(rule.score * RULE_SHARE + judge.score * JUDGE_SHARE);
    return {
      score: blended,
      evidence: [
        `混合判分 ${blended}（规则 ${round1(rule.score)} × ${RULE_SHARE} + 裁判 ${round1(judge.score)} × ${JUDGE_SHARE}）`,
        ...rule.evidence,
        ...judge.evidence,
      ],
      mode: this.mode,
    };
  }
}

export default CompositeScorer;
