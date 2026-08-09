import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvaluationResult, ResultIndexItem } from '@/types';
import { useResultStore } from '@/store/resultStore';
import { MAX_COMPARE_MODELS, MIN_COMPARE_MODELS } from '@/constants/defaults';

export interface UseComparisonResult {
  /** 历史索引（已按结束时间倒序）。 */
  index: ResultIndexItem[];
  indexLoading: boolean;
  comparisonIds: string[];
  /** 已加载的完整结果，顺序与 comparisonIds 一致。 */
  results: EvaluationResult[];
  loadingResults: boolean;

  minCompare: number;
  maxCompare: number;
  canAddMore: boolean;
  /** 达到推荐的最少对比数量（2）。 */
  hasEnoughForCompare: boolean;

  refreshIndex(): Promise<void>;
  toggle(id: string): void;
  setIds(ids: string[]): void;
  clear(): void;
  remove(id: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface UseComparisonOptions {
  /** 挂载时自动刷新历史索引，默认 true。 */
  autoLoad?: boolean;
}

/**
 * 历史结果选择 + 详情懒加载。
 * 索引存在 localStorage（轻量），详情在 IndexedDB（重），因此选中后才按需拉取。
 */
export function useComparison(options: UseComparisonOptions = {}): UseComparisonResult {
  const { autoLoad = true } = options;

  const index = useResultStore((s) => s.index);
  const indexLoading = useResultStore((s) => s.loading);
  const comparisonIds = useResultStore((s) => s.comparisonIds);
  const refreshIndex = useResultStore((s) => s.refreshIndex);
  const loadMany = useResultStore((s) => s.loadMany);
  const toggleComparison = useResultStore((s) => s.toggleComparison);
  const setComparison = useResultStore((s) => s.setComparison);
  const clearComparison = useResultStore((s) => s.clearComparison);
  const removeResult = useResultStore((s) => s.remove);
  const clearAllResults = useResultStore((s) => s.clearAll);

  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [loadingResults, setLoadingResults] = useState<boolean>(false);

  useEffect(() => {
    if (autoLoad) void refreshIndex();
  }, [autoLoad, refreshIndex]);

  // comparisonIds 是数组引用，join 成字符串做依赖以避免无意义的重复拉取。
  const idsKey = comparisonIds.join('|');

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey.length > 0 ? idsKey.split('|') : [];
    if (ids.length === 0) {
      setResults([]);
      setLoadingResults(false);
      return () => {
        cancelled = true;
      };
    }
    setLoadingResults(true);
    void loadMany(ids)
      .then((loaded) => {
        if (!cancelled) setResults(loaded);
      })
      .finally(() => {
        if (!cancelled) setLoadingResults(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey, loadMany]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await removeResult(id);
      setResults((prev) => prev.filter((r) => r.id !== id));
    },
    [removeResult],
  );

  const clearAll = useCallback(async (): Promise<void> => {
    await clearAllResults();
    setResults([]);
  }, [clearAllResults]);

  const canAddMore = comparisonIds.length < MAX_COMPARE_MODELS;
  const hasEnoughForCompare = comparisonIds.length >= MIN_COMPARE_MODELS;

  return useMemo(
    () => ({
      index,
      indexLoading,
      comparisonIds,
      results,
      loadingResults,
      minCompare: MIN_COMPARE_MODELS,
      maxCompare: MAX_COMPARE_MODELS,
      canAddMore,
      hasEnoughForCompare,
      refreshIndex,
      toggle: toggleComparison,
      setIds: setComparison,
      clear: clearComparison,
      remove,
      clearAll,
    }),
    [
      index,
      indexLoading,
      comparisonIds,
      results,
      loadingResults,
      canAddMore,
      hasEnoughForCompare,
      refreshIndex,
      toggleComparison,
      setComparison,
      clearComparison,
      remove,
      clearAll,
    ],
  );
}

export default useComparison;
