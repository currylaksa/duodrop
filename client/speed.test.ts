import { describe, expect, it } from 'vitest';
import { SpeedSampler } from './speed';

describe('SpeedSampler', () => {
  it('reports zero on the first sample (no elapsed window yet)', () => {
    const s = new SpeedSampler();
    expect(s.sample(0, 0)).toBe(0);
  });

  it('converges on the steady rate (bytes per second)', () => {
    const s = new SpeedSampler();
    s.sample(0, 0);
    s.sample(1000, 1000);
    s.sample(2000, 2000);
    const speed = s.sample(3000, 3000);
    expect(speed).toBeCloseTo(1000, 0);
  });

  it('ignores a non-advancing clock without producing NaN/Infinity', () => {
    const s = new SpeedSampler();
    s.sample(0, 0);
    const first = s.sample(1000, 1000);
    const repeat = s.sample(1000, 1500); // same timestamp → dt = 0
    expect(repeat).toBe(first);
    expect(Number.isFinite(repeat)).toBe(true);
  });
});
