import { CONFIG } from '../config';
import { Rng } from '../math/rng';
import { SEGMENTS, SegmentContext } from './segments';
import type { SegmentKind, ThemeId, Track } from './types';

export const THEMES: readonly ThemeId[] = ['meadow', 'desert', 'ice', 'neon', 'candy'];

const PERMS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [2, 1, 0],
  [1, 0, 2],
  [0, 2, 1],
  [1, 2, 0],
  [2, 0, 1],
];

export interface TrackOptions {
  seed: number;
  theme?: ThemeId;
  /** Nur diese Segmente zufällig verwenden (für Tests / Freischaltungen) */
  allowed?: readonly SegmentKind[];
  targetLength?: number;
}

/**
 * Baut aus einem Seed deterministisch eine Strecke:
 * Start → zufällige Segmente (gewichtet, keine Wiederholung direkt
 * hintereinander, Höchstanzahl je Typ) → Ziel.
 */
export function generateTrack(opts: TrackOptions): Track {
  const rng = new Rng(opts.seed);
  const theme = opts.theme ?? THEMES[rng.int(0, THEMES.length - 1)] ?? 'meadow';
  const target = opts.targetLength ?? CONFIG.track.targetLengthM;
  const track: Track = {
    seed: opts.seed,
    theme,
    length: 0,
    towerZ: 0,
    covers: [],
    trips: [],
    holes: [],
    sinkers: [],
    pads: [],
    segments: [],
  };
  const ids = { next: 1 };
  let z = 0;

  const place = (kind: SegmentKind) => {
    const seg = SEGMENTS[kind];
    const perm = PERMS[rng.int(0, PERMS.length - 1)] ?? PERMS[0]!;
    seg.build(new SegmentContext(track, z, perm, rng, ids));
    track.segments.push({ kind, z0: z, z1: z + seg.length });
    z += seg.length;
  };

  place('start');

  const counts = new Map<SegmentKind, number>();
  const pool = (opts.allowed ?? (Object.keys(SEGMENTS) as SegmentKind[])).filter((k) => SEGMENTS[k].weight > 0);
  let last: SegmentKind | null = null;
  const finishLen = SEGMENTS.finish.length;

  while (z + finishLen < target - 8) {
    const candidates = pool.filter((k) => k !== last && (counts.get(k) ?? 0) < SEGMENTS[k].maxPerTrack);
    if (candidates.length === 0) break;
    const total = candidates.reduce((sum, k) => sum + SEGMENTS[k].weight, 0);
    let roll = rng.next() * total;
    let chosen = candidates[candidates.length - 1]!;
    for (const k of candidates) {
      roll -= SEGMENTS[k].weight;
      if (roll < 0) {
        chosen = k;
        break;
      }
    }
    place(chosen);
    counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
    last = chosen;
  }

  place('finish');
  track.length = z;
  track.towerZ = z + CONFIG.track.towerBehindFinishM;

  // Sortiert nach z – die Abfragen verlassen sich darauf.
  track.covers.sort((a, b) => a.z0 - b.z0);
  track.trips.sort((a, b) => a.z0 - b.z0);
  track.holes.sort((a, b) => a.z0 - b.z0);
  track.sinkers.sort((a, b) => a.z0 - b.z0);
  track.pads.sort((a, b) => a.z0 - b.z0);
  return track;
}

/** x-Position der Spurmitte */
export function laneX(lane: number): number {
  return (lane - 1) * CONFIG.track.laneWidth;
}

/** Spur zu einer x-Position (gerundet, begrenzt auf 0…2) */
export function laneAt(x: number): number {
  const lane = Math.round(x / CONFIG.track.laneWidth) + 1;
  return lane < 0 ? 0 : lane > CONFIG.track.lanes - 1 ? CONFIG.track.lanes - 1 : lane;
}
