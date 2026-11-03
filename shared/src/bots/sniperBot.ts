import { CONFIG, type BotLevel } from '../config';
import { Rng } from '../math/rng';
import { laneX } from '../track/generator';
import { coversAhead } from '../track/query';
import { normalize, sniperEye, type Vec3 } from '../sim/geometry';
import { isActive, poseOf } from '../sim/runner';
import type { TurnSim } from '../sim/turn';

/**
 * Sniper-Bot: wartet nach dem Nachladen kurz (Reaktionszeit), zoomt rein
 * (→ Glitzern für den Läufer), zielt mit Vorhalt und schießt. Je nach
 * Stufe ungenauer und mit weniger Vorhalt.
 */
export interface SniperBotOutput {
  aim: Vec3;
  zoom: number;
  fire: boolean;
}

const HZ = CONFIG.sim.hz;

export class SniperBot {
  private readonly rng: Rng;
  private readonly cfg: (typeof CONFIG.bots.sniper)['medium'];
  private state: 'wait' | 'aim' = 'wait';
  private waitUntil = 0;
  private aimStart = 0;
  private targetId: string | null = null;
  private errYaw = 0;
  private errPitch = 0;
  private aimHead = false;
  private wasReady = false;
  private lastAim: Vec3 = { x: 0, y: -0.15, z: -1 };

  constructor(
    readonly id: string,
    level: BotLevel,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.cfg = CONFIG.bots.sniper[level];
    this.waitUntil = Math.round(HZ * (1 + this.rng.next()));
  }

  think(sim: TurnSim): SniperBotOutput {
    const s = sim.sniper(this.id);
    const t = sim.tick;
    if (!s) return { aim: this.lastAim, zoom: 0, fire: false };
    const ready = sim.canFire(s);
    if (ready && !this.wasReady) this.waitUntil = Math.max(this.waitUntil, t + Math.round(this.cfg.reactionS * HZ * (0.6 + this.rng.next() * 0.8)));
    this.wasReady = ready;

    if (!ready || t < this.waitUntil) {
      this.state = 'wait';
      return { aim: this.lastAim, zoom: 0, fire: false };
    }

    const eye = sniperEye(sim.track);
    const target = this.pickTarget(sim);
    if (!target) {
      this.state = 'wait';
      return { aim: this.lastAim, zoom: 0, fire: false };
    }

    if (this.state === 'wait' || this.targetId !== target.id) {
      this.state = 'aim';
      this.aimStart = t;
      this.targetId = target.id;
      const err = this.cfg.aimErrorDeg * (Math.PI / 180);
      this.errYaw = (this.rng.next() * 2 - 1) * err;
      this.errPitch = (this.rng.next() * 2 - 1) * err;
      this.aimHead = s.weapon !== 'rocket' && this.rng.next() < this.cfg.headshotChance;
    }

    const point = this.predict(sim, target.id, eye);
    const dir = applyError(normalize({ x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z }), this.errYaw, this.errPitch);
    this.lastAim = dir;
    const zoom = 2;
    const aimTicks = Math.round(this.cfg.aimS * HZ * (s.weapon === 'semi' && s.mag < CONFIG.weapons.semi.magSize ? 0.35 : 1));
    const fire = t - this.aimStart >= aimTicks;
    if (fire) {
      this.state = 'wait';
      this.waitUntil = t + 1;
    }
    return { aim: dir, zoom, fire };
  }

  private pickTarget(sim: TurnSim): { id: string } | null {
    const visible = sim.runners.filter((r) => isActive(r) && r.move.phase === 'running' && r.smokeTicks === 0);
    if (visible.length === 0) return null;
    const current = visible.find((r) => r.id === this.targetId);
    if (current) return current;
    // Meist der, der am weitesten vorne ist
    visible.sort((a, b) => b.move.z - a.move.z);
    return this.rng.next() < 0.75 ? visible[0]! : visible[this.rng.int(0, visible.length - 1)]!;
  }

  /** Vorhalt: Wo ist der Läufer, wenn die Kugel ankommt? */
  private predict(sim: TurnSim, id: string, eye: Vec3): Vec3 {
    const r = sim.runner(id)!;
    const m = r.move;
    const s = sim.sniper(this.id)!;
    const w = CONFIG.weapons[s.weapon];
    const pose = poseOf(m);
    let speed = m.blocked || pose === 'duck' ? 0 : CONFIG.runner.speed;
    if (m.sprintTicks > 0) speed *= CONFIG.gadgets.sprint.factor;
    if (m.stumbleTicks > 0) speed *= CONFIG.runner.stumbleSpeedFactor;

    const hb = CONFIG.hitbox;
    const yOff = this.aimHead ? (pose === 'duck' ? hb.duckHeadY : hb.headY) : pose === 'duck' ? hb.duckH * 0.55 : hb.standH * 0.55;
    let p: Vec3 = { x: laneX(m.lane), y: m.y + yOff, z: m.z };

    // Rakete: auf die Deckung, hinter der sich jemand duckt – sonst auf die Füße
    if (s.weapon === 'rocket') {
      const cover = coversAhead(sim.track, m.x, m.z, m.z + 2, sim.tick, sim.coverAlive)[0]?.cover;
      if (cover && pose === 'duck') return { x: cover.x, y: cover.h * 0.8, z: cover.z0 };
      p = { ...p, y: m.y + 0.25 };
    }

    for (let i = 0; i < 3; i++) {
      const dx = p.x - eye.x;
      const dy = p.y - eye.y;
      const dz = p.z - eye.z;
      const time = Math.sqrt(dx * dx + dy * dy + dz * dz) / w.speed;
      p = { x: p.x, y: p.y, z: m.z + speed * time * this.cfg.leadSkill };
    }
    return p;
  }
}

/** Dreht eine Richtung leicht (Zielfehler). Nur für Bots – nicht deterministisch nötig. */
function applyError(d: Vec3, yaw: number, pitch: number): Vec3 {
  // seitliche und senkrechte Achse zur Blickrichtung
  const right = normalize({ x: -d.z, y: 0, z: d.x });
  const up = normalize({
    x: right.y * d.z - right.z * d.y,
    y: right.z * d.x - right.x * d.z,
    z: right.x * d.y - right.y * d.x,
  });
  const ty = Math.tan(yaw);
  const tp = Math.tan(pitch);
  return normalize({
    x: d.x + right.x * ty + up.x * tp,
    y: d.y + right.y * ty + up.y * tp,
    z: d.z + right.z * ty + up.z * tp,
  });
}
