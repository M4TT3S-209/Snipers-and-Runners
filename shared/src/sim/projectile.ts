import { CONFIG, type WeaponId } from '../config';
import type { Vec3 } from './geometry';

/**
 * Geschosse fliegen auf einer festen Bahn:  p(t) = o + v·t − ½·g·t²·ŷ
 * Nach dem Abschuss ändert sich nichts mehr – jeder Client kann die Kugel
 * zu jedem Zeitpunkt exakt zeichnen.
 */
export interface Projectile {
  id: number;
  ownerId: string;
  weapon: WeaponId;
  origin: Vec3;
  vel: Vec3;
  gravity: number;
  radius: number;
  /** Start-Zeitpunkt in Ticks (darf krumm sein – Lag-Kompensation) */
  spawnTime: number;
  /** Bis zu diesem Tick wurde schon geprüft */
  checkedTick: number;
  alive: boolean;
}

const DT = 1 / CONFIG.sim.hz;
/** Nach dieser Zeit verschwinden Geschosse spätestens. */
export const PROJECTILE_MAX_AGE_S = 4;

export function projectilePosAt(p: Pick<Projectile, 'origin' | 'vel' | 'gravity' | 'spawnTime'>, tickTime: number): Vec3 {
  const age = (tickTime - p.spawnTime) * DT;
  const a = age < 0 ? 0 : age;
  return {
    x: p.origin.x + p.vel.x * a,
    y: p.origin.y + p.vel.y * a - 0.5 * p.gravity * a * a,
    z: p.origin.z + p.vel.z * a,
  };
}

/** Flugzeit (s) bis zu einer bestimmten Entfernung – für Bots und Tests. */
export function flightTimeS(weapon: WeaponId, dist: number): number {
  return dist / CONFIG.weapons[weapon].speed;
}
