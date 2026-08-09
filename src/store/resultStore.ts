import { create } from 'zustand';
import type { EvaluationResult, ResultIndexItem } from '@/types';
import { repository } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { MAX_COMPARE_MODELS } from '@/constants/defaults';

interface ResultState {
  index: ResultIndexItem[];
  /** Detail cache so switching dashboard tabs does not re-hit IndexedDB. */
  cache: Record<string, EvaluationResult>;
  /** Result ids currently selected for comparison (2-5). */
  comparisonIds: string[];
  loading: boolean;

  refreshIndex(): Promise<void>;
  load(id: string): Promise<EvaluationResult | null>;
  loadMany(ids: string[]): Promise<EvaluationResult[]>;
  ingest(results: EvaluationResult[]): void;
  setComparison(ids: string[]): void;
  toggleComparison(id: string): void;
  clearComparison(): void;
  remove(id: string): Promise<void>;
  clearAll(): Promise<void>;
  getComparisonResults(): EvaluationResult[];
}

export const useResultStore = create<ResultState>()((set, get) => ({
  index: [],
  cache: {},
  comparisonIds: [],
  loading: false,

  refreshIndex: async () => {
    set({ loading: true });
    try {
      await repository.init();
      const index = await repository.listResultIndex();
      index.sort((a, b) => b.endedAt - a.endedAt);
      set({ index, loading: false });
    } catch (err) {
      logger.error('SYS', `加载结果索引失败：${(err as Error).message}`);
      set({ loading: false });
    }
  },

  load: async (id) => {
    const cached = get().cache[id];
    if (cached) return cached;
    const result = await repository.getResult(id);
    if (result) {
      set((s) => ({ cache: { ...s.cache, [id]: result } }));
    }
    return result;
  },

  loadMany: async (ids) => {
    const missing = ids.filter((id) => !get().cache[id]);
    if (missing.length > 0) {
      const loaded = await Promise.all(missing.map((id) => repository.getResult(id)));
      const patch: Record<string, EvaluationResult> = {};
      loaded.forEach((r) => {
        if (r) patch[r.id] = r;
      });
      if (Object.keys(patch).length > 0) {
        set((s) => ({ cache: { ...s.cache, ...patch } }));
      }
    }
    const cache = get().cache;
    return ids.map((id) => cache[id]).filter((r): r is EvaluationResult => Boolean(r));
  },

  /** Put freshly produced results into the cache without a round-trip. */
  ingest: (results) => {
    if (results.length === 0) return;
    const patch: Record<string, EvaluationResult> = {};
    results.forEach((r) => {
      patch[r.id] = r;
    });
    set((s) => ({ cache: { ...s.cache, ...patch } }));
  },

  setComparison: (ids) => set({ comparisonIds: ids.slice(0, MAX_COMPARE_MODELS) }),

  toggleComparison: (id) => {
    const current = get().comparisonIds;
    if (current.includes(id)) {
      set({ comparisonIds: current.filter((x) => x !== id) });
      return;
    }
    if (current.length >= MAX_COMPARE_MODELS) {
      logger.warn('SYS', `最多同时对比 ${MAX_COMPARE_MODELS} 个模型`);
      return;
    }
    set({ comparisonIds: [...current, id] });
  },

  clearComparison: () => set({ comparisonIds: [] }),

  remove: async (id) => {
    await repository.deleteResult(id);
    const cache = { ...get().cache };
    delete cache[id];
    set((s) => ({
      index: s.index.filter((x) => x.id !== id),
      comparisonIds: s.comparisonIds.filter((x) => x !== id),
      cache,
    }));
  },

  clearAll: async () => {
    await repository.clearResults();
    set({ index: [], cache: {}, comparisonIds: [] });
    logger.info('SYS', '已清空本地历史评测记录');
  },

  getComparisonResults: () => {
    const { cache, comparisonIds } = get();
    return comparisonIds.map((id) => cache[id]).filter((r): r is EvaluationResult => Boolean(r));
  },
}));

export default useResultStore;
