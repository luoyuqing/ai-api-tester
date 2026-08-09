import { z } from 'zod';
import type { CaseKind, PlaceholderDictionary, TestCase, TestSuite } from '@/types';
import { ALL_CASE_KINDS } from '@/types';
import perfDefault from './perf.default.json';
import chatDefault from './chat.default.json';
import imageDefault from './image.default.json';
import multimodalDefault from './multimodal.default.json';
import agentDefault from './agent.default.json';
import safeModeration from './safe.moderation.json';
import safeSensitive from './safe.sensitive.json';
import safeJailbreak from './safe.jailbreak.json';

/**
 * Seed test-set registry.
 * Every JSON file is validated with zod at module load, so a malformed suite
 * fails loudly during development instead of producing silent skips at runtime.
 */

const caseKindSchema = z.enum(ALL_CASE_KINDS as unknown as [CaseKind, ...CaseKind[]]);

const chatTurnSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const expectationSchema = z
  .object({
    mustInclude: z.array(z.string()).optional(),
    mustNotInclude: z.array(z.string()).optional(),
    regex: z.string().optional(),
    jsonSchema: z.record(z.unknown()).optional(),
    maxWords: z.number().positive().optional(),
    minWords: z.number().positive().optional(),
    language: z.string().optional(),
    mustBeJson: z.boolean().optional(),
  })
  .strict();

const attachmentSchema = z
  .object({
    modality: z.enum(['image', 'audio', 'video']),
    mimeType: z.string().min(1),
    dataUrl: z.string().startsWith('data:'),
  })
  .strict();

export const testCaseSchema = z
  .object({
    id: z.string().min(1),
    kind: caseKindSchema,
    title: z.string().min(1),
    turns: z.array(chatTurnSchema).optional(),
    prompt: z.string().optional(),
    attachment: attachmentSchema.optional(),
    agentFramework: z.string().optional(),
    expectation: expectationSchema.optional(),
    judgeRubric: z.string().optional(),
    weight: z.number().nonnegative().default(1),
    placeholders: z.array(z.string()).optional(),
    targetTokens: z.number().positive().optional(),
    note: z.string().optional(),
  })
  .strict();

export const testSuiteSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.array(caseKindSchema).min(1),
    builtin: z.boolean(),
    cases: z.array(testCaseSchema).min(1),
    version: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

/** Parse + validate one suite; throws with a readable path on failure. */
export function parseSuite(raw: unknown, sourceLabel: string): TestSuite {
  const result = testSuiteSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`用例集校验失败 [${sourceLabel}] → ${detail}`);
  }
  return result.data as TestSuite;
}

const RAW_SUITES: ReadonlyArray<{ raw: unknown; label: string }> = [
  { raw: perfDefault, label: 'perf.default.json' },
  { raw: chatDefault, label: 'chat.default.json' },
  { raw: imageDefault, label: 'image.default.json' },
  { raw: multimodalDefault, label: 'multimodal.default.json' },
  { raw: agentDefault, label: 'agent.default.json' },
  { raw: safeModeration, label: 'safe.moderation.json' },
  { raw: safeSensitive, label: 'safe.sensitive.json' },
  { raw: safeJailbreak, label: 'safe.jailbreak.json' },
];

/** All builtin suites, validated. */
export const BUILTIN_SUITES: readonly TestSuite[] = RAW_SUITES.map((s) => parseSuite(s.raw, s.label));

const SUITE_BY_ID = new Map<string, TestSuite>(BUILTIN_SUITES.map((s) => [s.id, s]));

export function getBuiltinSuite(id: string): TestSuite | undefined {
  return SUITE_BY_ID.get(id);
}

/** suiteId → version map, embedded in every EvaluationResult (§7.10). */
export function suiteVersionMap(suites: readonly TestSuite[]): Record<string, string> {
  const out: Record<string, string> = {};
  suites.forEach((s) => {
    out[s.id] = s.version;
  });
  return out;
}

/** Flatten the selected suites down to the cases of one kind. */
export function collectCases(suites: readonly TestSuite[], kind: CaseKind): TestCase[] {
  const out: TestCase[] = [];
  suites.forEach((suite) => {
    suite.cases.forEach((c) => {
      if (c.kind === kind) out.push(c);
    });
  });
  return out;
}

/** Every distinct placeholder token used by a set of cases. */
export function collectPlaceholders(cases: readonly TestCase[]): string[] {
  const set = new Set<string>();
  cases.forEach((c) => {
    (c.placeholders ?? []).forEach((p) => set.add(p));
    const scan = (text: string | undefined): void => {
      if (!text) return;
      const matches = text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g);
      for (const m of matches) set.add(m[1]);
    };
    scan(c.prompt);
    (c.turns ?? []).forEach((t) => scan(t.content));
  });
  return Array.from(set).sort();
}

/** True when every placeholder in the case has a value in the dictionary. */
export function isCaseResolvable(c: TestCase, dict: PlaceholderDictionary): boolean {
  const required = collectPlaceholders([c]);
  return required.every((p) => typeof dict[p] === 'string' && dict[p].length > 0);
}

/** Substitute `{{TOKEN}}` occurrences. Unknown tokens are left untouched. */
export function applyPlaceholders(text: string, dict: PlaceholderDictionary): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, token: string) =>
    typeof dict[token] === 'string' ? dict[token] : whole,
  );
}

/** Return a copy of the case with all placeholders resolved. */
export function resolveCase(c: TestCase, dict: PlaceholderDictionary): TestCase {
  if (!dict || Object.keys(dict).length === 0) return c;
  return {
    ...c,
    prompt: c.prompt ? applyPlaceholders(c.prompt, dict) : c.prompt,
    turns: c.turns?.map((t) => ({ ...t, content: applyPlaceholders(t.content, dict) })),
  };
}

/** Validate a user-supplied JSON blob before importing it as a custom suite. */
export function parseImportedSuite(json: unknown): TestSuite {
  const suite = parseSuite(json, '导入文件');
  return { ...suite, builtin: false };
}

/** Placeholder dictionary import: `{ "SENSITIVE_TERM_A": "…" }`. */
export const placeholderDictSchema = z.record(z.string().min(1));

export function parsePlaceholderDictionary(json: unknown): PlaceholderDictionary {
  const result = placeholderDictSchema.safeParse(json);
  if (!result.success) {
    throw new Error('词表格式错误：应为 { "PLACEHOLDER_NAME": "替换文本" } 形式的 JSON 对象');
  }
  return result.data;
}

export default BUILTIN_SUITES;
