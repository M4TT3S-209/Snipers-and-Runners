import { CONFIG } from '../config';
import type { Track } from '../track/types';
import { poseOf, type RunnerMove, type RunnerPose } from './runner';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function length3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: Vec3): Vec3 {
  const l = length3(v);
  return l > 0 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: -1 };
}

export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Augenposition/Mündung des Snipers (vorne an der Turmhütte). */
export function sniperEye(track: Track): Vec3 {
  return { x: 0, y: CONFIG.track.towerHeightM + CONFIG.track.sniperEyeAboveTowerM, z: track.towerZ - 2.6 };
}

/** Treffer-Boxen eines Läufers in einer Haltung. */
export interface Hitbox {
  /** Körper als achsenparallele Box */
  min: Vec3;
  max: Vec3;
  /** Kopf als Kugel */
  head: Vec3;
  headR: number;
}

const HB = CONFIG.hitbox;

export function hitboxAt(x: number, y: number, z: number, pose: RunnerPose): Hitbox {
  let h: number = HB.standH;
  let headY: number = HB.headY;
  let headZ = z;
  if (pose === 'duck') {
    h = HB.duckH;
    headY = HB.duckHeadY;
  } else if (pose === 'slide') {
    h = HB.slideH;
    headY = HB.slideHeadY;
    headZ = z + 0.35;
  }
  const hw = HB.width / 2;
  const hd = HB.depth / 2;
  return {
    min: { x: x - hw, y, z: z - hd },
    max: { x: x + hw, y: y + h, z: z + hd },
    head: { x, y: y + headY, z: headZ },
    headR: HB.headR,
  };
}

export function hitboxOfMove(m: RunnerMove): Hitbox {
  return hitboxAt(m.x, m.y, m.z, poseOf(m));
}

/**
 * Strecke p0→p1 gegen Kugel. Gibt den Anteil s ∈ [0,1] des ersten
 * Schnittpunkts zurück, oder -1.
 */
export function segmentSphere(p0: Vec3, p1: Vec3, c: Vec3, r: number): number {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const fz = p0.z - c.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  if (cc <= 0) return 0; // Start schon in der Kugel
  if (a === 0) return -1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const s = (-b - Math.sqrt(disc)) / (2 * a);
  return s >= 0 && s <= 1 ? s : -1;
}

/** Strecke p0→p1 gegen achsenparallele Box (Slab-Verfahren). s ∈ [0,1] oder -1. */
export function segmentBox(p0: Vec3, p1: Vec3, min: Vec3, max: Vec3): number {
  let tmin = 0;
  let tmax = 1;
  const axes: Array<[number, number, number, number]> = [
    [p0.x, p1.x - p0.x, min.x, max.x],
    [p0.y, p1.y - p0.y, min.y, max.y],
    [p0.z, p1.z - p0.z, min.z, max.z],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (d === 0) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Abstand Punkt → Box (0, wenn innen). */
export function pointBoxDistance(p: Vec3, min: Vec3, max: Vec3): number {
  const dx = p.x < min.x ? min.x - p.x : p.x > max.x ? p.x - max.x : 0;
  const dy = p.y < min.y ? min.y - p.y : p.y > max.y ? p.y - max.y : 0;
  const dz = p.z < min.z ? min.z - p.z : p.z > max.z ? p.z - max.z : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function lerp3(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s };
}
