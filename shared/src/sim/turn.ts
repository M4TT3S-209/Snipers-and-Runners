import { CONFIG, secondsToTicks, type GadgetId, type WeaponId } from '../config';
import { laneX } from '../track/generator';
import type { CoverDef, Track } from '../track/types';
import {
  distance3,
  hitboxAt,
  hitboxOfMove,
  length3,
  lerp3,
  pointBoxDistance,
  segmentBox,
  segmentSphere,
  sniperEye,
  type Hitbox,
  type Vec3,
} from './geometry';
import { PROJECTILE_MAX_AGE_S, projectilePosAt, type Projectile } from './projectile';
import {
  applyMoveAction,
  cloneMove,
  createRunner,
  isActive,
  poseOf,
  stepMove,
  type MoveContext,
  type MoveEvent,
  type RunnerAction,
  type RunnerMove,
  type RunnerState,
} from './runner';

/**
 * Ein Zug: Läufer laufen, Sniper schießen. Läuft identisch auf dem Server
 * (Autorität), im Offline-Modus auf dem Client und in Tests.
 *
 * Zeit: `tick` zählt ab Start des Laufs (0). Der Zustand gilt „zum Tick“.
 */

export interface SniperState {
  id: string;
  weapon: WeaponId;
  mag: number;
  /** Restmunition (-1 = unbegrenzt) */
  ammoLeft: number;
  reloadEndTick: number;
  nextShotTick: number;
  aim: Vec3;
  zoom: number;
  shots: number;
  hits: number;
  eliminations: number;
}

export type HitPart = 'head' | 'body' | 'splash';

export type TurnEvent =
  | { t: 'shot'; tick: number; sniperId: string; projectile: ProjectileInfo }
  | { t: 'hit'; tick: number; projectileId: number; sniperId: string; runnerId: string; part: HitPart; dmg: number; hpLeft: number; shielded: boolean; point: Vec3 }
  | { t: 'cover'; tick: number; coverId: number; hpLeft: number; point: Vec3 }
  | { t: 'impact'; tick: number; projectileId: number; point: Vec3; on: 'ground' | 'cover' | 'runner' | 'decoy' | 'air' }
  | { t: 'explosion'; tick: number; point: Vec3; radius: number; kind: 'rocket' | 'barrel' }
  | { t: 'decoy'; tick: number; runnerId: string; popped: boolean }
  | { t: 'out'; tick: number; runnerId: string; sniperId: string }
  | { t: 'finish'; tick: number; runnerId: string; timeTicks: number }
  | { t: 'move'; tick: number; runnerId: string; ev: MoveEvent }
  | { t: 'gadget'; tick: number; runnerId: string; gadget: GadgetId }
  | { t: 'reloaded'; tick: number; sniperId: string }
  | { t: 'end'; tick: number };

/** Was Clients über ein Geschoss wissen müssen, um es exakt zu zeichnen. */
export interface ProjectileInfo {
  id: number;
  ownerId: string;
  weapon: WeaponId;
  origin: Vec3;
  vel: Vec3;
  gravity: number;
  spawnTime: number;
}

export interface TurnSetup {
  track: Track;
  runners: ReadonlyArray<{ id: string; gadget: GadgetId | null }>;
  snipers: ReadonlyArray<{ id: string; weapon: WeaponId }>;
}

export interface RunResult {
  runnerId: string;
  finished: boolean;
  /** Laufzeit in Ticks (nur wenn im Ziel) */
  timeTicks: number | null;
  /** geschaffte Strecke in Metern */
  distance: number;
  hp: number;
  out: boolean;
  /** Ticks bis zum Ausscheiden (null = nicht ausgeschieden) */
  outTick: number | null;
  hitsTaken: number;
}

export interface SniperResult {
  sniperId: string;
  shots: number;
  hits: number;
  eliminations: number;
}

export interface TurnResult {
  runs: RunResult[];
  snipers: SniperResult[];
  ticks: number;
}

interface InputRecord {
  tick: number;
  action: RunnerAction;
}

interface HistoryEntry {
  tick: number;
  moves: RunnerMove[];
  decoyX: number[];
  decoyOn: boolean[];
}

const HISTORY_SIZE = 40;
const MAX_REWIND_TICKS = Math.round((CONFIG.net.maxRewindMs / 1000) * CONFIG.sim.hz);
const LATE_INPUT_TICKS = Math.round((CONFIG.net.lateInputToleranceMs / 1000) * CONFIG.sim.hz);
const MAX_FUTURE_TICKS = CONFIG.sim.hz; // Eingaben höchstens 1 s im Voraus

export class TurnSim {
  readonly track: Track;
  tick = 0;
  readonly maxTicks: number;
  readonly runners: RunnerState[];
  readonly snipers: SniperState[];
  readonly projectiles: Projectile[] = [];
  readonly coverHp: number[];
  /** Tick der Zerstörung (Infinity = steht noch) */
  readonly coverDestroyedTick: number[];
  over = false;

  private nextProjectileId = 1;
  private events: TurnEvent[] = [];
  private readonly history: HistoryEntry[] = [];
  private readonly pending = new Map<number, Array<{ runner: number; action: RunnerAction }>>();
  private readonly inputLog: InputRecord[][];
  private readonly coverIndexById = new Map<number, number>();
  private readonly ctx: MoveContext;

  constructor(setup: TurnSetup) {
    this.track = setup.track;
    this.maxTicks = secondsToTicks(CONFIG.runner.maxRunS);
    this.runners = setup.runners.map((r) => createRunner(r.id, r.gadget));
    // Mehrere Läufer: leicht versetzte Startspuren, damit man sich sieht
    this.runners.forEach((r, i) => {
      const lane = this.runners.length === 1 ? 1 : i % CONFIG.track.lanes;
      r.move.lane = lane;
      r.move.x = laneX(lane);
    });
    this.inputLog = this.runners.map(() => []);
    this.snipers = setup.snipers.map((s) => {
      const w = CONFIG.weapons[s.weapon];
      return {
        id: s.id,
        weapon: s.weapon,
        mag: w.magSize,
        ammoLeft: w.totalAmmo > 0 ? w.totalAmmo : -1,
        reloadEndTick: 0,
        nextShotTick: 0,
        aim: { x: 0, y: -0.1, z: -1 },
        zoom: 0,
        shots: 0,
        hits: 0,
        eliminations: 0,
      };
    });
    this.coverHp = this.track.covers.map((c) => c.hp);
    this.coverDestroyedTick = this.track.covers.map(() => Infinity);
    this.track.covers.forEach((c, i) => this.coverIndexById.set(c.id, i));
    this.ctx = { track: this.track, tick: 0, coverAlive: this.coverAlive };
    this.record();
  }

  readonly coverAlive = (_c: CoverDef, index: number, tick: number): boolean => this.coverDestroyedTick[index]! > tick;

  runner(id: string): RunnerState | undefined {
    return this.runners.find((r) => r.id === id);
  }

  sniper(id: string): SniperState | undefined {
    return this.snipers.find((s) => s.id === id);
  }

  drainEvents(): TurnEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- Eingaben

  /**
   * Läufer-Eingabe. `atTick` = Tick, zu dem der Client sie ausgeführt hat.
   * Zukunft → wird zu diesem Tick angewendet. Leicht verspätet → rückwirkend
   * eingerechnet. Stark verspätet → ab jetzt.
   */
  queueRunnerAction(runnerId: string, action: RunnerAction, atTick?: number): void {
    const index = this.runners.findIndex((r) => r.id === runnerId);
    if (index < 0 || this.over) return;
    const r = this.runners[index]!;
    if (!isActive(r)) return;
    let t = atTick ?? this.tick;
    if (t > this.tick + MAX_FUTURE_TICKS) t = this.tick + MAX_FUTURE_TICKS;
    if (t >= this.tick) {
      const list = this.pending.get(t) ?? [];
      list.push({ runner: index, action });
      this.pending.set(t, list);
      return;
    }
    if (action !== 'gadget' && this.tick - t <= LATE_INPUT_TICKS && this.rewindRunner(index, action, t)) return;
    const list = this.pending.get(this.tick) ?? [];
    list.push({ runner: index, action });
    this.pending.set(this.tick, list);
  }

  setAim(sniperId: string, dir: Vec3, zoom: number): void {
    const s = this.sniper(sniperId);
    if (!s) return;
    const d = sanitizeDir(dir);
    if (d) s.aim = d;
    s.zoom = Math.max(0, Math.min(CONFIG.scope.fovs.length - 1, Math.round(zoom)));
  }

  /** Kann der Sniper gerade schießen? */
  canFire(s: SniperState): boolean {
    return !this.over && this.tick >= s.nextShotTick && s.reloadEndTick === 0 && s.mag > 0 && s.ammoLeft !== 0;
  }

  /**
   * Schuss. `viewTick` = Zeitpunkt, den der Sniper gesehen hat (Lag-
   * Kompensation, höchstens maxRewindMs zurück).
   */
  fire(sniperId: string, dir: Vec3, viewTick?: number): ProjectileInfo | null {
    const s = this.sniper(sniperId);
    const d = sanitizeDir(dir);
    if (!s || !d || !this.canFire(s)) return null;
    const w = CONFIG.weapons[s.weapon];

    s.mag--;
    if (s.ammoLeft > 0) s.ammoLeft--;
    s.shots++;
    s.aim = d;
    s.nextShotTick = this.tick + secondsToTicks(w.fireIntervalS);
    if (s.mag <= 0 && s.ammoLeft !== 0) s.reloadEndTick = this.tick + secondsToTicks(w.reloadS);

    let spawn = viewTick ?? this.tick;
    if (!Number.isFinite(spawn)) spawn = this.tick;
    if (spawn > this.tick) spawn = this.tick;
    if (spawn < this.tick - MAX_REWIND_TICKS) spawn = this.tick - MAX_REWIND_TICKS;
    if (spawn < 0) spawn = 0;

    const p: Projectile = {
      id: this.nextProjectileId++,
      ownerId: s.id,
      weapon: s.weapon,
      origin: sniperEye(this.track),
      vel: { x: d.x * w.speed, y: d.y * w.speed, z: d.z * w.speed },
      gravity: w.gravity,
      radius: w.radius,
      spawnTime: spawn,
      checkedTick: spawn,
      alive: true,
    };
    this.projectiles.push(p);
    const info = projectileInfo(p);
    this.events.push({ t: 'shot', tick: this.tick, sniperId: s.id, projectile: info });
    // Rückwirkend bis jetzt prüfen (gegen den Verlauf)
    this.advanceProjectile(p, this.tick);
    return info;
  }

  // ---------------------------------------------------------------- Schritt

  step(): void {
    if (this.over) return;
    const t = this.tick;
    this.ctx.tick = t;

    // Eingaben für diesen Tick
    const inputs = this.pending.get(t);
    if (inputs) {
      this.pending.delete(t);
      for (const { runner, action } of inputs) this.applyAction(runner, action, t);
    }

    // Bewegung
    const moveEvents: MoveEvent[] = [];
    this.runners.forEach((r) => {
      if (!isActive(r)) return;
      moveEvents.length = 0;
      stepMove(r.move, this.ctx, moveEvents);
      this.tickEffects(r);
      for (const ev of moveEvents) {
        this.events.push({ t: 'move', tick: t + 1, runnerId: r.id, ev });
        if (ev === 'finish') this.events.push({ t: 'finish', tick: t + 1, runnerId: r.id, timeTicks: r.move.finishTick });
      }
    });

    this.tick = t + 1;
    this.ctx.tick = this.tick;

    // Nachladen
    for (const s of this.snipers) {
      if (s.reloadEndTick > 0 && this.tick >= s.reloadEndTick) {
        const w = CONFIG.weapons[s.weapon];
        s.mag = s.ammoLeft < 0 ? w.magSize : Math.min(w.magSize, s.ammoLeft);
        s.reloadEndTick = 0;
        this.events.push({ t: 'reloaded', tick: this.tick, sniperId: s.id });
      }
    }

    this.record();

    // Geschosse
    for (const p of this.projectiles) if (p.alive) this.advanceProjectile(p, this.tick);
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i]!.alive) this.projectiles.splice(i, 1);

    // Ende?
    if (this.tick >= this.maxTicks) {
      for (const r of this.runners) if (isActive(r)) r.timedOut = true;
    }
    if (this.runners.every((r) => !isActive(r))) {
      this.over = true;
      this.events.push({ t: 'end', tick: this.tick });
    }
  }

  results(): TurnResult {
    return {
      ticks: this.tick,
      runs: this.runners.map((r) => ({
        runnerId: r.id,
        finished: r.move.phase === 'finished' && !r.out,
        timeTicks: r.move.phase === 'finished' && !r.out ? r.move.finishTick : null,
        distance: Math.max(0, Math.min(this.track.length, r.move.z)),
        hp: r.hp,
        out: r.out,
        outTick: r.out ? r.outTick : null,
        hitsTaken: r.hitsTaken,
      })),
      snipers: this.snipers.map((s) => ({ sniperId: s.id, shots: s.shots, hits: s.hits, eliminations: s.eliminations })),
    };
  }

  /** Läufer-Position (bzw. Köder) zu einem vergangenen Tick – für Lag-Kompensation. */
  hitboxesAt(tick: number): Array<{ index: number; box: Hitbox | null; decoy: Hitbox | null }> {
    const entry = this.historyAt(tick);
    return this.runners.map((r, i) => {
      const move = entry?.moves[i] ?? r.move;
      const usable = !r.out && move.phase === 'running' && (r.outTick < 0 || r.outTick > tick);
      const box = usable ? hitboxOfMove(move) : null;
      const decoyOn = entry ? entry.decoyOn[i]! : r.decoyTicks > 0;
      const decoyX = entry ? entry.decoyX[i]! : laneX(r.decoyLane);
      const decoy = usable && decoyOn ? hitboxAt(decoyX, move.y, move.z, poseOf(move)) : null;
      return { index: i, box, decoy };
    });
  }

  // ---------------------------------------------------------------- intern

  private applyAction(index: number, action: RunnerAction, tick: number): void {
    const r = this.runners[index]!;
    if (!isActive(r)) return;
    if (action === 'gadget') {
      this.useGadget(r, tick);
      this.inputLog[index]!.push({ tick, action });
      return;
    }
    const ev = applyMoveAction(r.move, action, this.ctx);
    this.inputLog[index]!.push({ tick, action });
    if (ev) this.events.push({ t: 'move', tick, runnerId: r.id, ev });
  }

  private useGadget(r: RunnerState, tick: number): void {
    if (!r.gadget || r.gadgetUses <= 0) return;
    r.gadgetUses--;
    const g = CONFIG.gadgets;
    switch (r.gadget) {
      case 'smoke':
        r.smokeTicks = secondsToTicks(g.smoke.durationS);
        break;
      case 'shield':
        r.shieldTicks = secondsToTicks(g.shield.durationS);
        break;
      case 'sprint':
        r.move.sprintTicks = secondsToTicks(g.sprint.durationS);
        break;
      case 'decoy': {
        r.decoyTicks = secondsToTicks(g.decoy.durationS);
        const lane = r.move.lane;
        r.decoyLane = lane === 0 ? 2 : lane === 2 ? 0 : tick % 2 === 0 ? 0 : 2;
        break;
      }
    }
    this.events.push({ t: 'gadget', tick, runnerId: r.id, gadget: r.gadget });
  }

  private tickEffects(r: RunnerState): void {
    if (r.shieldTicks > 0) r.shieldTicks--;
    if (r.smokeTicks > 0) r.smokeTicks--;
    if (r.decoyTicks > 0) {
      r.decoyTicks--;
      // Köder hält Abstand zur echten Figur (gespiegelte Seite)
      if (r.decoyLane === r.move.lane) r.decoyLane = r.move.lane === 0 ? 2 : 0;
    }
  }

  private record(): void {
    const entry: HistoryEntry = {
      tick: this.tick,
      moves: this.runners.map((r) => cloneMove(r.move)),
      decoyX: this.runners.map((r) => laneX(r.decoyLane)),
      decoyOn: this.runners.map((r) => r.decoyTicks > 0),
    };
    this.history.push(entry);
    if (this.history.length > HISTORY_SIZE) this.history.shift();
    const oldest = this.tick - HISTORY_SIZE;
    for (const log of this.inputLog) {
      while (log.length > 0 && log[0]!.tick < oldest) log.shift();
    }
  }

  private historyAt(tick: number): HistoryEntry | undefined {
    const first = this.history[0];
    if (!first) return undefined;
    const idx = tick - first.tick;
    const e = this.history[idx];
    return e && e.tick === tick ? e : this.history.find((h) => h.tick === tick);
  }

  /** Späte Eingabe rückwirkend einrechnen. */
  private rewindRunner(index: number, action: RunnerAction, atTick: number): boolean {
    const start = this.historyAt(atTick);
    if (!start) return false;
    const r = this.runners[index]!;
    const log = this.inputLog[index]!;
    log.push({ tick: atTick, action });
    log.sort((a, b) => a.tick - b.tick);

    const move = cloneMove(start.moves[index]!);
    const ctx: MoveContext = { track: this.track, tick: atTick, coverAlive: this.coverAlive };
    for (let t = atTick; t < this.tick; t++) {
      ctx.tick = t;
      for (const rec of log) {
        if (rec.tick !== t) continue;
        if (rec.action === 'gadget') {
          if (r.gadget === 'sprint') move.sprintTicks = secondsToTicks(CONFIG.gadgets.sprint.durationS);
        } else {
          applyMoveAction(move, rec.action, ctx);
        }
      }
      if (r.out && r.outTick <= t) break;
      const wasFinished = move.phase === 'finished';
      stepMove(move, ctx);
      if (!wasFinished && move.phase === 'finished' && r.move.phase !== 'finished') {
        this.events.push({ t: 'finish', tick: t + 1, runnerId: r.id, timeTicks: t + 1 });
      }
      const h = this.historyAt(t + 1);
      if (h) h.moves[index] = cloneMove(move);
    }
    r.move = move;
    return true;
  }

  /** Prüft ein Geschoss Tick für Tick bis `toTick`. */
  private advanceProjectile(p: Projectile, toTick: number): void {
    const w = CONFIG.weapons[p.weapon];
    let t = Math.floor(p.checkedTick) + 1;
    let prevTime = p.checkedTick;
    for (; t <= toTick && p.alive; t++) {
      const a = projectilePosAt(p, prevTime);
      const b = projectilePosAt(p, t);
      this.collideSegment(p, a, b, t, w.splashR);
      prevTime = t;
      p.checkedTick = t;
      if ((t - p.spawnTime) / CONFIG.sim.hz > PROJECTILE_MAX_AGE_S || b.z < -20 || b.y < -5 || Math.abs(b.x) > 60) {
        if (p.alive) this.endProjectile(p, b, t, 'air', w.splashR);
      }
    }
  }

  private collideSegment(p: Projectile, a: Vec3, b: Vec3, tick: number, splashR: number): void {
    const pr = p.radius;
    let best = 2;
    let kind: 'cover' | 'runner-head' | 'runner-body' | 'decoy' | 'ground' | null = null;
    let target = -1;

    // Deckung
    const covers = this.track.covers;
    for (let i = 0; i < covers.length; i++) {
      if (this.coverDestroyedTick[i]! <= tick) continue;
      const c = covers[i]!;
      const s = segmentBox(a, b, { x: c.x - c.hw - pr, y: -pr, z: c.z0 - pr }, { x: c.x + c.hw + pr, y: c.h + pr, z: c.z1 + pr });
      if (s >= 0 && s < best) {
        best = s;
        kind = 'cover';
        target = i;
      }
    }

    // Läufer (und Köder) zum Zeitpunkt `tick`
    for (const { index, box, decoy } of this.hitboxesAt(tick)) {
      if (box) {
        const sh = segmentSphere(a, b, box.head, box.headR + pr);
        if (sh >= 0 && sh < best) {
          best = sh;
          kind = 'runner-head';
          target = index;
        }
        const sb = segmentBox(a, b, expand(box.min, -pr), expand(box.max, pr));
        if (sb >= 0 && sb < best - 1e-9) {
          best = sb;
          kind = 'runner-body';
          target = index;
        }
      }
      if (decoy) {
        const sd = firstHit(
          segmentSphere(a, b, decoy.head, decoy.headR + pr),
          segmentBox(a, b, expand(decoy.min, -pr), expand(decoy.max, pr)),
        );
        if (sd >= 0 && sd < best) {
          best = sd;
          kind = 'decoy';
          target = index;
        }
      }
    }

    // Boden
    if (b.y <= 0 && a.y > 0) {
      const s = a.y / (a.y - b.y);
      if (s < best) {
        best = s;
        kind = 'ground';
      }
    }

    if (kind === null) return;
    const point = lerp3(a, b, best);
    const w = CONFIG.weapons[p.weapon];

    switch (kind) {
      case 'cover':
        this.damageCover(target, w.coverDmg, point, tick, p.ownerId);
        this.endProjectile(p, point, tick, 'cover', splashR);
        break;
      case 'runner-head':
      case 'runner-body': {
        const part: HitPart = kind === 'runner-head' ? 'head' : 'body';
        this.damageRunner(target, part === 'head' ? w.dmgHead : w.dmgBody, part, p, point, tick);
        this.endProjectile(p, point, tick, 'runner', splashR, target);
        break;
      }
      case 'decoy': {
        const r = this.runners[target]!;
        r.decoyTicks = 0;
        this.events.push({ t: 'decoy', tick, runnerId: r.id, popped: true });
        this.endProjectile(p, point, tick, 'decoy', splashR);
        break;
      }
      case 'ground':
        this.endProjectile(p, point, tick, 'ground', splashR);
        break;
    }
  }

  private endProjectile(
    p: Projectile,
    point: Vec3,
    tick: number,
    on: 'ground' | 'cover' | 'runner' | 'decoy' | 'air',
    splashR: number,
    directRunner = -1,
  ): void {
    p.alive = false;
    this.events.push({ t: 'impact', tick, projectileId: p.id, point, on });
    if (splashR > 0 && on !== 'air') this.explode(point, splashR, tick, p, directRunner);
  }

  private explode(point: Vec3, radius: number, tick: number, p: Projectile, directRunner: number): void {
    const w = CONFIG.weapons[p.weapon];
    this.events.push({ t: 'explosion', tick, point, radius, kind: 'rocket' });
    for (const { index, box, decoy } of this.hitboxesAt(tick)) {
      if (box && index !== directRunner && pointBoxDistance(point, box.min, box.max) <= radius) {
        this.damageRunner(index, w.splashDmg, 'splash', p, point, tick);
      }
      if (decoy && pointBoxDistance(point, decoy.min, decoy.max) <= radius) {
        const r = this.runners[index]!;
        r.decoyTicks = 0;
        this.events.push({ t: 'decoy', tick, runnerId: r.id, popped: true });
      }
    }
    this.track.covers.forEach((c, i) => {
      if (this.coverDestroyedTick[i]! <= tick) return;
      const d = pointBoxDistance(point, { x: c.x - c.hw, y: 0, z: c.z0 }, { x: c.x + c.hw, y: c.h, z: c.z1 });
      if (d <= radius) this.damageCover(i, w.coverDmg, point, tick, p.ownerId);
    });
  }

  private damageCover(index: number, dmg: number, point: Vec3, tick: number, _by: string, depth = 0): void {
    if (this.coverDestroyedTick[index]! <= tick) return;
    const hp = Math.max(0, this.coverHp[index]! - dmg);
    this.coverHp[index] = hp;
    const c = this.track.covers[index]!;
    this.events.push({ t: 'cover', tick, coverId: c.id, hpLeft: hp, point });
    if (hp > 0) return;
    this.coverDestroyedTick[index] = tick;
    // Fässer platzen und beschädigen Deckung in der Nähe (nie Läufer)
    if (c.kind === 'barrel' && depth < 4) {
      const center: Vec3 = { x: c.x, y: c.h / 2, z: (c.z0 + c.z1) / 2 };
      const radius = CONFIG.cover.barrelSplashR;
      this.events.push({ t: 'explosion', tick, point: center, radius, kind: 'barrel' });
      this.track.covers.forEach((o, i) => {
        if (i === index || this.coverDestroyedTick[i]! <= tick) return;
        const d = pointBoxDistance(center, { x: o.x - o.hw, y: 0, z: o.z0 }, { x: o.x + o.hw, y: o.h, z: o.z1 });
        if (d <= radius) this.damageCover(i, 1, center, tick, _by, depth + 1);
      });
    }
  }

  private damageRunner(index: number, dmg: number, part: HitPart, p: Projectile, point: Vec3, tick: number): void {
    const r = this.runners[index]!;
    if (!isActive(r)) return;
    const s = this.sniper(p.ownerId);
    if (r.shieldTicks > 0) {
      r.shieldTicks = 0;
      this.events.push({ t: 'hit', tick, projectileId: p.id, sniperId: p.ownerId, runnerId: r.id, part, dmg: 0, hpLeft: r.hp, shielded: true, point });
      return;
    }
    r.hp = Math.max(0, r.hp - dmg);
    r.hitsTaken++;
    if (s) s.hits++;
    this.events.push({ t: 'hit', tick, projectileId: p.id, sniperId: p.ownerId, runnerId: r.id, part, dmg, hpLeft: r.hp, shielded: false, point });
    if (r.hp <= 0) {
      r.out = true;
      r.outTick = this.tick;
      r.move.duckHeld = false;
      if (s) s.eliminations++;
      this.events.push({ t: 'out', tick: this.tick, runnerId: r.id, sniperId: p.ownerId });
    }
  }

  /** Index einer Deckung über ihre ID */
  coverIndex(id: number): number {
    return this.coverIndexById.get(id) ?? -1;
  }
}

/** Kleinster nicht-negativer Wert (-1 = kein Treffer) */
function firstHit(a: number, b: number): number {
  if (a < 0) return b;
  if (b < 0) return a;
  return a < b ? a : b;
}

function expand(v: Vec3, d: number): Vec3 {
  return { x: v.x + d, y: v.y + d, z: v.z + d };
}

/** Prüft und normiert eine Zielrichtung (muss Richtung Strecke zeigen). */
export function sanitizeDir(dir: Vec3): Vec3 | null {
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z)) return null;
  const l = length3(dir);
  if (l < 0.5 || l > 1.5) return null;
  const d = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
  if (d.z > -0.2) return null;
  return d;
}

export function projectileInfo(p: Projectile): ProjectileInfo {
  return {
    id: p.id,
    ownerId: p.ownerId,
    weapon: p.weapon,
    origin: p.origin,
    vel: p.vel,
    gravity: p.gravity,
    spawnTime: p.spawnTime,
  };
}

/** Abstand eines Punkts zum Läufer – praktisch für Effekte („Kugel zischt vorbei“). */
export function distanceToRunner(point: Vec3, m: RunnerMove): number {
  return distance3(point, { x: m.x, y: m.y + 1, z: m.z });
}
