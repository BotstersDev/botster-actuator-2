/**
 * Reconnection with exponential backoff + jitter
 */

export interface ReconnectOptions {
  baseMs?: number;    // default 1000
  maxMs?: number;     // default 30000
  maxAttempts?: number; // default Infinity
}

export class ReconnectManager {
  private attempt = 0;
  private baseMs: number;
  private maxMs: number;
  private maxAttempts: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ReconnectOptions = {}) {
    this.baseMs = opts.baseMs ?? 1000;
    this.maxMs = opts.maxMs ?? 30_000;
    this.maxAttempts = opts.maxAttempts ?? Infinity;
  }

  schedule(fn: () => void): boolean {
    if (this.attempt >= this.maxAttempts) return false;

    const delay = Math.min(
      this.baseMs * Math.pow(2, this.attempt) + Math.random() * 1000,
      this.maxMs
    );
    this.attempt++;

    console.log(`[reconnect] Attempt ${this.attempt} in ${Math.round(delay)}ms`);
    this.timer = setTimeout(fn, delay);
    return true;
  }

  reset(): void {
    this.attempt = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.reset();
  }
}
