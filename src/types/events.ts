/**
 * RunEvent — the ONLY communication channel between the engine and the UI.
 * The engine must never import a store or any React module.
 */
import type { EvaluationResult, ProbeResult } from './metrics';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export type LogTag = 'PERF' | 'FUNC' | 'SAFE' | 'SYS';

export type RunEvent =
  | { type: 'task:start'; taskId: string; totalUnits: number }
  | { type: 'provider:start'; providerId: string; providerName: string; totalUnits: number }
  | { type: 'probe:start'; providerId: string; probeId: string }
  | { type: 'probe:done'; providerId: string; result: ProbeResult }
  | { type: 'probe:skip'; providerId: string; probeId: string; reason: string }
  | { type: 'progress'; done: number; total: number; percent: number; providerId?: string }
  | {
      type: 'log';
      level: LogLevel;
      tag: LogTag;
      providerName?: string;
      message: string;
      ts: number;
    }
  | { type: 'provider:done'; providerId: string; result: EvaluationResult }
  | { type: 'task:done'; taskId: string; results: EvaluationResult[] }
  | { type: 'task:error'; taskId: string; error: string }
  | { type: 'task:paused'; taskId: string }
  | { type: 'task:resumed'; taskId: string }
  | { type: 'task:cancelled'; taskId: string };

export type RunEventType = RunEvent['type'];

/** A rendered log line held by runStore / logger. */
export interface LogLine {
  id: number;
  level: LogLevel;
  tag: LogTag;
  providerName?: string;
  message: string;
  ts: number;
}
