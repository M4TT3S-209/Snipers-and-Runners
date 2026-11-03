/**
 * Datenmodell einer Strecke.
 *
 * Koordinaten der Simulation:
 *  z = Weg entlang der Strecke (0 = Start, `length` = Ziel), Turm dahinter
 *  x = seitlich (Spur 0 links, 1 Mitte, 2 rechts – aus Sicht des Läufers)
 *  y = Höhe (0 = Boden)
 * Jedes Element liegt in genau einer Spur.
 */

export type ThemeId = 'meadow' | 'desert' | 'ice' | 'neon' | 'candy';

export type CoverKind = 'crate' | 'wall' | 'barrel';
export type TripKind = 'hurdle' | 'bar';

export type SegmentKind =
  | 'start'
  | 'finish'
  | 'hurdles'
  | 'crates'
  | 'gap'
  | 'bars'
  | 'walls'
  | 'sinkers'
  | 'pad'
  | 'barrels'
  | 'mixed'
  | 'zigzag'
  | 'gauntlet';

/** Zerstörbare Deckung – blockiert den Weg, man kann darauf stehen. */
export interface CoverDef {
  id: number;
  kind: CoverKind;
  lane: number;
  x: number;
  /** halbe Breite */
  hw: number;
  z0: number;
  z1: number;
  h: number;
  hp: number;
}

/** Stolperfalle: Hürde (drüberspringen) oder Balken (drunter rutschen). */
export interface TripDef {
  id: number;
  kind: TripKind;
  lane: number;
  x: number;
  hw: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

/** Loch im Boden einer Spur. */
export interface HoleDef {
  id: number;
  lane: number;
  z0: number;
  z1: number;
}

/** Plattform über einem Loch, die regelmäßig auf- und abtaucht. */
export interface SinkerDef {
  id: number;
  lane: number;
  z0: number;
  z1: number;
  periodTicks: number;
  phaseTicks: number;
  upTicks: number;
}

/** Sprungpad: schleudert den Läufer hoch. */
export interface PadDef {
  id: number;
  lane: number;
  z0: number;
  z1: number;
}

export interface SegmentInfo {
  kind: SegmentKind;
  z0: number;
  z1: number;
}

export interface Track {
  seed: number;
  theme: ThemeId;
  /** z der Ziellinie */
  length: number;
  /** z des Turms (Mitte) */
  towerZ: number;
  covers: CoverDef[];
  trips: TripDef[];
  holes: HoleDef[];
  sinkers: SinkerDef[];
  pads: PadDef[];
  segments: SegmentInfo[];
}
