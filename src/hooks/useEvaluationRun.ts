import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvaluationConfig, EvaluationResult, LogLine, TaskStatus } from '@/types';
import { useRunStore, type ProviderProgress } from '@/store/runStore';

export interface UseEvaluationRunResult {
  status: TaskStatus;
  taskId: string | null;
  done: number;
  total: number;
  percent: number;
  logs: LogLine[];
  /** 按名称排序后的每个 Provider 的进度。 */
  providerProgress: ProviderProgress[];
  results: EvaluationResult[];
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;

  isIdle: boolean;
  isRunning: boolean;
  isPaused: boolean;
  /** 已结束（完成 / 取消 / 失败）。 */
  isFinished: boolean;
  /** 运行中每秒刷新的耗时；结束后固定为总耗时。 */
  elapsedMs: number;

  start(config: EvaluationConfig): Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
  reset(): void;
  clearLogs(): void;
}

/**
 * runStore 的 React 门面。
 * 引擎事件已经由 runStore.start() 直接接管（onEvent → applyEvent），
 * 这里只负责派生视图状态与计时，避免出现第二条事件通道。
 */
export function useEvaluationRun(): UseEvaluationRunResult {
  const status = useRunStore((s) => s.status);
  const taskId = useRunStore((s) => s.taskId);
  const done = useRunStore((s) => s.done);
  const total = useRunStore((s) => s.total);
  const percent = useRunStore((s) => s.percent);
  const logs = useRunStore((s) => s.logs);
  const progressMap = useRunStore((s) => s.providerProgress);
  const results = useRunStore((s) => s.results);
  const error = useRunStore((s) => s.error);
  const startedAt = useRunStore((s) => s.startedAt);
  const endedAt = useRunStore((s) => s.endedAt);
  const start = useRunStore((s) => s.start);
  const pause = useRunStore((s) => s.pause);
  const resume = useRunStore((s) => s.resume);
  const cancel = useRunStore((s) => s.cancel);
  const reset = useRunStore((s) => s.reset);
  const clearLogs = useRunStore((s) => s.clearLogs);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle';
  const isFinished = status === 'completed' || status === 'cancelled' || status === 'failed';

  const [tick, setTick] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isRunning && !isPaused) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, isPaused]);

  const elapsedMs = useMemo(() => {
    if (startedAt === null) return 0;
    const end = endedAt ?? tick;
    return Math.max(0, end - startedAt);
  }, [startedAt, endedAt, tick]);

  const providerProgress = useMemo(
    () =>
      Object.values(progressMap).sort((a, b) =>
        a.providerName.localeCompare(b.providerName, 'zh-Hans-CN'),
      ),
    [progressMap],
  );

  const startRun = useCallback(
    async (config: EvaluationConfig): Promise<void> => {
      setTick(Date.now());
      await start(config);
    },
    [start],
  );

  return {
    status,
    taskId,
    done,
    total,
    percent,
    logs,
    providerProgress,
    results,
    error,
    startedAt,
    endedAt,
    isIdle,
    isRunning,
    isPaused,
    isFinished,
    elapsedMs,
    start: startRun,
    pause,
    resume,
    cancel,
    reset,
    clearLogs,
  };
}

export default useEvaluationRun;
