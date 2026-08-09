import type {
  ChatInput,
  ChatOutcome,
  HandshakeLevel,
  HandshakeOutcome,
  ToolCallObserved,
  ToolDefinition,
} from '@/types';
import { truncateSnippet } from '@/lib/http';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import { OpenAIChatAdapter } from '@/engine/adapters/OpenAIChatAdapter';
import type { HandshakeCallOptions } from '@/engine/adapters/ProviderAdapter';

/** Tool catalogue shared by both handshake styles. */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市的实时天气。',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: '城市名称，例如「北京」' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: '温度单位' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '执行一次数学计算并返回结果。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '待计算的表达式，例如「128/1024」' },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_note',
      description: '把一段文本保存到用户的备忘录。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '待保存的内容' },
        },
        required: ['content'],
      },
    },
  },
];

/** Hermes-style system prompt: the tool list is injected as plain text. */
export function buildHermesSystemPrompt(tools: ToolDefinition[]): string {
  const spec = tools
    .map((t) => JSON.stringify({ name: t.function.name, description: t.function.description, parameters: t.function.parameters }))
    .join('\n');
  return [
    '你是一个可以调用工具的助手。可用工具如下（JSON Schema）：',
    '<tools>',
    spec,
    '</tools>',
    '当需要调用工具时，必须严格输出如下格式，且不要输出其它内容：',
    '<tool_call>{"name": "工具名", "arguments": {…}}</tool_call>',
  ].join('\n');
}

const TOOL_CALL_TAG = /<tool_call>([\s\S]*?)<\/tool_call>/i;
const LOOSE_TOOL_JSON = /\{[\s\S]*?"(?:name|function)"\s*:\s*"[^"]+"[\s\S]*?\}/;

const DEFAULT_PROMPTS: Record<string, string> = {
  workbuddy: '帮我查一下北京今天的天气，需要摄氏度。',
  hermes: '查询北京今天的天气，使用摄氏度。',
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * FUNC-04 adapter — WorkBuddy (OpenAI function-calling) / Hermes (tag style).
 *
 * The judgement is purely structural: did the model produce a well-formed tool
 * invocation for the declared schema? End-to-end task completion is explicitly
 * out of scope for the MVP (architecture §8.1 item 4).
 */
export class AgentHandshakeAdapter extends OpenAIChatAdapter {
  public async handshake(framework: string, opt: HandshakeCallOptions): Promise<HandshakeOutcome> {
    const normalized = framework.toLowerCase();
    const prompt = opt.prompt ?? DEFAULT_PROMPTS[normalized] ?? DEFAULT_PROMPTS.workbuddy;
    return normalized === 'hermes'
      ? this.hermesHandshake(prompt, opt)
      : this.functionCallingHandshake(prompt, opt, framework);
  }

  // ───────────────────────── function-calling style ─────────────────────────

  private async functionCallingHandshake(
    prompt: string,
    opt: HandshakeCallOptions,
    framework: string,
  ): Promise<HandshakeOutcome> {
    const input: ChatInput = {
      messages: [{ role: 'user', content: prompt }],
      tools: AGENT_TOOLS,
      toolChoice: 'auto',
      maxTokens: 256,
    };
    const outcome = await this.chat(input, { ...opt, stream: false });
    const evidence: string[] = [`[${framework}] prompt: ${truncateSnippet(prompt, 200)}`];

    if (!outcome.ok) {
      evidence.push(`请求失败：${outcome.errorMessage ?? '未知错误'}`);
      return this.toOutcome(framework, 'fail', '接口调用失败，无法完成握手', outcome, evidence);
    }

    const calls: ToolCallObserved[] = outcome.toolCalls ?? [];
    if (calls.length > 0) {
      evidence.push(`tool_calls: ${truncateSnippet(JSON.stringify(calls.map((c) => ({ name: c.name, args: c.argumentsRaw }))), 600)}`);
      const named = calls.filter((c) => c.name.trim().length > 0);
      const wellFormed = named.filter((c) => c.argumentsParsed !== null);
      if (wellFormed.length > 0 && this.isKnownTool(wellFormed[0].name)) {
        return this.toOutcome(
          framework,
          'pass',
          `返回结构化 tool_calls，函数名 ${wellFormed[0].name}，arguments 为合法 JSON`,
          outcome,
          evidence,
          calls,
        );
      }
      if (named.length > 0) {
        return this.toOutcome(
          framework,
          'partial',
          named[0].argumentsParsed === null
            ? `返回了 tool_calls，但 arguments 不是合法 JSON（${truncateSnippet(named[0].argumentsRaw, 120)}）`
            : `返回了 tool_calls，但函数名 ${named[0].name} 不在声明的工具清单内`,
          outcome,
          evidence,
          calls,
        );
      }
      return this.toOutcome(framework, 'partial', '返回了 tool_calls 结构但缺少函数名', outcome, evidence, calls);
    }

    // No structured tool_calls: check whether the model emitted one in plain text.
    const loose = LOOSE_TOOL_JSON.exec(outcome.text);
    evidence.push(`text: ${truncateSnippet(outcome.text, 600)}`);
    if (loose) {
      return this.toOutcome(
        framework,
        'partial',
        '未返回标准 tool_calls 字段，但正文中出现了疑似工具调用 JSON（协议兼容性不完整）',
        outcome,
        evidence,
      );
    }
    if (AGENT_TOOLS.some((t) => outcome.text.includes(t.function.name))) {
      return this.toOutcome(
        framework,
        'partial',
        '正文提到了工具名但没有产生任何结构化调用',
        outcome,
        evidence,
      );
    }
    return this.toOutcome(framework, 'fail', '未产生任何工具调用，判定为不支持 function-calling 握手', outcome, evidence);
  }

  // ───────────────────────── Hermes tag style ─────────────────────────

  private async hermesHandshake(prompt: string, opt: HandshakeCallOptions): Promise<HandshakeOutcome> {
    const input: ChatInput = {
      messages: [
        { role: 'system', content: buildHermesSystemPrompt(AGENT_TOOLS) },
        { role: 'user', content: prompt },
      ],
      maxTokens: 300,
    };
    const outcome = await this.chat(input, { ...opt, stream: false });
    const evidence: string[] = [`[hermes] prompt: ${truncateSnippet(prompt, 200)}`];

    if (!outcome.ok) {
      evidence.push(`请求失败：${outcome.errorMessage ?? '未知错误'}`);
      return this.toOutcome('hermes', 'fail', '接口调用失败，无法完成握手', outcome, evidence);
    }

    evidence.push(`text: ${truncateSnippet(outcome.text, 600)}`);
    const tagged = TOOL_CALL_TAG.exec(outcome.text);
    if (tagged) {
      const parsed = parseJsonObject(tagged[1]);
      if (parsed && typeof parsed.name === 'string' && parsed.name.length > 0) {
        const observed: ToolCallObserved[] = [
          {
            name: parsed.name,
            argumentsRaw: JSON.stringify(parsed.arguments ?? {}),
            argumentsParsed:
              parsed.arguments && typeof parsed.arguments === 'object'
                ? (parsed.arguments as Record<string, unknown>)
                : null,
          },
        ];
        return this.toOutcome(
          'hermes',
          'pass',
          `输出了合法的 <tool_call> 标签，工具名 ${parsed.name}`,
          outcome,
          evidence,
          observed,
        );
      }
      return this.toOutcome(
        'hermes',
        'partial',
        '输出了 <tool_call> 标签但内部 JSON 不合法或缺少 name 字段',
        outcome,
        evidence,
      );
    }

    if (LOOSE_TOOL_JSON.test(outcome.text)) {
      return this.toOutcome(
        'hermes',
        'partial',
        '未使用 <tool_call> 标签，但输出了疑似工具调用 JSON',
        outcome,
        evidence,
      );
    }
    return this.toOutcome('hermes', 'fail', '未按 Hermes 约定输出工具调用标签', outcome, evidence);
  }

  private isKnownTool(name: string): boolean {
    return AGENT_TOOLS.some((t) => t.function.name === name);
  }

  private toOutcome(
    framework: string,
    level: HandshakeLevel,
    reason: string,
    outcome: ChatOutcome,
    evidence: string[],
    toolCalls?: ToolCallObserved[],
  ): HandshakeOutcome {
    return {
      ok: outcome.ok,
      framework,
      level,
      reason,
      e2eMs: outcome.e2eMs,
      errorCategory: outcome.ok ? ERROR_CATEGORY.NONE : outcome.errorCategory,
      retried: outcome.retried,
      evidence,
      toolCalls,
    };
  }
}

export default AgentHandshakeAdapter;
