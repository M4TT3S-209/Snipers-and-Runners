import { describe, expect, it } from 'vitest';
import { Rng, hashString, triangleWave, smoothWave, clamp } from '../src/index';

describe('Rng (Seed-Zufall)', () => {
  it('liefert bei gleichem Seed exakt dieselbe Folge', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 50 }, () => a.nextU32());
    const seqB = Array.from({ length: 50 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it('liefert bei anderem Seed eine andere Folge', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it('ist über Versionen stabil (feste Referenzwerte)', () => {
    // Ändert sich das, ergeben alte Seeds andere Strecken → bewusst prüfen!
    const rng = new Rng(42);
    expect([rng.nextU32(), rng.nextU32(), rng.nextU32()]).toEqual([2581720956, 1925393290, 3661312704]);
  });

  it('next() bleibt in [0, 1) und int() in den Grenzen', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it('hashString ist stabil', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('Wellen ohne Math.sin', () => {
  it('triangleWave trifft die Eckpunkte', () => {
    expect(triangleWave(0)).toBe(0);
    expect(triangleWave(0.25)).toBe(1);
    expect(triangleWave(0.5)).toBe(0);
    expect(triangleWave(0.75)).toBe(-1);
    expect(triangleWave(1.25)).toBe(1);
  });

  it('smoothWave bleibt in [-1, 1] und hat die richtigen Extremwerte', () => {
    expect(smoothWave(0.25)).toBeCloseTo(1);
    expect(smoothWave(0.75)).toBeCloseTo(-1);
    for (let t = -2; t < 2; t += 0.01) {
      const v = smoothWave(t);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('clamp begrenzt', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
