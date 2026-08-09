/** Test case / suite domain types. */

export type CaseKind =
  | 'perf.latency'
  | 'perf.stability'
  | 'perf.context'
  | 'func.chat'
  | 'func.image'
  | 'func.multimodal'
  | 'func.agent'
  | 'safe.moderation'
  | 'safe.sensitive'
  | 'safe.jailbreak';

export const ALL_CASE_KINDS: readonly CaseKind[] = [
  'perf.latency',
  'perf.stability',
  'perf.context',
  'func.chat',
  'func.image',
  'func.multimodal',
  'func.agent',
  'safe.moderation',
  'safe.sensitive',
  'safe.jailbreak',
] as const;

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface CaseExpectation {
  /** All of these substrings must appear (case-insensitive). */
  mustInclude?: string[];
  /** None of these substrings may appear (case-insensitive). */
  mustNotInclude?: string[];
  /** JS regex source, applied case-insensitively. */
  regex?: string;
  /** Minimal JSON-schema subset used by RuleScorer (type/required/properties). */
  jsonSchema?: Record<string, unknown>;
  maxWords?: number;
  minWords?: number;
  /** Expected reply language: 'zh' | 'en'. */
  language?: string;
  /** Reply must be parseable JSON. */
  mustBeJson?: boolean;
}

export interface CaseAttachment {
  modality: 'image' | 'audio' | 'video';
  mimeType: string;
  /** Inline data: URL (kept tiny to avoid repo bloat). */
  dataUrl: string;
}

export interface TestCase {
  id: string;
  kind: CaseKind;
  title: string;
  /** Multi-turn conversation payload. */
  turns?: ChatTurn[];
  /** Single-turn / image prompt. */
  prompt?: string;
  attachment?: CaseAttachment;
  agentFramework?: 'workbuddy' | 'hermes' | string;
  expectation?: CaseExpectation;
  /** Rubric handed to the LLM judge. */
  judgeRubric?: string;
  /** Weight inside its sub-metric. Default 1. */
  weight: number;
  /** Placeholder tokens that require a locally imported word list (compliance). */
  placeholders?: string[];
  /** Ladder token size for perf.context cases. */
  targetTokens?: number;
  /** Free-form notes rendered in the case picker. */
  note?: string;
}

export interface TestSuite {
  id: string;
  name: string;
  kind: CaseKind[];
  builtin: boolean;
  cases: TestCase[];
  /** Bumped whenever the case content changes — recorded in every result. */
  version: string;
  description?: string;
}

/** Locally imported placeholder → real term mapping (never persisted to disk by default). */
export type PlaceholderDictionary = Record<string, string>;
