import { CONFIG, type BotLevel } from '../config';
import { Rng } from '../math/rng';
import { laneX } from '../track/generator';
import { coversAhead, sinkerUp, tripsNear } from '../track/query';
import type { HoleDef, Track } from '../track/types';
import { isActive, type RunnerAction, type RunnerMove } from '../sim/runner';
import type { TurnSim } from '../sim/turn';

/**
 * Läufer-Bot für den Übungsmodus (und Tests: „ist jede Strecke lösbar?“).
 * Arbeitet nur mit dem öffentlichen Zustand der Simulation.
 */
const JUMPABLE_H = CONFIG.runner.jumpHeight - 0.15;
const HZ = CONFIG.sim.hz;

export class RunnerBot {
  private readonly rng: Rng;
  private readonly cfg: (typeof CONFIG.bots.runner)['medium'];
  private readonly handled = new Set<number>();
  private readonly skipped = new Set<number>();
  private delayed: Array<{ at: number; action: RunnerAction }> = [];
  private ducking = false;
  private duckUntil = 0;
  private glintSeen = false;
  private blockedSince = -1;
  private sprintAt: number;
  private waitingForSinker = false;

  constructor(
    readonly id: string,
    level: BotLevel,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.cfg = CONFIG.bots.runner[level];
    this.sprintAt = 0.3 + this.rng.next() * 0.4;
  }

  think(sim: TurnSim): RunnerAction[] {
    const out: RunnerAction[] = [];
    const t = sim.tick;
    this.delayed = this.delayed.filter((d) => {
      if (d.at <= t) {
        out.push(d.action);
        return false;
      }
      return true;
    });

    const r = sim.runner(this.id);
    if (!r || !isActive(r) || r.move.phase !== 'running') return out;
    const m = r.move;
    const track = sim.track;
    const alive = sim.coverAlive;

    // ---------- Sniper beobachten (Glitzern = gleich wird geschossen)
    const aiming = sim.snipers.some((s) => s.zoom >= CONFIG.scope.glintFromLevel && sim.canFire(s));
    const justFired = sim.snipers.some((s) => s.reloadEndTick > t || t < s.nextShotTick);
    if (aiming && !this.glintSeen) {
      this.glintSeen = true;
      const react = Math.round(this.cfg.reactionS * HZ * (0.7 + this.rng.next() * 0.6));
      if (r.gadget && r.gadgetUses > 0 && r.gadget !== 'sprint' && this.rng.next() < 0.7) {
        this.delayed.push({ at: t + react, action: 'gadget' });
      }
      const coverAhead = coversAhead(track, m.x, m.z, m.z + 4, t, alive).length > 0;
      if (coverAhead && this.rng.next() < this.cfg.duckChance) {
        this.ducking = true;
        this.duckUntil = t + Math.round(HZ * 2.5);
      } else if (this.rng.next() < this.cfg.dodgeChance) {
        const dir: RunnerAction = m.lane === 0 ? 'right' : m.lane === 2 ? 'left' : this.rng.next() < 0.5 ? 'left' : 'right';
        if (this.laneFreeNear(track, m, dir === 'left' ? m.lane - 1 : m.lane + 1, t, alive)) {
          this.delayed.push({ at: t + react, action: dir });
        }
      }
    }
    if (!aiming) this.glintSeen = false;

    // Ducken hinter Deckung, bis geschossen wurde
    if (this.ducking) {
      const shotGone = justFired && !aiming;
      if (shotGone || t > this.duckUntil) {
        this.ducking = false;
        if (m.duckHeld) out.push('duckOff');
      } else if (!m.duckHeld && (m.blocked || coversAhead(track, m.x, m.z, m.z + 1.2, t, alive).length > 0)) {
        out.push('duckOn');
        return out;
      } else if (m.duckHeld) {
        return out;
      }
    } else if (m.duckHeld && !this.waitingForSinker) {
      out.push('duckOff');
    }

    // Sprint auf freier Strecke
    if (r.gadget === 'sprint' && r.gadgetUses > 0 && m.z > track.length * this.sprintAt) {
      if (coversAhead(track, m.x, m.z, m.z + 12, t, alive).length === 0) out.push('gadget');
    }

    // ---------- Strecke vorausschauen
    const lane = m.lane;
    const lead = m.z + CONFIG.runner.radius;

    // Löcher in der eigenen Spur
    const hole = nextHole(track, lane, m.z, 12);
    if (hole) {
      const dz = hole.z0 - m.z;
      const len = hole.z1 - hole.z0;
      const sinkers = track.sinkers.filter((s) => s.lane === lane && s.z0 === hole.z0);
      const pad = track.pads.find((p) => p.z1 <= hole.z0 + 0.01 && p.z0 > m.z - 1 && hole.z0 - p.z1 < 3);
      if (pad && pad.lane !== lane) {
        this.moveToward(out, track, m, pad.lane, t, alive);
      } else if (!pad && sinkers.length > 0) {
        this.handleSinkers(out, sim, m, hole, dz);
      } else if (!pad && len <= 4.2 && dz < 1.0 && dz > 0 && !this.handled.has(hole.id)) {
        this.handled.add(hole.id);
        if (!this.mistake(hole.id)) out.push('jump');
      }
    } else if (this.waitingForSinker) {
      this.waitingForSinker = false;
      if (m.duckHeld) out.push('duckOff');
    }

    // Deckung vorne
    const covers = coversAhead(track, m.x, lead, lead + 7, t, alive).filter((c) => c.cover.z0 >= lead - 0.05);
    const first = covers[0]?.cover;
    if (first) {
      const dz = first.z0 - lead;
      const jumpable = first.h <= JUMPABLE_H && !coversAhead(track, m.x, first.z1, first.z1 + 3, t, alive).some((c) => c.cover.h > JUMPABLE_H);
      const target = this.bestLane(track, m, t, alive);
      if (!this.ducking && target !== lane && (!jumpable || this.rng.next() < 0.02)) {
        this.moveToward(out, track, m, target, t, alive);
      } else if (!this.ducking && jumpable && dz < 1.7 && dz > 0.4 && !this.handled.has(first.id)) {
        this.handled.add(first.id);
        if (!this.mistake(first.id)) out.push('jump');
      }
    }

    // Hürden und Balken
    for (const trip of tripsNear(track, m.x, lead, lead + 3)) {
      if (this.handled.has(trip.id)) continue;
      const dz = trip.z0 - lead;
      if (trip.kind === 'hurdle' && dz < 1.9 && dz > 0.6) {
        this.handled.add(trip.id);
        if (!this.mistake(trip.id)) out.push('jump');
      } else if (trip.kind === 'bar' && dz < 1.3 && dz > 0.2) {
        this.handled.add(trip.id);
        if (!this.mistake(trip.id)) out.push('slide');
      }
    }

    // Festgefahren? Dann etwas anderes versuchen.
    if (m.blocked && !this.ducking) {
      if (this.blockedSince < 0) this.blockedSince = t;
      if (t - this.blockedSince > 12) {
        const target = this.bestLane(track, m, t, alive);
        if (target !== lane) this.moveToward(out, track, m, target, t, alive);
        else out.push('jump');
        this.blockedSince = t;
      }
    } else {
      this.blockedSince = -1;
    }
    return out;
  }

  private mistake(id: number): boolean {
    if (this.skipped.has(id)) return true;
    if (this.rng.next() < this.cfg.mistakeChance) {
      this.skipped.add(id);
      return true;
    }
    return false;
  }

  private moveToward(out: RunnerAction[], track: Track, m: RunnerMove, target: number, t: number, alive: TurnSim['coverAlive']): void {
    if (target === m.lane || Math.abs(m.x - laneX(m.lane)) > 0.2) return;
    const next = target < m.lane ? m.lane - 1 : m.lane + 1;
    if (this.laneFreeNear(track, m, next, t, alive)) out.push(target < m.lane ? 'left' : 'right');
  }

  private laneFreeNear(track: Track, m: RunnerMove, lane: number, t: number, alive: TurnSim['coverAlive']): boolean {
    if (lane < 0 || lane > 2) return false;
    return coversAhead(track, laneX(lane), m.z - 0.6, m.z + 1.2, t, alive).every((c) => c.cover.h <= m.y + CONFIG.runner.stepUpM);
  }

  /** Spur mit dem meisten freien Weg (Deckung, die man nicht überspringen kann, zählt als Sperre). */
  private bestLane(track: Track, m: RunnerMove, t: number, alive: TurnSim['coverAlive']): number {
    let best = m.lane;
    let bestScore = -Infinity;
    for (let lane = 0; lane < 3; lane++) {
      const blockers = coversAhead(track, laneX(lane), m.z, m.z + 14, t, alive).filter((c) => c.cover.h > JUMPABLE_H);
      const free = blockers.length ? blockers[0]!.cover.z0 - m.z : 20;
      const holeAhead = nextHole(track, lane, m.z, 10);
      const holePenalty = holeAhead && holeAhead.z1 - holeAhead.z0 > 4.2 && !track.sinkers.some((s) => s.lane === lane && s.z0 === holeAhead.z0) ? 15 : 0;
      const score = free - Math.abs(lane - m.lane) * 1.5 - holePenalty;
      if (score > bestScore) {
        bestScore = score;
        best = lane;
      }
    }
    return best;
  }

  private handleSinkers(out: RunnerAction[], sim: TurnSim, m: RunnerMove, hole: HoleDef, dz: number): void {
    const speed = CONFIG.runner.speed;
    const t = sim.tick;
    const ok = (lane: number, extraTicks: number) => {
      const s = sim.track.sinkers.find((k) => k.lane === lane && k.z0 === hole.z0);
      if (!s) return false;
      const arrive = t + extraTicks + Math.round((Math.max(0, dz) / speed) * HZ);
      const cross = Math.round(((hole.z1 - hole.z0 + 1) / speed) * HZ);
      for (let k = 0; k <= cross; k += 3) if (!sinkerUp(s, arrive + k)) return false;
      return true;
    };
    if (ok(m.lane, 0)) {
      if (this.waitingForSinker && m.duckHeld) out.push('duckOff');
      this.waitingForSinker = false;
      return;
    }
    for (const d of [-1, 1, -2, 2]) {
      const lane = m.lane + d;
      if (lane < 0 || lane > 2) continue;
      if (ok(lane, Math.abs(d) * 10)) {
        this.moveToward(out, sim.track, m, lane, t, sim.coverAlive);
        return;
      }
    }
    // Keine Spur passt → kurz vor der Kante warten
    if (dz < 1.6 && !m.duckHeld) {
      this.waitingForSinker = true;
      out.push('duckOn');
    }
  }
}

function nextHole(track: Track, lane: number, z: number, range: number): HoleDef | null {
  for (const h of track.holes) {
    if (h.z0 > z + range) break;
    if (h.lane === lane && h.z1 > z) return h;
  }
  return null;
}
