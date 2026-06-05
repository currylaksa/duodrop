/**
 * Fixed-window rate limiter (issue 001). Keyed on the client IP, it caps how many rooms a
 * single source can create per window so the in-memory room map can't be flooded.
 */

interface Window {
  start: number;
  count: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Record an attempt for `key`; returns false once it has exceeded the limit this window. */
  tryAcquire(key: string): boolean {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    if (window.count >= this.limit) return false;
    window.count += 1;
    return true;
  }
}
