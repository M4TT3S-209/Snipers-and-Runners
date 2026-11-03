import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  GRAVITY,
  JUMP_VY,
  applyMoveAction,
  createRunner,
  generateTrack,
  laneX,
  poseOf,
  stepMove,
  type MoveContext,
  type MoveEvent,
  type Track,
} from '../src/index';

/** Leere Strecke ohne Hindernisse */
function emptyTrack(length = 100): Track {
  return { seed: 0, theme: 'meadow', length, towerZ: length + 12, covers: [], trips: [], holes: [], sinkers: [], pads: [], segments: [] };
}

function ctxFor(track: Track): MoveContext {
  return { track, tick: 0, coverAlive: () => true };
}

function run(track: Track, ticks: number, actions: Record<number, Parameters<typeof applyMoveAction>[1]> = {}) {
  const r = createRunner('a');
  const ctx = ctxFor(track);
  const events: MoveEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    ctx.tick = t;
    const a = actions[t];
    if (a) applyMoveAction(r.move, a, ctx);
    stepMove(r.move, ctx, events);
  }
  return { m: r.move, events };
}

describe('Läufer-Bewegung', () => {
  it('läuft mit der eingestellten Geschwindigkeit', () => {
    const { m } = run(emptyTrack(), 60);
    expect(m.z).toBeCloseTo(CONFIG.runner.speed, 5);
  });

  it('Sprung erreicht die eingestellte Höhe und landet nach der Flugzeit', () => {
    expect(GRAVITY).toBeGreaterThan(20);
    expect((JUMP_VY * JUMP_VY) / (2 * GRAVITY)).toBeCloseTo(CONFIG.runner.jumpHeight, 5);
    const r = createRunner('a');
    const ctx = ctxFor(emptyTrack());
    applyMoveAction(r.move, 'jump', ctx);
    let maxY = 0;
    let landedAt = -1;
    for (let t = 0; t < 120; t++) {
      ctx.tick = t;
      stepMove(r.move, ctx);
      maxY = Math.max(maxY, r.move.y);
      if (r.move.grounded && landedAt < 0) landedAt = t;
    }
    expect(maxY).toBeGreaterThan(CONFIG.runner.jumpHeight * 0.95);
    expect(maxY).toBeLessThanOrEqual(CONFIG.runner.jumpHeight + 0.01);
    expect(landedAt / CONFIG.sim.hz).toBeCloseTo(CONFIG.runner.jumpAirS, 1);
  });

  it('Spurwechsel dauert laneChangeS und bleibt in den Grenzen', () => {
    const ticks = Math.ceil(CONFIG.runner.laneChangeS * CONFIG.sim.hz) + 1;
    const { m } = run(emptyTrack(), ticks, { 0: 'right' });
    expect(m.lane).toBe(2);
    expect(m.x).toBeCloseTo(laneX(2), 5);
    const edge = run(emptyTrack(), 30, { 0: 'right', 15: 'right' });
    expect(edge.m.lane).toBe(2);
  });

  it('Ducken hält an, Loslassen läuft weiter', () => {
    const { m } = run(emptyTrack(), 60, { 0: 'duckOn' });
    expect(m.z).toBe(0);
    expect(poseOf(m)).toBe('duck');
    const later = run(emptyTrack(), 60, { 0: 'duckOn', 30: 'duckOff' });
    expect(later.m.z).toBeGreaterThan(3);
  });

  it('gegen eine Hürde laufen → Stolpern (langsamer)', () => {
    const track = emptyTrack();
    track.trips.push({ id: 1, kind: 'hurdle', lane: 1, x: 0, hw: 1, z0: 3, z1: 3.2, y0: 0, y1: 0.9 });
    const { m, events } = run(track, 60);
    expect(events).toContain('trip');
    expect(m.z).toBeLessThan(CONFIG.runner.speed - 1);
  });

  it('über eine Hürde springen → kein Stolpern', () => {
    const track = emptyTrack();
    track.trips.push({ id: 1, kind: 'hurdle', lane: 1, x: 0, hw: 1, z0: 3, z1: 3.2, y0: 0, y1: 0.9 });
    // Absprung ca. 1,6 m vor der Hürde
    const { events } = run(track, 60, { 12: 'jump' });
    expect(events).not.toContain('trip');
  });

  it('unter einem Balken rutschen → kein Stolpern', () => {
    const track = emptyTrack();
    track.trips.push({ id: 1, kind: 'bar', lane: 1, x: 0, hw: 1, z0: 3, z1: 3.35, y0: 1.05, y1: 1.5 });
    const ok = run(track, 60, { 20: 'slide' });
    expect(ok.events).not.toContain('trip');
    const bad = run(track, 60);
    expect(bad.events).toContain('trip');
  });

  it('Deckung (Mauer) blockiert, Spurwechsel löst es', () => {
    const track = emptyTrack();
    track.covers.push({ id: 1, kind: 'wall', lane: 1, x: 0, hw: 1.1, z0: 5, z1: 5.6, h: 2.1, hp: 4 });
    const blocked = run(track, 120);
    expect(blocked.m.z).toBeLessThanOrEqual(5 - CONFIG.runner.radius + 1e-9);
    expect(blocked.m.blocked).toBe(true);
    const around = run(track, 120, { 60: 'left' });
    expect(around.m.z).toBeGreaterThan(6);
  });

  it('auf eine Kiste springen und darauf stehen', () => {
    const track = emptyTrack();
    track.covers.push({ id: 1, kind: 'crate', lane: 1, x: 0, hw: 0.75, z0: 5, z1: 6.5, h: 1.25, hp: 2 });
    const r = createRunner('a');
    const ctx = ctxFor(track);
    let maxYOnCrate = 0;
    for (let t = 0; t < 60; t++) {
      ctx.tick = t;
      if (t === 27) applyMoveAction(r.move, 'jump', ctx);
      stepMove(r.move, ctx);
      if (r.move.z > 5 && r.move.z < 6.5 && r.move.grounded) maxYOnCrate = Math.max(maxYOnCrate, r.move.y);
    }
    expect(r.move.z).toBeGreaterThan(6.5);
    expect(maxYOnCrate).toBeCloseTo(1.25, 5);
  });

  it('in ein Loch fallen → Neustart davor mit Zeitstrafe', () => {
    const track = emptyTrack();
    track.holes.push({ id: 1, lane: 1, z0: 5, z1: 8 });
    const { m, events } = run(track, 80);
    expect(events).toContain('fall');
    expect(m.phase).toBe('respawning');
    expect(m.respawnZ).toBeCloseTo(3.5, 5);
    const after = run(track, 80 + Math.ceil(CONFIG.runner.fallRespawnS * 60) + 5);
    expect(after.events).toContain('respawn');
  });

  it('Lücke überspringen klappt', () => {
    const track = emptyTrack();
    track.holes.push({ id: 1, lane: 1, z0: 6, z1: 9 });
    // ca. 0,6 m vor der Kante abspringen
    const { m, events } = run(track, 120, { 46: 'jump' });
    expect(events).not.toContain('fall');
    expect(m.z).toBeGreaterThan(10);
  });

  it('Sprungpad schleudert über ein großes Loch', () => {
    const track = emptyTrack();
    track.holes.push({ id: 1, lane: 1, z0: 8, z1: 13 });
    track.pads.push({ id: 2, lane: 1, z0: 5, z1: 7 });
    const { m, events } = run(track, 150);
    expect(events).toContain('pad');
    expect(events).not.toContain('fall');
    expect(m.z).toBeGreaterThan(14);
  });

  it('Sprung-Puffer: kurz vor der Landung gedrückt → springt sofort wieder', () => {
    const r = createRunner('a');
    const ctx = ctxFor(emptyTrack());
    applyMoveAction(r.move, 'jump', ctx);
    const events: MoveEvent[] = [];
    for (let t = 0; t < 60; t++) {
      ctx.tick = t;
      if (t === 33) applyMoveAction(r.move, 'jump', ctx); // noch in der Luft
      stepMove(r.move, ctx, events);
    }
    expect(events.filter((e) => e === 'jump').length).toBe(1);
    expect(events.filter((e) => e === 'land').length).toBeGreaterThanOrEqual(1);
  });

  it('erreicht das Ziel', () => {
    const { m, events } = run(emptyTrack(20), 200);
    expect(events).toContain('finish');
    expect(m.phase).toBe('finished');
    expect(m.finishTick).toBe(Math.ceil((20 / CONFIG.runner.speed) * 60));
  });

  it('ist deterministisch (gleiche Eingaben → gleicher Zustand)', () => {
    const track = generateTrack({ seed: 99 });
    const a = run(track, 600, { 30: 'left', 90: 'jump', 150: 'right', 200: 'slide', 300: 'right' });
    const b = run(track, 600, { 30: 'left', 90: 'jump', 150: 'right', 200: 'slide', 300: 'right' });
    expect(JSON.stringify(a.m)).toBe(JSON.stringify(b.m));
  });
});
