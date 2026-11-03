import { CONFIG } from '../config';
import { laneAt } from './generator';
import type { CoverDef, Track, TripDef } from './types';

/**
 * Abfragen auf die Strecke (Boden, Hindernisse) – von Läufer-Simulation,
 * Geschossen und Bots gemeinsam genutzt.
 */

/** Kein Boden (Loch) */
export const NO_GROUND = -1000;

/** Ist die Deckung zum Zeitpunkt `tick` noch da? */
export type CoverAliveFn = (cover: CoverDef, coverIndex: number, tick: number) => boolean;

export function sinkerUp(s: { periodTicks: number; phaseTicks: number; upTicks: number }, tick: number): boolean {
  const t = (((tick + s.phaseTicks) % s.periodTicks) + s.periodTicks) % s.periodTicks;
  return t < s.upTicks;
}

/** Ticks, bis die versinkende Plattform ihren Zustand wechselt (für Bots/Grafik). */
export function sinkerPhase(s: { periodTicks: number; phaseTicks: number; upTicks: number }, tick: number): number {
  return (((tick + s.phaseTicks) % s.periodTicks) + s.periodTicks) % s.periodTicks;
}

const BODY_HALF_W = CONFIG.hitbox.width / 2;

/** Überlappt ein Objekt (Mitte x, halbe Breite hw) den Läufer an Position x? */
export function overlapsX(objX: number, objHw: number, x: number): boolean {
  const d = objX - x;
  const lim = objHw + BODY_HALF_W;
  return d < lim && d > -lim;
}

/**
 * Bodenhöhe unter dem Läufer (Mitte x, Position z).
 * Löcher → NO_GROUND (außer eine versinkende Plattform ist gerade oben).
 * Deckung, auf der man steht → deren Oberkante – aber nur, wenn sie nicht
 * höher als `maxY` ist (sonst steckt man seitlich daneben, nicht darauf).
 */
export function groundAt(
  track: Track,
  x: number,
  z: number,
  tick: number,
  coverAlive: CoverAliveFn,
  maxY = Infinity,
): number {
  const lane = laneAt(x);
  let ground = 0;
  for (const h of track.holes) {
    if (h.z0 > z) break;
    if (h.lane === lane && z < h.z1) {
      ground = NO_GROUND;
      break;
    }
  }
  if (ground === NO_GROUND) {
    for (const s of track.sinkers) {
      if (s.z0 > z) break;
      if (s.lane === lane && z < s.z1 && sinkerUp(s, tick)) {
        ground = 0;
        break;
      }
    }
  }
  const covers = track.covers;
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i]!;
    if (c.z0 > z) break;
    if (z < c.z1 && c.h > ground && c.h <= maxY && overlapsX(c.x, c.hw, x) && coverAlive(c, i, tick)) ground = c.h;
  }
  // Tief im Loch: Der Boden dahinter ist eine Wand, keine Landefläche.
  if (ground > maxY) return NO_GROUND;
  return ground;
}

/** Erstes Loch ab z in einer Spur (für Neustartpunkt nach Sturz). */
export function holeAt(track: Track, lane: number, z: number): { z0: number; z1: number } | null {
  for (const h of track.holes) {
    if (h.z0 > z + 0.5) break;
    if (h.lane === lane && z >= h.z0 - 0.5 && z < h.z1 + 0.5) return h;
  }
  return null;
}

export function padAt(track: Track, x: number, z: number): boolean {
  const lane = laneAt(x);
  for (const p of track.pads) {
    if (p.z0 > z) break;
    if (p.lane === lane && z < p.z1) return true;
  }
  return false;
}

/** Deckung, die zwischen z0 und z1 in der Spur des Läufers liegt (lebend). */
export function coversAhead(
  track: Track,
  x: number,
  zFrom: number,
  zTo: number,
  tick: number,
  coverAlive: CoverAliveFn,
): Array<{ cover: CoverDef; index: number }> {
  const out: Array<{ cover: CoverDef; index: number }> = [];
  const covers = track.covers;
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i]!;
    if (c.z0 > zTo) break;
    if (c.z1 < zFrom) continue;
    if (overlapsX(c.x, c.hw, x) && coverAlive(c, i, tick)) out.push({ cover: c, index: i });
  }
  return out;
}

export function tripsNear(track: Track, x: number, zFrom: number, zTo: number): TripDef[] {
  const out: TripDef[] = [];
  for (const t of track.trips) {
    if (t.z0 > zTo) break;
    if (t.z1 < zFrom) continue;
    if (overlapsX(t.x, t.hw, x)) out.push(t);
  }
  return out;
}
