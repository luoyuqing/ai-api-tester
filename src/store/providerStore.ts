import { create } from 'zustand';
import type { ConnectivityResult, Provider, ProviderDraft } from '@/types';
import { repository } from '@/lib/storage';
import { uuid, secretRefFor } from '@/lib/id';
import { logger } from '@/lib/logger';
import { createTransport, looksLikeCors } from '@/lib/http';
import { PING_TIMEOUT_MS } from '@/constants/defaults';
import { createAdapter } from '@/engine/adapters/AdapterFactory';

interface ProviderState {
  providers: Provider[];
  loading: boolean;
  /** providerId → last connectivity probe result. */
  connectivity: Record<string, ConnectivityResult>;
  selectedId: string | null;

  load(): Promise<void>;
  upsert(draft: ProviderDraft, plainKey?: string): Promise<Provider>;
  remove(id: string): Promise<void>;
  select(id: string | null): void;
  getById(id: string): Provider | undefined;
  /** Decrypted key — only ever held in memory by the caller. */
  getSecret(providerId: string): Promise<string>;
  /** Decrypted keys for a set of providers, keyed by providerId. */
  collectSecrets(providerIds: string[]): Promise<Record<string, string>>;
  hasSecret(providerId: string): boolean;
  testConnectivity(draft: ProviderDraft, plainKey?: string): Promise<ConnectivityResult>;
}

/**
 * Provider CRUD. Persistence is delegated to LocalRepository so the on-disk
 * layout matches architecture §7.6 exactly (`aiat:providers:v1` = Provider[]).
 * API keys never enter this store — only `secretRef` does.
 */
export const useProviderStore = create<ProviderState>()((set, get) => ({
  providers: [],
  loading: false,
  connectivity: {},
  selectedId: null,

  load: async () => {
    set({ loading: true });
    try {
      await repository.init();
      const providers = await repository.listProviders();
      set({ providers, loading: false });
    } catch (err) {
      logger.error('SYS', `加载 Provider 失败：${(err as Error).message}`);
      set({ loading: false });
    }
  },

  upsert: async (draft, plainKey) => {
    const nowTs = Date.now();
    const existing = draft.id ? get().providers.find((p) => p.id === draft.id) : undefined;
    const id = draft.id ?? uuid();
    const provider: Provider = {
      ...draft,
      id,
      secretRef: existing?.secretRef ?? draft.secretRef ?? secretRefFor(id),
      createdAt: existing?.createdAt ?? nowTs,
      updatedAt: nowTs,
    };
    await repository.saveProvider(provider, plainKey);
    const list = [...get().providers];
    const index = list.findIndex((p) => p.id === provider.id);
    if (index >= 0) list[index] = provider;
    else list.push(provider);
    set({ providers: list, selectedId: provider.id });
    logger.success('SYS', `已保存 Provider「${provider.name}」`);
    return provider;
  },

  remove: async (id) => {
    const target = get().providers.find((p) => p.id === id);
    await repository.deleteProvider(id);
    const connectivity = { ...get().connectivity };
    delete connectivity[id];
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      connectivity,
    }));
    if (target) logger.info('SYS', `已删除 Provider「${target.name}」`);
  },

  select: (id) => set({ selectedId: id }),

  getById: (id) => get().providers.find((p) => p.id === id),

  getSecret: async (providerId) => {
    const provider = get().providers.find((p) => p.id === providerId);
    if (!provider) return '';
    return repository.getSecret(provider.secretRef);
  },

  collectSecrets: async (providerIds) => {
    const out: Record<string, string> = {};
    await Promise.all(
      providerIds.map(async (id) => {
        const provider = get().providers.find((p) => p.id === id);
        if (!provider) return;
        try {
          out[id] = await repository.getSecret(provider.secretRef);
        } catch (err) {
          logger.warn('SYS', `读取「${provider.name}」密钥失败：${(err as Error).message}`);
          out[id] = '';
        }
      }),
    );
    return out;
  },

  hasSecret: (providerId) => {
    const provider = get().providers.find((p) => p.id === providerId);
    return provider ? repository.hasSecret(provider.secretRef) : false;
  },

  testConnectivity: async (draft, plainKey) => {
    const id = draft.id ?? 'draft';
    const provider: Provider = {
      ...draft,
      id,
      secretRef: draft.secretRef ?? secretRefFor(id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    let key = plainKey ?? '';
    if (!key && draft.id) {
      key = await get().getSecret(draft.id).catch(() => '');
    }

    const controller = new AbortController();
    const adapter = createAdapter(provider, key, createTransport(provider.transport));
    let result: ConnectivityResult;
    try {
      result = await adapter.ping({
        timeoutMs: PING_TIMEOUT_MS,
        signal: controller.signal,
        maxRetries: 0,
      });
    } catch (err) {
      result = {
        ok: false,
        latencyMs: 0,
        errorCategory: 'unknown',
        message: (err as Error).message,
      };
    }

    if (!result.ok && result.errorCategory && looksLikeCors(result.errorCategory, provider.transport)) {
      result = {
        ...result,
        corsSuspected: true,
        message: `${result.message}（疑似 CORS 拦截：建议把传输方式切换为 proxy，并执行 npm run proxy 启动本地代理）`,
      };
    }

    if (draft.id) {
      set((s) => ({ connectivity: { ...s.connectivity, [draft.id as string]: result } }));
    }
    logger.push(
      result.ok ? 'success' : 'error',
      'SYS',
      `连通性测试 ${result.ok ? '通过' : '失败'}：${result.message}`,
      provider.name,
    );
    return result;
  },
}));

export default useProviderStore;
