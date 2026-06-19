/**
 * Smoothed transfer-speed estimate. Progress callbacks fire irregularly, so a raw
 * delta/dt jitters; an exponential moving average gives a steady bytes-per-second
 * readout for the UI. One sampler per in-flight transfer.
 */
export class SpeedSampler {
  private lastTime: number | null = null;
  private lastBytes = 0;
  private ema: number | null = null;

  constructor(private readonly alpha = 0.3) {}

  /** Feed the current clock (ms) and cumulative bytes; returns smoothed bytes/sec. */
  sample(now: number, transferred: number): number {
    if (this.lastTime === null) {
      this.lastTime = now;
      this.lastBytes = transferred;
      return 0;
    }
    const dt = (now - this.lastTime) / 1000;
    if (dt <= 0) return this.ema ?? 0;
    const rate = (transferred - this.lastBytes) / dt;
    this.ema = this.ema === null ? rate : this.alpha * rate + (1 - this.alpha) * this.ema;
    this.lastTime = now;
    this.lastBytes = transferred;
    return this.ema;
  }
}
