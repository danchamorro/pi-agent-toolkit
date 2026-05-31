type TimerHandle = ReturnType<typeof setTimeout>;
type TimerSlot = Record<symbol, TimerHandle | null | undefined>;

/**
 * A single-shot timer whose live handle is stored on `globalThis` under a
 * stable symbol. Pi hot-reload re-executes the extension module, which would
 * otherwise orphan a pending `setTimeout` from the previous module instance.
 * Constructing a new timer clears any handle left behind by a prior load, so
 * only one timer is ever live across reloads. This keeps the global-symbol
 * bookkeeping out of the extension body.
 */
export class ReloadSafeTimer {
  private readonly key: symbol;
  private handle: TimerHandle | null = null;

  constructor(key: symbol) {
    this.key = key;
    const slot = globalThis as TimerSlot;
    const previous = slot[key];
    if (previous) {
      clearTimeout(previous);
      slot[key] = null;
    }
  }

  get scheduled(): boolean {
    return this.handle !== null;
  }

  /** Schedules the callback unless a tick is already pending (a no-op then). */
  schedule(callback: () => void, delayMs: number): void {
    if (this.handle) {
      return;
    }
    const slot = globalThis as TimerSlot;
    this.handle = setTimeout(() => {
      this.handle = null;
      slot[this.key] = null;
      callback();
    }, delayMs);
    slot[this.key] = this.handle;
  }

  clear(): void {
    if (!this.handle) {
      return;
    }
    clearTimeout(this.handle);
    this.handle = null;
    (globalThis as TimerSlot)[this.key] = null;
  }
}
