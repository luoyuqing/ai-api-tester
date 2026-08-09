import type {
  CallOptions,
  ChatInput,
  ChatOutcome,
  ConnectivityResult,
  HandshakeOutcome,
  ImageOutcome,
  MultimodalInput,
  Provider,
  ProtocolKind,
  Transport,
  TransportMode,
} from '@/types';
import type { AdapterDeps, HandshakeCallOptions, ProviderAdapter } from '@/engine/adapters/ProviderAdapter';
import { OpenAIChatAdapter } from '@/engine/adapters/OpenAIChatAdapter';
import { OpenAIImageAdapter } from '@/engine/adapters/OpenAIImageAdapter';
import { MultimodalAdapter } from '@/engine/adapters/MultimodalAdapter';
import { AgentHandshakeAdapter } from '@/engine/adapters/AgentHandshakeAdapter';

/**
 * Facade that exposes every capability of one provider behind a single object.
 *
 * The four concrete adapters share the same HTTP plumbing but differ in payload
 * shaping, so they are composed here instead of being forced into a single
 * inheritance chain. Capability gating is the probe's job (`Probe.supports`),
 * not the factory's — an endpoint that claims to be chat-only may still answer
 * an image request, and the report should show the measurement, not a guess.
 */
class CompositeAdapter implements ProviderAdapter {
  public readonly kind: ProtocolKind = 'openai-compatible';

  public readonly provider: Provider;

  private readonly chatAdapter: OpenAIChatAdapter;

  private readonly imageAdapter: OpenAIImageAdapter;

  private readonly multimodalAdapter: MultimodalAdapter;

  private readonly agentAdapter: AgentHandshakeAdapter;

  public constructor(deps: AdapterDeps) {
    this.provider = deps.provider;
    this.chatAdapter = new OpenAIChatAdapter(deps);
    this.imageAdapter = new OpenAIImageAdapter(deps);
    this.multimodalAdapter = new MultimodalAdapter(deps);
    this.agentAdapter = new AgentHandshakeAdapter(deps);
  }

  public chat(input: ChatInput, opt: CallOptions): Promise<ChatOutcome> {
    return this.chatAdapter.chat(input, opt);
  }

  public image(prompt: string, opt: CallOptions): Promise<ImageOutcome> {
    return this.imageAdapter.image(prompt, opt);
  }

  public multimodal(input: MultimodalInput, opt: CallOptions): Promise<ChatOutcome> {
    return this.multimodalAdapter.multimodal(input, opt);
  }

  public handshake(framework: string, opt: HandshakeCallOptions): Promise<HandshakeOutcome> {
    return this.agentAdapter.handshake(framework, opt);
  }

  public ping(opt: CallOptions): Promise<ConnectivityResult> {
    return this.chatAdapter.ping(opt);
  }
}

/**
 * Build an adapter for one provider.
 *
 * @param provider   target provider definition
 * @param secret     plaintext API key (memory only)
 * @param transport  transport matching `provider.transport`
 * @param resolveTransport optional factory enabling per-call transport override
 */
export function createAdapter(
  provider: Provider,
  secret: string,
  transport: Transport,
  resolveTransport?: (mode: TransportMode) => Transport,
): ProviderAdapter {
  if (provider.protocol !== 'openai-compatible') {
    // MVP ships a single protocol; `custom` is the documented extension point.
    throw new Error(
      `暂不支持的协议类型「${provider.protocol}」，当前版本仅实现 openai-compatible（可通过新增 Adapter 扩展）`,
    );
  }
  return new CompositeAdapter({ provider, secret, transport, resolveTransport });
}

/** Class form used by the engine, mirroring the architecture class diagram. */
export class AdapterFactory {
  private readonly transportFactory: (mode: TransportMode) => Transport;

  public constructor(transportFactory: (mode: TransportMode) => Transport) {
    this.transportFactory = transportFactory;
  }

  public create(provider: Provider, secret: string): ProviderAdapter {
    return createAdapter(
      provider,
      secret,
      this.transportFactory(provider.transport),
      this.transportFactory,
    );
  }
}

export default createAdapter;
