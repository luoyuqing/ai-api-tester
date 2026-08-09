import { create } from 'zustand';
import type {
  EvaluationConfig,
  EvaluationHandle,
  EvaluationResult,
  LogLine,
  RunEvent,
  TaskStatus,
} from '@/types';
import { runEvaluation } from '@/engine';
import { createTransport } from '@/lib/http';
import { repository } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { LOG_BUFFER_LIMIT } from '@/constants/defaults';
import { nextShortId } from '@/lib/id';
import { useProviderStore } from '@/store/providerStore';
import { useTestConfigStore } from '@/store/testConfigStore';
import { useResultStore } from '@/store/resultStore';

export interface ProviderProgress {
  providerId: string;
  providerName: string;
  done: number;
  total: number;
  percent: number;
  finished: boolean;
}

interface RunState {
  status: TaskStatus;
  taskId: string | null;
  done: number;
  total: number;
  percent: number;
  logs: LogLine[];
  providerProgress: Record<string, ProviderProgress>;
  results: EvaluationResult[];
  handle: EvaluationHandle | null;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;

  start(config: EvaluationConfig): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  clearLogs(): void;
  /** Single entry point for engine events (also used by useEvaluationRun batching). */
  applyEvent(e: RunEvent): void;
  applyEvents(events: RunEvent[]): void;
}

function appendLogs(existing: LogLine[], incoming: LogLine[]): LogLine[] {
  const merged = existing.concat(incoming);
  if (merged.length > LOG_BUFFER_LIMIT) {
    return merged.slice(merged.length - LOG_BUFFER_LIMIT);
  }
  return merged;
}

/**
 * Runtime state for one evaluation task.
 * NOT persisted — a page reload legitimately abandons the in-flight run
 * (partial probe results were already flushed to IndexedDB by the engine host).
 */
export const useRunStore = create<RunState>()((set, get) => ({
  status: 'idle',
  taskId: null,
  done: 0,
  total: 0,
  percent: 0,
  logs: [],
  providerProgress: {},
  results: [],
  handle: null,
  error: null,
  startedAt: null,
  endedAt: null,

  start: async (config) => {
    if (get().status === 'running') {
      logger.warn('SYS', '已有评测任务在运行中');
      return;
    }

    const providerStore = useProviderStore.getState();
    const configStore = useTestConfigStore.getState();

    const providers = config.providerIds
      .map((id) => providerStore.getById(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    if (providers.length === 0) {
      set({ status: 'failed', error: '未选择任何有效的 Provider' });
      logger.error('SYS', '启动失败：未选择任何有效的 Provider');
      return;
    }

    const suites = configStore.suites.filter((s) => config.suiteIds.includes(s.id));

    // Decrypt keys here and hand them to the engine as in-memory parameters only.
    let secrets: Record<string, string> = {};
    try {
      secrets = await providerStore.collectSecrets(providers.map((p) => p.id));
    } catch (err) {
      set({ status: 'failed', error: `密钥解密失败：${(err as Error).message}` });
      logger.error('SYS', `密钥解密失败：${(err as Error).message}`);
      return;
    }

    set({
      status: 'running',
      taskId: null,
      done: 0,
      total: 0,
      percent: 0,
      logs: [],
      providerProgress: Object.fromEntries(
        providers.map((p) => [
          p.id,
          { providerId: p.id, providerName: p.name, done: 0, total: 0, percent: 0, finished: false },
        ]),
      ),
      results: [],
      error: null,
      startedAt: Date.now(),
      endedAt: null,
    });

    const handle = runEvaluation(
      config,
      {
        providers,
        suites,
        secrets,
        createTransport,
        placeholders: configStore.placeholders,
      },
      {
        onEvent: (e) => get().applyEvent(e),
      },
    );

    set({ handle, taskId: handle.taskId });

    try {
      const results = await handle.promise;
      // Persist every result (index → localStorage, detail → IndexedDB).
      await Promise.all(results.map((r) => repository.saveResult(r)));
      useResultStore.getState().ingest(results);
      await useResultStore.getState().refreshIndex();
      useResultStore.getState().setComparison(results.map((r) => r.id));
      set((s) => ({
        results,
        endedAt: Date.now(),
        status: s.status === 'cancelled' ? 'cancelled' : 'completed',
      }));
    } catch (err) {
      const message = (err as Error).message;
      set({ status: 'failed', error: message, endedAt: Date.now() });
      logger.error('SYS', `评测任务失败：${message}`);
    } finally {
      set({ handle: null });
    }
  },

  cancel: () => {
    const { handle } = get();
    if (!handle) return;
    handle.cancel();
    set({ status: 'cancelled' });
  },

  pause: () => {
    const { handle } = get();
    if (!handle) return;
    handle.pause();
    set({ status: 'paused' });
  },

  resume: () => {
    const { handle } = get();
    if (!handle) return;
    handle.resume();
    set({ status: 'running' });
  },

  reset: () =>
    set({
      status: 'idle',
      taskId: null,
      done: 0,
      total: 0,
      percent: 0,
      logs: [],
      providerProgress: {},
      results: [],
      handle: null,
      error: null,
      startedAt: null,
      endedAt: null,
    }),

  clearLogs: () => set({ logs: [] }),

  applyEvent: (e) => get().applyEvents([e]),

  applyEvents: (events) => {
    if (events.length === 0) return;

    const state = get();
    let { status, taskId, done, total, percent, error } = state;
    const providerProgress = { ...state.providerProgress };
    const newLogs: LogLine[] = [];
    let results = state.results;

    for (const e of events) {
      switch (e.type) {
        case 'task:start': {
          taskId = e.taskId;
          total = e.totalUnits;
          done = 0;
          percent = 0;
          status = 'running';
          break;
        }
        case 'provider:start': {
          providerProgress[e.providerId] = {
            providerId: e.providerId,
            providerName: e.providerName,
            done: 0,
            total: e.totalUnits,
            percent: 0,
            finished: false,
          };
          break;
        }
        case 'progress': {
          done = e.done;
          total = e.total;
          percent = e.percent;
          if (e.providerId && providerProgress[e.providerId]) {
            const p = providerProgress[e.providerId];
            const nextDone = Math.min(p.done + 1, p.total || p.done + 1);
            providerProgress[e.providerId] = {
              ...p,
              done: nextDone,
              total: Math.max(p.total, nextDone),
              percent: p.total > 0 ? Math.round((nextDone / p.total) * 100) : 0,
            };
          }
          break;
        }
        case 'log': {
          newLogs.push({
            id: nextShortId(),
            level: e.level,
            tag: e.tag,
            providerName: e.providerName,
            message: e.message,
            ts: e.ts,
          });
          break;
        }
        case 'provider:done': {
          const p = providerProgress[e.providerId];
          if (p) {
            providerProgress[e.providerId] = { ...p, finished: true, percent: 100 };
          }
          break;
        }
        case 'task:done': {
          results = e.results;
          status = 'completed';
          percent = 100;
          done = total;
          break;
        }
        case 'task:error': {
          status = 'failed';
          error = e.error;
          break;
        }
        case 'task:cancelled': {
          status = 'cancelled';
          break;
        }
        case 'task:paused': {
          status = 'paused';
          break;
        }
        case 'task:resumed': {
          status = 'running';
          break;
        }
        case 'probe:start':
        case 'probe:done':
        case 'probe:skip':
        default:
          break;
      }
    }

    set((s) => ({
      status,
      taskId,
      done,
      total,
      percent,
      error,
      results,
      providerProgress,
      logs: newLogs.length > 0 ? appendLogs(s.logs, newLogs) : s.logs,
    }));
  },
}));

export default useRunStore;
