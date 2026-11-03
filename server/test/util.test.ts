import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../src/util/origin';
import { takeToken } from '../src/util/rateLimit';

const PROD = 'https://m4tt3s-209.github.io';

describe('Origin-Check', () => {
  it('erlaubt die Spielseite', () => {
    expect(isOriginAllowed('https://m4tt3s-209.github.io', PROD, 'prod')).toBe(true);
    expect(isOriginAllowed('https://M4TT3S-209.github.io', PROD, 'prod')).toBe(true);
  });

  it('verbietet fremde Seiten und fehlende Herkunft', () => {
    expect(isOriginAllowed('https://evil.example', PROD, 'prod')).toBe(false);
    expect(isOriginAllowed('https://m4tt3s-209.github.io.evil.example', PROD, 'prod')).toBe(false);
    expect(isOriginAllowed(null, PROD, 'prod')).toBe(false);
  });

  it('erlaubt localhost und Heimnetz nur in der Entwicklung', () => {
    expect(isOriginAllowed('http://localhost:5173', PROD, 'prod')).toBe(false);
    expect(isOriginAllowed('http://localhost:5173', PROD, 'dev')).toBe(true);
    expect(isOriginAllowed('http://192.168.1.20:5173', PROD, 'dev')).toBe(true);
    expect(isOriginAllowed('http://8.8.8.8:5173', PROD, 'dev')).toBe(false);
  });
});

describe('Rate-Limit (Token-Bucket)', () => {
  it('lässt einen Schwall bis zur Kapazität durch und bremst dann', () => {
    let state = { tokens: 3, last: 0 };
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const r = takeToken(state, 0, 3, 1);
      state = r.state;
      results.push(r.allowed);
    }
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('füllt sich mit der Zeit wieder auf', () => {
    const empty = { tokens: 0, last: 0 };
    expect(takeToken(empty, 500, 3, 1).allowed).toBe(false);
    expect(takeToken(empty, 1000, 3, 1).allowed).toBe(true);
  });
});
