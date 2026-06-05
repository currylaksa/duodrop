import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('per-IP rate limiter (issue 001): caps room creation', () => {
  it('allows up to the limit within a window, then rejects further attempts', () => {
    const clock = { t: 0 };
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: () => clock.t });

    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
  });

  it('refills once the window has elapsed', () => {
    const clock = { t: 0 };
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: () => clock.t });

    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);

    clock.t = 1000; // a fresh window opens
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
  });

  it('limits each IP independently', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(false);
    // A different IP has its own budget.
    expect(limiter.tryAcquire('2.2.2.2')).toBe(true);
  });
});
