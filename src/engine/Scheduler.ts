import type { PlanUnit } from '@/types';
import { MAX_CONCURRENCY, MIN_CONCURRENCY } from '@/constants/defaults';
import { CancelledError, isCancellation } from '@/engine/errors';

/** Progress + lifecycle callbacks. The Scheduler never emits RunEvents itself. */
export interface SchedulerHooks {
  /** Fired once per completed request unit. */
  onProgress?(done: number, total: number, providerId?: string): void;
  onPaused?(): void;
  onResumed?(): void;
  onCancelled?(): void;
}

export type SchedulerState = 'idle' | 'running' | 'paused' | 'cancelled' | 'done';

/**
 * Concurrency-limited executor with pause / resume / cancel.
 *
 * Lane model — the one design decision worth reading:
 * units are grouped into **one lane per provider** and lanes run in parallel up
 * to `concurrency`, while units *inside* a lane run strictly sequentially.
 * Overlapping two requests to the same endpoint would inflate that endpoint's
 * own TTFT/E2E numbers, which would silently corrupt PERF-01 — the very thing
 * the tool exists to measure. Cross-provider parallelism is safe and is exactly
 * what the concurrency knob buys.
 */
export class Scheduler {
  private readonly controller = new AbortController();

  private readonly hooks: SchedulerHooks;

  private readonly concurrency: number;

  private paused = false;

  private resumeWaiters: Array<() => void> = [];

  private total = 0;

  private done = 0;

  private state: SchedulerState = 'idle';

  public constructor(concurrency: number, hooks: SchedulerHooks = {}) {
    const normalized = Number.isFinite(concurrency) ? Math.floor(concurrency) : MIN_CONCURRENCY;
    this.concurrency = Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, normalized));
    this.hooks = hooks;
  }

  /** Signal every outbound request must be bound to. */
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get status(): SchedulerState {
    return this.state;
  }

  public get completedUnits(): number {
    return this.done;
  }

  public get totalUnits(): number {
    return this.total;
  }

  /** Set the progress denominator before submitting work. */
  public setTotal(total: number): void {
    this.total = Math.max(0, Math.floor(total));
  }

  /**
   * Report one finished request unit.
   *
   * Deliberately NOT throttled: `runStore` derives per-provider progress by
   * counting these events, so coalescing them would desynchronise the
   * per-model progress bars. One event per request is a few hundred events per
   * run, which the UI already batches on a 16ms frame budget.
   */
  public tick(providerId?: string): void {
    this.done += 1;
    if (this.total > 0 && this.done > this.total) this.total = this.done;
    this.hooks.onProgress?.(this.done, this.total, providerId);
  }

  /**
   * Cooperative checkpoint awaited by every probe before an outbound request.
   * Blocks while paused, throws `CancelledError` once cancelled.
   */
  public async gate(): Promise<void> {
    if (this.controller.signal.aborted) throw new CancelledError();
    while (this.paused && !this.controller.signal.aborted) {
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve);
      });
    }
    if (this.controller.signal.aborted) throw new CancelledError();
  }

  /**
   * Lightweight cooperative pause-check used between iterations of an in-probe
   * parallel map. Unlike `gate` it does not correspond to a request slot, so a
   * paused task can yield its lane without holding concurrency hostage
   * (see `ProbeContext.checkpoint` in probes/Probe.ts).
   */
  public async checkpoint(): Promise<void> {
    if (this.controller.signal.aborted) throw new CancelledError();
    while (this.paused && !this.controller.signal.aborted) {
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve);
      });
    }
    if (this.controller.signal.aborted) throw new CancelledError();
  }

  public pause(): void {
    if (this.paused || this.controller.signal.aborted) return;
    this.paused = true;
    this.state = 'paused';
    this.hooks.onPaused?.();
  }

  public resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.state === 'paused') this.state = 'running';
    this.releaseWaiters();
    this.hooks.onResumed?.();
  }

  public cancel(): void {
    if (this.controller.signal.aborted) return;
    this.state = 'cancelled';
    this.paused = false;
    this.controller.abort(new DOMException('Evaluation cancelled by user', 'AbortError'));
    // Unblock anything waiting on the pause gate so it can observe the abort.
    this.releaseWaiters();
    this.hooks.onCancelled?.();
  }

  public get isCancelled(): boolean {
    return this.controller.signal.aborted;
  }

  /**
   * Run every unit exactly once.
   * `worker` is expected to swallow its own domain errors; only a cancellation
   * is allowed to escape and it terminates the whole submission quietly.
   */
  public async submit(
    units: readonly PlanUnit[],
    worker: (unit: PlanUnit) => Promise<void>,
  ): Promise<void> {
    if (units.length === 0) {
      this.state = 'done';
      return;
    }
    this.state = 'running';

    const lanes = new Map<string, PlanUnit[]>();
    units.forEach((unit) => {
      const lane = lanes.get(unit.providerId);
      if (lane) lane.push(unit);
      else lanes.set(unit.providerId, [unit]);
    });

    const laneList = Array.from(lanes.values());
    let cursor = 0;
    const workers = Math.min(this.concurrency, laneList.length);

    const runner = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= laneList.length) return;
        const lane = laneList[index];
        for (const unit of lane) {
          if (this.controller.signal.aborted) return;
          try {
            await this.gate();
            await worker(unit);
          } catch (err) {
            if (isCancellation(err)) return;
            // A worker that throws anything else is a programming error; keep
            // the remaining lanes alive rather than aborting the whole run.
            throw err;
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, workers) }, () => runner()));
    this.state = this.controller.signal.aborted ? 'cancelled' : 'done';
  }

  private releaseWaiters(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

export default Scheduler;
