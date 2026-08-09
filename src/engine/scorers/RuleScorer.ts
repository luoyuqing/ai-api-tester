import type { CaseExpectation, ScoringMode } from '@/types';
import { truncateSnippet } from '@/lib/http';
import {
  checksToEvidence,
  checksToScore,
  type RuleCheck,
  type ScoreInput,
  type ScoreOutput,
  type Scorer,
} from '@/engine/scorers/Scorer';
import {
  countWords,
  detectLanguage,
  isStrictJson,
  parseJsonLoose,
  validateJsonSchemaSubset,
} from '@/engine/scorers/classify';

/** Weight of each expectation family inside the rule score. */
const CHECK_WEIGHTS = {
  MUST_INCLUDE: 1,
  MUST_NOT_INCLUDE: 1,
  REGEX: 1.5,
  MUST_BE_JSON: 1.5,
  JSON_SCHEMA: 2,
  WORD_LIMIT: 1,
  LANGUAGE: 1,
  NON_EMPTY: 1,
} as const;

/** Partial credit given when a JSON object is only reachable after unwrapping a code fence. */
const FENCED_JSON_CREDIT = 0.6;

/**
 * Deterministic, offline judging (architecture §8.1 item 3 — the default mode).
 *
 * Every expectation family contributes one or more weighted checks; the final
 * score is the weighted pass ratio. The check list doubles as the evidence
 * shown in the report, so a reviewer can always see *why* a case lost points.
 */
export class RuleScorer implements Scorer {
  public readonly mode: ScoringMode = 'rule';

  public async score(input: ScoreInput): Promise<ScoreOutput> {
    // `score()` is async by contract (the LLM judge needs it) but the rule
    // engine is fully synchronous — no await required.
    const checks = buildRuleChecks(input);
    if (checks.length === 0) {
      return {
        score: input.ok ? 100 : 0,
        evidence: [input.ok ? '✓ 无显式期望，仅校验请求成功' : '✗ 请求失败'],
        mode: this.mode,
      };
    }
    return {
      score: checksToScore(checks),
      evidence: checksToEvidence(checks),
      mode: this.mode,
    };
  }
}

/** Build the full check list for one response (exported for the hybrid scorer). */
export function buildRuleChecks(input: ScoreInput): RuleCheck[] {
  if (!input.ok) {
    return [
      {
        label: '请求成功',
        weight: 1,
        value: 0,
        detail: `失败分类 ${input.errorCategory}${input.response ? `：${truncateSnippet(input.response, 160)}` : ''}`,
      },
    ];
  }

  const text = input.response ?? '';
  const expectation: CaseExpectation = input.expectation ?? {};
  const checks: RuleCheck[] = [];

  (expectation.mustInclude ?? []).forEach((term) => {
    const hit = text.toLowerCase().includes(term.toLowerCase());
    checks.push({
      label: `必含「${term}」`,
      weight: CHECK_WEIGHTS.MUST_INCLUDE,
      value: hit ? 1 : 0,
      detail: hit ? undefined : '响应中未找到该内容',
    });
  });

  (expectation.mustNotInclude ?? []).forEach((term) => {
    const hit = text.toLowerCase().includes(term.toLowerCase());
    checks.push({
      label: `禁含「${term}」`,
      weight: CHECK_WEIGHTS.MUST_NOT_INCLUDE,
      value: hit ? 0 : 1,
      detail: hit ? '响应中出现了被禁止的内容' : undefined,
    });
  });

  if (expectation.regex) {
    const { matched, error } = testRegex(expectation.regex, text);
    checks.push({
      label: `匹配正则 /${truncateSnippet(expectation.regex, 60)}/i`,
      weight: CHECK_WEIGHTS.REGEX,
      value: matched ? 1 : 0,
      detail: error ?? (matched ? undefined : '响应未命中期望的格式'),
    });
  }

  if (expectation.mustBeJson) {
    const strict = isStrictJson(text);
    const loose = strict ? true : parseJsonLoose(text) !== undefined;
    checks.push({
      label: '输出为可解析 JSON',
      weight: CHECK_WEIGHTS.MUST_BE_JSON,
      value: strict ? 1 : loose ? FENCED_JSON_CREDIT : 0,
      detail: strict
        ? undefined
        : loose
          ? '需要剥离代码块/前后缀才能解析，扣部分分'
          : '响应无法解析为 JSON',
    });
  }

  if (expectation.jsonSchema) {
    const value = parseJsonLoose(text);
    if (value === undefined) {
      checks.push({
        label: 'JSON Schema 校验',
        weight: CHECK_WEIGHTS.JSON_SCHEMA,
        value: 0,
        detail: '响应中没有可解析的 JSON，无法校验 schema',
      });
    } else {
      const errors = validateJsonSchemaSubset(value, expectation.jsonSchema);
      checks.push({
        label: 'JSON Schema 校验',
        weight: CHECK_WEIGHTS.JSON_SCHEMA,
        value: errors.length === 0 ? 1 : 0,
        detail: errors.length === 0 ? undefined : errors.slice(0, 3).join('；'),
      });
    }
  }

  const words = countWords(text);

  if (typeof expectation.maxWords === 'number') {
    const limit = expectation.maxWords;
    // 20% overshoot keeps partial credit — matches the built-in rubrics.
    const value = words <= limit ? 1 : words <= limit * 1.2 ? 0.5 : 0;
    checks.push({
      label: `不超过 ${limit} 字/词`,
      weight: CHECK_WEIGHTS.WORD_LIMIT,
      value,
      detail: `实际 ${words}`,
    });
  }

  if (typeof expectation.minWords === 'number') {
    const limit = expectation.minWords;
    checks.push({
      label: `不少于 ${limit} 字/词`,
      weight: CHECK_WEIGHTS.WORD_LIMIT,
      value: words >= limit ? 1 : words >= limit * 0.6 ? 0.5 : 0,
      detail: `实际 ${words}`,
    });
  }

  if (expectation.language) {
    const detected = detectLanguage(text);
    const expected = expectation.language.toLowerCase();
    const value = detected === expected ? 1 : detected === 'other' ? 0.5 : 0;
    checks.push({
      label: `语言为 ${expected}`,
      weight: CHECK_WEIGHTS.LANGUAGE,
      value,
      detail: `检测到 ${detected === 'other' ? '中英混杂/无法判定' : detected}`,
    });
  }

  if (checks.length === 0) {
    checks.push({
      label: '响应非空',
      weight: CHECK_WEIGHTS.NON_EMPTY,
      value: text.trim().length > 0 ? 1 : 0,
      detail: text.trim().length > 0 ? undefined : '模型返回了空内容',
    });
  }

  return checks;
}

/** Compile + run a case-insensitive regex, never throwing on a bad pattern. */
function testRegex(source: string, text: string): { matched: boolean; error?: string } {
  try {
    return { matched: new RegExp(source, 'i').test(text) };
  } catch (err) {
    return { matched: false, error: `正则表达式非法：${(err as Error).message}` };
  }
}

export default RuleScorer;
