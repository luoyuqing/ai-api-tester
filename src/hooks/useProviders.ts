import { useCallback, useEffect, useMemo } from 'react';
import type { ConnectivityResult, Provider, ProviderDraft } from '@/types';
import { useProviderStore } from '@/store/providerStore';
import { useUiStore } from '@/store/uiStore';

/** 导入文件里的一条 Provider（可选携带明文 Key，仅在保存瞬间存在于内存）。 */
export interface ProviderImportItem {
  draft: ProviderDraft;
  apiKey?: string;
}

export interface UseProvidersResult {
  providers: Provider[];
  loading: boolean;
  connectivity: Record<string, ConnectivityResult>;
  selectedId: string | null;
  selected: Provider | undefined;

  reload(): Promise<void>;
  select(id: string | null): void;
  save(draft: ProviderDraft, plainKey?: string): Promise<Provider>;
  remove(id: string): Promise<void>;
  hasSecret(providerId: string): boolean;
  testConnectivity(draft: ProviderDraft, plainKey?: string): Promise<ConnectivityResult>;
  /** 批量导入，返回成功条数。 */
  importProviders(items: ProviderImportItem[]): Promise<number>;
}

export interface UseProvidersOptions {
  /** 挂载时自动从本地仓库拉取一次，默认 true。 */
  autoLoad?: boolean;
}

/**
 * providerStore 的 React 门面：补上「挂载即加载」「批量导入」「统一 Snackbar 反馈」。
 * 组件不直接依赖 store 的内部形状，方便后续替换实现。
 */
export function useProviders(options: UseProvidersOptions = {}): UseProvidersResult {
  const { autoLoad = true } = options;

  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const connectivity = useProviderStore((s) => s.connectivity);
  const selectedId = useProviderStore((s) => s.selectedId);
  const load = useProviderStore((s) => s.load);
  const upsert = useProviderStore((s) => s.upsert);
  const removeProvider = useProviderStore((s) => s.remove);
  const select = useProviderStore((s) => s.select);
  const hasSecret = useProviderStore((s) => s.hasSecret);
  const testConnectivity = useProviderStore((s) => s.testConnectivity);
  const showSnackbar = useUiStore((s) => s.showSnackbar);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedId),
    [providers, selectedId],
  );

  const save = useCallback(
    async (draft: ProviderDraft, plainKey?: string): Promise<Provider> => {
      const saved = await upsert(draft, plainKey);
      showSnackbar(`已保存「${saved.name}」`, 'success');
      return saved;
    },
    [upsert, showSnackbar],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await removeProvider(id);
      showSnackbar('已删除该 Provider 及其本地密钥', 'info');
    },
    [removeProvider, showSnackbar],
  );

  const importProviders = useCallback(
    async (items: ProviderImportItem[]): Promise<number> => {
      let ok = 0;
      for (const item of items) {
        try {
          // 顺序写入：upsert 内部读改写同一份 localStorage 列表，并发会互相覆盖。
          // eslint-disable-next-line no-await-in-loop
          await upsert(item.draft, item.apiKey);
          ok += 1;
        } catch (err) {
          showSnackbar(`导入「${item.draft.name}」失败：${(err as Error).message}`, 'error');
        }
      }
      if (ok > 0) showSnackbar(`成功导入 ${ok} 个 Provider`, 'success');
      return ok;
    },
    [upsert, showSnackbar],
  );

  return {
    providers,
    loading,
    connectivity,
    selectedId,
    selected,
    reload: load,
    select,
    save,
    remove,
    hasSecret,
    testConnectivity,
    importProviders,
  };
}

export default useProviders;
