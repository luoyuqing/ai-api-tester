import type { CaseExpectation, CaseKind, ErrorCategory, ScoringMode } from '@/types';

/** Everything a scorer needs to judge one case response. */
export interface ScoreInput {
  caseId: string;
  kind: CaseKind;
  /** The last user instruction (used as context by the LLM judge). */
  prompt: string;
  /** Model reply under evaluation. */
  response: string;
  expectation?: CaseExpectation;
  /** Rubric handed to the LLM judge; ignored by the rule scorer. */
  rubric?: string;
  /** Whether the underlying request succeeded. */
  ok: boolean;
  errorCategory: ErrorCategory;
  /** Propagated so a judge call can be cancelled with the task. */
  signal: AbortSignal;
  timeoutMs: number;
}

export interface ScoreOutput {
  /** 0-100. */
  score: number;
  /** Human-readable explanation lines shown in the report. */
  evidence: string[];
  /** Which mode actually produced the score (hybrid records both). */
  mode: ScoringMode;
}

/** Pluggable judging strategy (architecture §3.2). */
export interface Scorer {
  readonly mode: ScoringMode;
  score(input: ScoreInput): Promise<ScoreOutput>;
}

/** One atomic rule check with a fractional pass value. */
export interface RuleCheck {
  label: string;
  weight: number;
  /** 0 = failed, 1 = passed, values in between = partial credit. */
  value: number;
  detail?: string;
}

/** Aggregate checks into a 0-100 score. */
export function checksToScore(checks: readonly RuleCheck[]): number {
  const totalWeight = checks.reduce((acc, c) => acc + c.weight, 0);
  if (totalWeight <= 0) return 0;
  const gained = checks.reduce((acc, c) => acc + c.weight * c.value, 0);
  return Math.round((gained / totalWeight) * 1000) / 10;
}

/** Render checks as evidence lines: `✓ 必含「ClickHouse」`. */
export function checksToEvidence(checks: readonly RuleCheck[]): string[] {
  return checks.map((c) => {
    const mark = c.value >= 1 ? '✓' : c.value <= 0 ? '✗' : '△';
    const detail = c.detail ? ` — ${c.detail}` : '';
    return `${mark} ${c.label}${detail}`;
  });
}
