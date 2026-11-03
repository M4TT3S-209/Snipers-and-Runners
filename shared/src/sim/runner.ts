import { CONFIG, secondsToTicks, type GadgetId } from '../config';
import { laneX } from '../track/generator';
import { NO_GROUND, coversAhead, groundAt, holeAt, overlapsX, padAt, tripsNear, type CoverAliveFn } from '../track/query';
import type { Track } from '../track/types';

/**
 * Läufer-Bewegung – deterministisch (Server und Client-Vorhersage rechnen
 * damit exakt gleich). Nur Grundrechenarten + Math.sqrt/floor/min/max.
 */

export type RunnerAction = 'left' | 'right' | 'jump' | 'slide' | 'duckOn' | 'duckOff' | 'gadget';
export const RUNNER_ACTIONS: readonly RunnerAction[] = ['left', 'right', 'jump', 'slide', 'duckOn', 'duckOff', 'gadget'];

export type RunnerPose = 'run' | 'jump' | 'slide' | 'duck' | 'fall' | 'idle';

/** Teil des Zustands, der nur von Eingaben + Strecke abhängt (wird für späte Eingaben neu gerechnet). */
export interface RunnerMove {
  z: number;
  x: number;
  y: number;
  vy: number;
  lane: number;
  grounded: boolean;
  /** running | respawning | finished */
  phase: 'running' | 'respawning' | 'finished';
  slideTicks: number;
  slideOnLand: boolean;
  stumbleTicks: number;
  respawnTicks: number;
  coyoteTicks: number;
  jumpBufferTicks: number;
  sprintTicks: number;
  duckHeld: boolean;
  blocked: boolean;
  lastTripId: number;
  respawnZ: number;
  finishTick: number;
}

export interface RunnerState {
  id: string;
  move: RunnerMove;
  hp: number;
  out: boolean;
  outTick: number;
  timedOut: boolean;
  gadget: GadgetId | null;
  gadgetUses: number;
  shieldTicks: number;
  smokeTicks: number;
  decoyTicks: number;
  /** Spur des Köders (folgt gespiegelt) */
  decoyLane: number;
  hitsTaken: number;
}

/** Ereignisse der Bewegung (für Sound/Effekte) */
export type MoveEvent = 'jump' | 'slide' | 'land' | 'trip' | 'fall' | 'pad' | 'bonk' | 'finish' | 'respawn' | 'lane';

const R = CONFIG.runner;
const DT = 1 / CONFIG.sim.hz;
/** Schwerkraft aus Sprunghöhe und Flugzeit: g = 8h/T² */
export const GRAVITY = (8 * R.jumpHeight) / (R.jumpAirS * R.jumpAirS);
export const JUMP_VY = Math.sqrt(2 * GRAVITY * R.jumpHeight);
export const PAD_VY = Math.sqrt(2 * GRAVITY * R.padJumpHeight);
const LANE_SPEED = CONFIG.track.laneWidth / R.laneChangeS;
const SLIDE_TICKS = secondsToTicks(R.slideS);
const STUMBLE_TICKS = secondsToTicks(R.stumbleS);
const RESPAWN_TICKS = secondsToTicks(R.fallRespawnS);
const COYOTE_TICKS = secondsToTicks(R.coyoteS);
const JUMP_BUFFER_TICKS = secondsToTicks(R.jumpBufferS);

export function createRunner(id: string, gadget: GadgetId | null = null): RunnerState {
  return {
    id,
    move: {
      z: 0,
      x: laneX(1),
      y: 0,
      vy: 0,
      lane: 1,
      grounded: true,
      phase: 'running',
      slideTicks: 0,
      slideOnLand: false,
      stumbleTicks: 0,
      respawnTicks: 0,
      coyoteTicks: 0,
      jumpBufferTicks: 0,
      sprintTicks: 0,
      duckHeld: false,
      blocked: false,
      lastTripId: 0,
      respawnZ: 0,
      finishTick: -1,
    },
    hp: CONFIG.runner.hp,
    out: false,
    outTick: -1,
    timedOut: false,
    gadget,
    gadgetUses: gadget ? CONFIG.gadgets.usesPerRun : 0,
    shieldTicks: 0,
    smokeTicks: 0,
    decoyTicks: 0,
    decoyLane: 1,
    hitsTaken: 0,
  };
}

export function cloneMove(m: RunnerMove): RunnerMove {
  return { ...m };
}

/** Ist der Läufer noch im Rennen (bewegt sich, kann getroffen werden)? */
export function isActive(r: RunnerState): boolean {
  return !r.out && !r.timedOut && r.move.phase !== 'finished';
}

export function poseOf(m: RunnerMove): RunnerPose {
  if (m.phase === 'respawning') return 'fall';
  if (m.phase === 'finished') return 'idle';
  if (m.slideTicks > 0) return 'slide';
  if (!m.grounded) return m.y < -0.3 ? 'fall' : 'jump';
  if (m.duckHeld) return 'duck';
  return 'run';
}

/** Oberkante des Körpers (inkl. Kopf) je Haltung – für Hindernisse. */
export function bodyTop(pose: RunnerPose): number {
  const hb = CONFIG.hitbox;
  switch (pose) {
    case 'duck':
      return hb.duckHeadY + hb.headR;
    case 'slide':
      return hb.slideHeadY + hb.headR;
    default:
      return hb.headY + hb.headR;
  }
}

export interface MoveContext {
  track: Track;
  tick: number;
  coverAlive: CoverAliveFn;
}

/** Wendet eine Bewegungs-Eingabe an. Gibt ggf. ein Ereignis zurück. */
export function applyMoveAction(m: RunnerMove, action: RunnerAction, ctx: MoveContext): MoveEvent | null {
  if (m.phase !== 'running') {
    if (action === 'duckOn') m.duckHeld = true;
    if (action === 'duckOff') m.duckHeld = false;
    return null;
  }
  switch (action) {
    case 'left':
    case 'right': {
      const target = m.lane + (action === 'left' ? -1 : 1);
      if (target < 0 || target > CONFIG.track.lanes - 1) return 'bonk';
      // Seitlich gegen Deckung? Dann geht der Wechsel nicht.
      const tx = laneX(target);
      for (const { cover } of coversAhead(ctx.track, tx, m.z - R.radius, m.z + R.radius, ctx.tick, ctx.coverAlive)) {
        if (cover.h > m.y + R.stepUpM && overlapsX(cover.x, cover.hw, tx)) return 'bonk';
      }
      m.lane = target;
      return 'lane';
    }
    case 'jump':
      if (m.grounded || m.coyoteTicks > 0) {
        doJump(m, JUMP_VY);
        return 'jump';
      }
      m.jumpBufferTicks = JUMP_BUFFER_TICKS;
      return null;
    case 'slide':
      if (m.grounded) {
        m.slideTicks = SLIDE_TICKS;
        return 'slide';
      }
      if (m.vy > R.airSlideVy) m.vy = R.airSlideVy;
      m.slideOnLand = true;
      return 'slide';
    case 'duckOn':
      m.duckHeld = true;
      return null;
    case 'duckOff':
      m.duckHeld = false;
      return null;
    case 'gadget':
      return null;
  }
}

function doJump(m: RunnerMove, vy: number): void {
  m.vy = vy;
  m.grounded = false;
  m.slideTicks = 0;
  m.slideOnLand = false;
  m.coyoteTicks = 0;
  m.jumpBufferTicks = 0;
}

/** Ein Simulationsschritt der Bewegung. `events` sammelt Ereignisse (optional). */
export function stepMove(m: RunnerMove, ctx: MoveContext, events?: MoveEvent[]): void {
  if (m.phase === 'finished') return;
  if (m.phase === 'respawning') {
    m.respawnTicks--;
    if (m.respawnTicks <= 0) {
      m.phase = 'running';
      m.z = m.respawnZ;
      m.x = laneX(m.lane);
      m.y = 0;
      m.vy = 0;
      m.grounded = true;
      m.slideTicks = 0;
      m.stumbleTicks = 0;
      events?.push('respawn');
    }
    return;
  }

  // Zeitgeber
  if (m.slideTicks > 0) m.slideTicks--;
  if (m.stumbleTicks > 0) m.stumbleTicks--;
  if (m.coyoteTicks > 0) m.coyoteTicks--;
  if (m.jumpBufferTicks > 0) m.jumpBufferTicks--;
  if (m.sprintTicks > 0) m.sprintTicks--;

  // Seitlich zur Ziel-Spur
  const tx = laneX(m.lane);
  const dx = tx - m.x;
  const maxStep = LANE_SPEED * DT;
  m.x += dx > maxStep ? maxStep : dx < -maxStep ? -maxStep : dx;

  // Vorwärts
  const ducking = m.duckHeld && m.grounded && m.slideTicks === 0;
  let speed = R.speed;
  if (m.sprintTicks > 0) speed *= CONFIG.gadgets.sprint.factor;
  if (m.stumbleTicks > 0) speed *= R.stumbleSpeedFactor;
  if (ducking) speed = 0;
  let newZ = m.z + speed * DT;

  // Deckung vorne blockiert (wenn man nicht drüber kommt)
  m.blocked = false;
  const front = m.z + R.radius;
  for (const { cover } of coversAhead(ctx.track, m.x, front - 0.01, newZ + R.radius, ctx.tick, ctx.coverAlive)) {
    if (cover.z0 >= front - 0.01 && m.y + R.stepUpM < cover.h) {
      const limit = cover.z0 - R.radius;
      if (newZ > limit) {
        newZ = limit > m.z ? limit : m.z;
        m.blocked = true;
      }
    }
  }
  m.z = newZ;

  // Stolperfallen (Hürden, Balken)
  const top = m.y + bodyTop(poseOf(m));
  for (const trip of tripsNear(ctx.track, m.x, m.z - R.radius, m.z + R.radius)) {
    if (trip.id !== m.lastTripId && m.y < trip.y1 && top > trip.y0) {
      m.lastTripId = trip.id;
      m.stumbleTicks = STUMBLE_TICKS;
      m.slideTicks = 0;
      events?.push('trip');
    }
  }

  // Senkrecht: Boden, Sprung, Fall
  let ground = groundAt(ctx.track, m.x, m.z, ctx.tick, ctx.coverAlive, m.y + R.stepUpM);
  if (m.grounded) {
    if (ground === NO_GROUND || ground < m.y - R.stepUpM) {
      m.grounded = false;
      m.coyoteTicks = COYOTE_TICKS;
      m.vy = 0;
    } else {
      m.y = ground;
    }
  }
  if (!m.grounded) {
    // Exakt für konstante Schwerkraft (sonst wird der Sprung zu niedrig)
    m.y += m.vy * DT - 0.5 * GRAVITY * DT * DT;
    m.vy -= GRAVITY * DT;
    ground = groundAt(ctx.track, m.x, m.z, ctx.tick, ctx.coverAlive, m.y + 0.6);
    if (ground !== NO_GROUND && m.y <= ground && m.vy <= 0) {
      m.y = ground;
      m.vy = 0;
      m.grounded = true;
      events?.push('land');
      if (m.jumpBufferTicks > 0) {
        doJump(m, JUMP_VY);
        events?.push('jump');
      } else if (m.slideOnLand) {
        m.slideOnLand = false;
        m.slideTicks = SLIDE_TICKS;
      }
    } else if (m.y < -2.5) {
      // In ein Loch gefallen → kurz warten, dann vor dem Loch neu starten
      const hole = holeAt(ctx.track, m.lane, m.z) ?? { z0: m.z, z1: m.z };
      m.phase = 'respawning';
      m.respawnTicks = RESPAWN_TICKS;
      m.respawnZ = Math.max(0, hole.z0 - 1.5);
      m.duckHeld = false;
      events?.push('fall');
      return;
    }
  }

  // Sprungpad
  if (m.grounded && m.y < 0.05 && padAt(ctx.track, m.x, m.z)) {
    doJump(m, PAD_VY);
    events?.push('pad');
  }

  // Ziel
  if (m.z >= ctx.track.length) {
    m.phase = 'finished';
    // Der Schritt führt von ctx.tick nach ctx.tick + 1
    m.finishTick = ctx.tick + 1;
    events?.push('finish');
  }
}
