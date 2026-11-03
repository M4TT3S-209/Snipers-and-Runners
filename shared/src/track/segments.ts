import { CONFIG, secondsToTicks } from '../config';
import type { Rng } from '../math/rng';
import type { CoverKind, SegmentKind, Track, TripKind } from './types';

/**
 * Handgebaute Strecken-Segmente. Jedes Segment ist für sich lösbar und hält
 * an Anfang und Ende Abstand, damit beliebige Kombinationen funktionieren.
 *
 * `perm` vertauscht die Spuren (Spiegelung/Variation), damit sich Segmente
 * nicht immer gleich anfühlen.
 */
export interface SegmentBuilder {
  kind: SegmentKind;
  length: number;
  /** Gewicht für die Zufallsauswahl (0 = nie zufällig) */
  weight: number;
  /** Höchstens so oft pro Strecke */
  maxPerTrack: number;
  build(ctx: SegmentContext): void;
}

export class SegmentContext {
  constructor(
    private readonly track: Track,
    readonly z0: number,
    readonly perm: readonly [number, number, number],
    readonly rng: Rng,
    private readonly ids: { next: number },
  ) {}

  private laneX(lane: number): number {
    return (lane - 1) * CONFIG.track.laneWidth;
  }

  /** Spur nach Vertauschung */
  L(i: 0 | 1 | 2): number {
    return this.perm[i];
  }

  cover(kind: CoverKind, lane: number, dz: number): void {
    const c = CONFIG.cover[kind];
    const z0 = this.z0 + dz;
    this.track.covers.push({
      id: this.ids.next++,
      kind,
      lane,
      x: this.laneX(lane),
      hw: c.w / 2,
      z0,
      z1: z0 + c.d,
      h: c.h,
      hp: c.hp,
    });
  }

  trip(kind: TripKind, lane: number, dz: number): void {
    const z0 = this.z0 + dz;
    const isBar = kind === 'bar';
    this.track.trips.push({
      id: this.ids.next++,
      kind,
      lane,
      x: this.laneX(lane),
      hw: CONFIG.track.laneWidth * 0.45,
      z0,
      z1: z0 + (isBar ? 0.35 : 0.2),
      y0: isBar ? CONFIG.obstacles.barY0 : 0,
      y1: isBar ? CONFIG.obstacles.barY1 : CONFIG.obstacles.hurdleH,
    });
  }

  hole(lane: number, dz0: number, dz1: number): void {
    this.track.holes.push({ id: this.ids.next++, lane, z0: this.z0 + dz0, z1: this.z0 + dz1 });
  }

  sinker(lane: number, dz0: number, dz1: number, phaseFraction: number): void {
    const period = secondsToTicks(CONFIG.obstacles.sinkerPeriodS);
    this.track.sinkers.push({
      id: this.ids.next++,
      lane,
      z0: this.z0 + dz0,
      z1: this.z0 + dz1,
      periodTicks: period,
      phaseTicks: Math.round(period * phaseFraction),
      upTicks: Math.round(period * CONFIG.obstacles.sinkerUpFraction),
    });
  }

  pad(lane: number, dz0: number, dz1: number): void {
    this.track.pads.push({ id: this.ids.next++, lane, z0: this.z0 + dz0, z1: this.z0 + dz1 });
  }
}

const ALL = [0, 1, 2] as const;

export const SEGMENTS: Record<SegmentKind, SegmentBuilder> = {
  start: { kind: 'start', length: CONFIG.track.startAreaM, weight: 0, maxPerTrack: 1, build: () => {} },
  finish: { kind: 'finish', length: CONFIG.track.finishAreaM, weight: 0, maxPerTrack: 1, build: () => {} },

  hurdles: {
    kind: 'hurdles',
    length: 26,
    weight: 3,
    maxPerTrack: 2,
    build(s) {
      const freeLane = s.rng.int(0, 2);
      for (const lane of ALL) s.trip('hurdle', lane, 5);
      for (const lane of ALL) if (lane !== freeLane) s.trip('hurdle', lane, 13);
      for (const lane of ALL) s.trip('hurdle', lane, 21);
    },
  },

  crates: {
    kind: 'crates',
    length: 24,
    weight: 3,
    maxPerTrack: 2,
    build(s) {
      s.cover('crate', s.L(0), 5);
      s.cover('crate', s.L(1), 5);
      s.cover('crate', s.L(1), 15);
      s.cover('crate', s.L(2), 15);
    },
  },

  gap: {
    kind: 'gap',
    length: 16,
    weight: 2,
    maxPerTrack: 2,
    build(s) {
      for (const lane of ALL) s.hole(lane, 6, 9);
    },
  },

  bars: {
    kind: 'bars',
    length: 22,
    weight: 2,
    maxPerTrack: 2,
    build(s) {
      for (const lane of ALL) s.trip('bar', lane, 5);
      s.trip('bar', s.L(0), 14);
      s.trip('bar', s.L(1), 14);
      s.cover('wall', s.L(2), 14);
    },
  },

  walls: {
    kind: 'walls',
    length: 28,
    weight: 3,
    maxPerTrack: 2,
    build(s) {
      s.cover('wall', s.L(0), 5);
      s.cover('wall', s.L(1), 13);
      s.cover('wall', s.L(2), 21);
      s.cover('crate', s.L(0), 18);
    },
  },

  sinkers: {
    kind: 'sinkers',
    length: 18,
    weight: 2,
    maxPerTrack: 1,
    build(s) {
      const phase = s.rng.int(0, 2);
      for (const lane of ALL) {
        s.hole(lane, 5, 11);
        s.sinker(lane, 5, 11, ((lane + phase) % 3) / 3);
      }
    },
  },

  pad: {
    kind: 'pad',
    length: 22,
    weight: 2,
    maxPerTrack: 1,
    build(s) {
      for (const lane of ALL) s.hole(lane, 8, 13);
      s.pad(s.L(0), 5, 7);
    },
  },

  barrels: {
    kind: 'barrels',
    length: 22,
    weight: 2,
    maxPerTrack: 2,
    build(s) {
      s.cover('barrel', s.rng.int(0, 2), 5);
      s.cover('barrel', s.rng.int(0, 2), 11);
      s.cover('barrel', s.rng.int(0, 2), 17);
    },
  },

  mixed: {
    kind: 'mixed',
    length: 26,
    weight: 2,
    maxPerTrack: 2,
    build(s) {
      s.cover('crate', s.L(0), 6);
      s.trip('bar', s.L(1), 6);
      s.trip('bar', s.L(2), 6);
      for (const lane of ALL) s.trip('hurdle', lane, 16);
      s.cover('crate', s.L(2), 20);
    },
  },

  zigzag: {
    kind: 'zigzag',
    length: 30,
    weight: 2,
    maxPerTrack: 1,
    build(s) {
      s.cover('crate', s.L(0), 5);
      s.cover('crate', s.L(1), 5);
      s.cover('wall', s.L(1), 13);
      s.cover('wall', s.L(2), 13);
      s.cover('crate', s.L(0), 21);
      s.cover('barrel', s.L(2), 21);
    },
  },

  gauntlet: {
    kind: 'gauntlet',
    length: 24,
    weight: 1,
    maxPerTrack: 1,
    build(s) {
      // Offene Strecke mit wenig Deckung – hier muss man schnell sein.
      s.trip('hurdle', s.L(0), 8);
      s.trip('hurdle', s.L(1), 12);
      s.trip('hurdle', s.L(2), 16);
      s.cover('barrel', s.L(1), 20);
    },
  },
};
