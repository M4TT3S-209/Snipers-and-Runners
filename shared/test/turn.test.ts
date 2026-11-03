import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  TurnSim,
  hitboxOfMove,
  normalize,
  projectilePosAt,
  sniperEye,
  type Track,
  type TurnEvent,
  type Vec3,
} from '../src/index';

function emptyTrack(length = 150): Track {
  return { seed: 0, theme: 'meadow', length, towerZ: length + 12, covers: [], trips: [], holes: [], sinkers: [], pads: [], segments: [] };
}

function sim(track = emptyTrack(), weapon: 'precision' | 'semi' | 'rocket' = 'precision', gadget: 'shield' | 'decoy' | null = null) {
  return new TurnSim({ track, runners: [{ id: 'r', gadget }], snipers: [{ id: 's', weapon }] });
}

function dirTo(t: TurnSim, p: Vec3): Vec3 {
  const eye = sniperEye(t.track);
  return normalize({ x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z });
}

function stepUntil(t: TurnSim, ticks: number): TurnEvent[] {
  const events: TurnEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    t.step();
    events.push(...t.drainEvents());
  }
  return events;
}

describe('Ballistik', () => {
  it('Flugbahn ist eine gerade Linie mit fester Geschwindigkeit', () => {
    const p = { origin: { x: 0, y: 20, z: 100 }, vel: { x: 0, y: 0, z: -180 }, gravity: 0, spawnTime: 10 };
    expect(projectilePosAt(p, 10)).toEqual({ x: 0, y: 20, z: 100 });
    expect(projectilePosAt(p, 70).z).toBeCloseTo(-80, 6);
    const g = { ...p, gravity: 10 };
    expect(projectilePosAt(g, 70).y).toBeCloseTo(15, 6);
  });

  it('Kopftreffer mit dem Präzisionsgewehr = raus', () => {
    const t = sim();
    t.queueRunnerAction('r', 'duckOn');
    stepUntil(t, 5);
    const head = hitboxOfMove(t.runner('r')!.move).head;
    t.fire('s', dirTo(t, head));
    const events = stepUntil(t, 120);
    const hit = events.find((e) => e.t === 'hit');
    expect(hit && hit.t === 'hit' && hit.part).toBe('head');
    expect(t.runner('r')!.out).toBe(true);
    expect(events.some((e) => e.t === 'out')).toBe(true);
  });

  it('Körpertreffer kostet ein Herz (2 Halbherzen)', () => {
    const t = sim();
    t.queueRunnerAction('r', 'duckOn');
    stepUntil(t, 5);
    const m = t.runner('r')!.move;
    t.fire('s', dirTo(t, { x: m.x, y: m.y + 0.35, z: m.z }));
    stepUntil(t, 120);
    expect(t.runner('r')!.hp).toBe(CONFIG.runner.hp - CONFIG.weapons.precision.dmgBody);
  });

  it('Kugel braucht Flugzeit (Treffer erst nach Entfernung / Geschwindigkeit)', () => {
    const t = sim();
    t.queueRunnerAction('r', 'duckOn');
    stepUntil(t, 5);
    const head = hitboxOfMove(t.runner('r')!.move).head;
    const eye = sniperEye(t.track);
    const dist = Math.hypot(head.x - eye.x, head.y - eye.y, head.z - eye.z);
    const fireTick = t.tick;
    t.fire('s', dirTo(t, head));
    const hit = stepUntil(t, 120).find((e) => e.t === 'hit')!;
    const expected = fireTick + (dist / CONFIG.weapons.precision.speed) * CONFIG.sim.hz;
    expect(Math.abs(hit.tick - expected)).toBeLessThanOrEqual(1.5);
  });

  it('Nachladen: zweiter Schuss erst nach reloadS', () => {
    const t = sim();
    expect(t.fire('s', { x: 0, y: -0.1, z: -1 })).not.toBeNull();
    expect(t.fire('s', { x: 0, y: -0.1, z: -1 })).toBeNull();
    stepUntil(t, Math.round(CONFIG.weapons.precision.reloadS * CONFIG.sim.hz) - 2);
    expect(t.canFire(t.sniper('s')!)).toBe(false);
    stepUntil(t, 3);
    expect(t.canFire(t.sniper('s')!)).toBe(true);
  });

  it('Halbautomatik: 4 Schuss, dann Nachladen', () => {
    const t = sim(emptyTrack(), 'semi');
    let shots = 0;
    for (let i = 0; i < 200; i++) {
      if (t.fire('s', { x: 0, y: -0.1, z: -1 })) shots++;
      t.step();
    }
    expect(shots).toBe(CONFIG.weapons.semi.magSize);
  });

  it('ungültige Richtungen werden abgelehnt (z. B. nach hinten)', () => {
    const t = sim();
    expect(t.fire('s', { x: 0, y: 0, z: 1 })).toBeNull();
    expect(t.fire('s', { x: Number.NaN, y: 0, z: -1 })).toBeNull();
  });
});

describe('Deckung', () => {
  it('fängt Kugeln ab und geht nach genug Treffern kaputt', () => {
    const track = emptyTrack();
    // Läufer duckt sich bei z≈0 hinter einer Mauer
    track.covers.push({ id: 7, kind: 'wall', lane: 1, x: 0, hw: 1.1, z0: 1, z1: 1.6, h: 2.1, hp: 4 });
    const t = sim(track);
    t.queueRunnerAction('r', 'duckOn');
    stepUntil(t, 5);
    const head = hitboxOfMove(t.runner('r')!.move).head;
    for (let i = 0; i < 4; i++) {
      t.fire('s', dirTo(t, head));
      stepUntil(t, Math.round(CONFIG.weapons.precision.reloadS * 60) + 2);
    }
    expect(t.runner('r')!.hp).toBe(CONFIG.runner.hp);
    expect(t.coverHp[0]).toBe(0);
    expect(t.coverDestroyedTick[0]).toBeLessThan(Infinity);
    // Jetzt ist die Deckung weg → Treffer
    t.fire('s', dirTo(t, head));
    stepUntil(t, 120);
    expect(t.runner('r')!.out).toBe(true);
  });

  it('Rakete zerstört Deckung sofort und trifft mit Splash', () => {
    const track = emptyTrack();
    track.covers.push({ id: 7, kind: 'crate', lane: 1, x: 0, hw: 0.75, z0: 1, z1: 2.5, h: 1.25, hp: 2 });
    const t = sim(track, 'rocket');
    t.queueRunnerAction('r', 'duckOn');
    stepUntil(t, 5);
    t.fire('s', dirTo(t, { x: 0, y: 1.0, z: 1 }));
    const events = stepUntil(t, 400);
    expect(t.coverDestroyedTick[0]).toBeLessThan(Infinity);
    expect(events.some((e) => e.t === 'explosion')).toBe(true);
    expect(t.runner('r')!.hp).toBe(CONFIG.runner.hp - CONFIG.weapons.rocket.splashDmg);
  });

  it('Schild fängt einen Treffer ab', () => {
    const t = sim(emptyTrack(), 'precision', 'shield');
    t.queueRunnerAction('r', 'gadget');
    t.queueRunnerAction('r', 'duckOn');
    stepUntil(t, 5);
    const head = hitboxOfMove(t.runner('r')!.move).head;
    t.fire('s', dirTo(t, head));
    const events = stepUntil(t, 120);
    const hit = events.find((e) => e.t === 'hit');
    expect(hit && hit.t === 'hit' && hit.shielded).toBe(true);
    expect(t.runner('r')!.out).toBe(false);
  });
});

describe('Lag-Kompensation', () => {
  /**
   * Aufbau: Der Sniper sah den Läufer 14 Ticks in der Vergangenheit und zielt
   * mit korrektem Vorhalt. Kurz bevor die Kugel ohne Rückspulen ankäme,
   * wechselt der Läufer die Spur. Mit Rückspulen startet die Kugel zum
   * gesehenen Zeitpunkt und trifft noch vor dem Spurwechsel.
   */
  function lagScenario(useRewind: boolean): boolean {
    const t = sim();
    stepUntil(t, 60);
    const now = t.tick;
    const past = now - 14;
    const box = t.hitboxesAt(past)[0]!.box!;
    const eye = sniperEye(t.track);
    // Vorhalt aus Sicht des vergangenen Zeitpunkts
    let target = { ...box.head };
    let flightTicks = 0;
    for (let i = 0; i < 4; i++) {
      const dist = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
      flightTicks = (dist / CONFIG.weapons.precision.speed) * CONFIG.sim.hz;
      target = { ...box.head, z: box.head.z + (CONFIG.runner.speed * flightTicks) / CONFIG.sim.hz };
    }
    const impactWithRewind = past + flightTicks;
    // Spurwechsel kurz nach dem Einschlag mit Rückspulen
    t.queueRunnerAction('r', 'right', Math.ceil(impactWithRewind) + 4);
    t.fire('s', dirTo(t, target), useRewind ? past : undefined);
    return stepUntil(t, 120).some((e) => e.t === 'hit');
  }

  it('Schuss auf die Position, die der Sniper gesehen hat, trifft (mit Rückspulen)', () => {
    expect(lagScenario(true)).toBe(true);
  });

  it('ohne Rückspulen geht derselbe Schuss daneben', () => {
    expect(lagScenario(false)).toBe(false);
  });

  it('Rückspulen ist auf maxRewindMs begrenzt', () => {
    const t = sim();
    stepUntil(t, 120);
    const info = t.fire('s', { x: 0, y: -0.1, z: -1 }, t.tick - 1000)!;
    const maxTicks = Math.round((CONFIG.net.maxRewindMs / 1000) * CONFIG.sim.hz);
    expect(info.spawnTime).toBe(t.tick - maxTicks);
  });

  it('späte Läufer-Eingabe wird rückwirkend eingerechnet', () => {
    const a = sim();
    stepUntil(a, 30);
    a.queueRunnerAction('r', 'left', 30);
    stepUntil(a, 30);

    const b = sim();
    stepUntil(b, 34);
    b.queueRunnerAction('r', 'left', 30); // kommt 4 Ticks zu spät an
    stepUntil(b, 26);
    expect(JSON.stringify(b.runner('r')!.move)).toBe(JSON.stringify(a.runner('r')!.move));
  });

  it('Eingabe für einen zukünftigen Tick wird erst dann angewendet', () => {
    const t = sim();
    t.queueRunnerAction('r', 'jump', 20);
    stepUntil(t, 19);
    expect(t.runner('r')!.move.grounded).toBe(true);
    stepUntil(t, 2);
    expect(t.runner('r')!.move.grounded).toBe(false);
  });
});

describe('Zug-Ende', () => {
  it('endet, wenn alle im Ziel sind', () => {
    const t = sim(emptyTrack(30));
    const events = stepUntil(t, 400);
    expect(t.over).toBe(true);
    expect(events.some((e) => e.t === 'finish')).toBe(true);
    const run = t.results().runs[0]!;
    expect(run.finished).toBe(true);
    expect(run.timeTicks).toBe(Math.ceil((30 / CONFIG.runner.speed) * 60));
  });

  it('endet nach der maximalen Laufzeit', () => {
    const t = sim(emptyTrack(1000));
    stepUntil(t, CONFIG.runner.maxRunS * 60 + 5);
    expect(t.over).toBe(true);
    expect(t.results().runs[0]!.finished).toBe(false);
  });
});
