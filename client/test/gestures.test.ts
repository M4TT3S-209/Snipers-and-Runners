import { describe, expect, it } from 'vitest';
import { GestureRecognizer } from '../src/input/gestureRecognizer';

const TH = { swipeMinPx: 28, swipeMaxMs: 450, holdMs: 180, holdMaxMovePx: 14 };

describe('GestureRecognizer (Läufer-Gesten)', () => {
  it('erkennt die vier Wischrichtungen', () => {
    const cases: Array<[number, number, string]> = [
      [-40, 0, 'left'],
      [40, 5, 'right'],
      [3, -40, 'up'],
      [0, 40, 'down'],
    ];
    for (const [dx, dy, expected] of cases) {
      const r = new GestureRecognizer(TH);
      r.down(100, 100, 0);
      expect(r.move(100 + dx, 100 + dy, 80)).toBe(expected);
      expect(r.up(100 + dx, 100 + dy, 120)).toBeNull(); // kein zweites Ereignis
    }
  });

  it('erkennt einen schnellen Wisch auch ohne move-Event', () => {
    const r = new GestureRecognizer(TH);
    r.down(100, 100, 0);
    expect(r.up(100, 50, 60)).toBe('up');
  });

  it('zu langsame Bewegung ist kein Wisch', () => {
    const r = new GestureRecognizer(TH);
    r.down(100, 100, 0);
    expect(r.move(160, 100, 600)).toBeNull();
    expect(r.up(160, 100, 650)).toBeNull();
  });

  it('erkennt Halten (Ducken) und das Loslassen', () => {
    const r = new GestureRecognizer(TH);
    r.down(100, 100, 0);
    expect(r.tick(100)).toBeNull();
    expect(r.tick(200)).toBe('holdStart');
    expect(r.isHolding).toBe(true);
    // Während des Haltens zählt Bewegung nicht als Wisch
    expect(r.move(160, 100, 250)).toBeNull();
    expect(r.up(160, 100, 900)).toBe('holdEnd');
  });

  it('Bewegung vor Ablauf der Haltezeit verhindert das Ducken', () => {
    const r = new GestureRecognizer(TH);
    r.down(100, 100, 0);
    r.move(120, 100, 50); // 20 px – mehr als holdMaxMovePx, weniger als Wisch
    expect(r.tick(300)).toBeNull();
  });

  it('kurzer Tipp wird als tap erkannt', () => {
    const r = new GestureRecognizer(TH);
    r.down(100, 100, 0);
    expect(r.up(102, 101, 90)).toBe('tap');
  });

  it('Abbruch während des Haltens beendet das Ducken', () => {
    const r = new GestureRecognizer(TH);
    r.down(100, 100, 0);
    r.tick(200);
    expect(r.cancel()).toBe('holdEnd');
  });
});
