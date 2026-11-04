import { CONFIG, secondsToTicks, type GadgetId, type WeaponId } from '../config';
import { Rng, hashString } from '../math/rng';
import { THEMES, generateTrack } from '../track/generator';
import type { ThemeId, Track } from '../track/types';
import { TurnSim, type TurnEvent, type TurnResult } from '../sim/turn';
import { classicPoints, roundWinner, sniperCount } from './scoring';

/**
 * Ablauf eines ganzen Matches – für Duell (Best of 3, Rollentausch) und
 * Party „Klassik“ (Sniper-Rolle rotiert). Läuft auf dem Server (RoomDO)
 * und offline auf dem Client, Tick für Tick.
 */

export type MatchMode = 'duel' | 'classic';
export type MatchPhase = 'loadout' | 'countdown' | 'running' | 'turnResult' | 'roundResult' | 'matchResult';

export interface MatchPlayer {
  id: string;
  name: string;
}

export interface Loadout {
  weapon: WeaponId;
  gadget: GadgetId | null;
}

export interface TurnPlan {
  index: number;
  round: number;
  turnInRound: number;
  runnerIds: string[];
  sniperIds: string[];
  seed: number;
  theme: ThemeId;
}

export interface TurnRecord {
  plan: TurnPlan;
  result: TurnResult;
  /** Duell: Gewinner der Runde (nur beim 2. Zug einer Runde gesetzt) */
  roundWinnerId?: string | null;
  points?: Record<string, number>;
}

export type MatchEvent =
  | { t: 'phase'; phase: MatchPhase; endsAtTick: number; plan: TurnPlan | null }
  | { t: 'turn'; ev: TurnEvent }
  | { t: 'roundEnd'; round: number; winnerId: string | null }
  | { t: 'matchEnd'; winnerId: string | null; draw: boolean };

export interface MatchOptions {
  mode: MatchMode;
  players: MatchPlayer[];
  seed: number;
  /** Erlaubte Themen (Freischaltungen) */
  themes?: readonly ThemeId[];
  /** Erlaubte Ausrüstung je Spieler (Standard: alles) */
  allowedWeapons?: readonly WeaponId[];
  allowedGadgets?: readonly GadgetId[];
  /** Phasenzeiten überschreiben (z. B. Übungsmodus ohne Wartezeiten) */
  loadoutS?: number;
  /** Übungsmodus: nur ein Zug, danach Ergebnis */
  singleTurn?: boolean;
}

export const DEFAULT_LOADOUT: Loadout = { weapon: 'precision', gadget: null };

export class MatchFlow {
  readonly mode: MatchMode;
  readonly players: MatchPlayer[];
  readonly seed: number;
  phase: MatchPhase = 'loadout';
  /** Tick-Zähler für das ganze Match */
  matchTick = 0;
  phaseEndsAt = 0;
  plan: TurnPlan;
  track: Track;
  turn: TurnSim | null = null;
  readonly records: TurnRecord[] = [];
  readonly roundWins = new Map<string, number>();
  readonly scores = new Map<string, number>();
  readonly loadouts = new Map<string, Loadout>();
  readonly ready = new Set<string>();
  winnerId: string | null = null;
  draw = false;
  paused = false;

  private readonly plans: TurnPlan[] = [];
  private events: MatchEvent[] = [];
  private readonly themes: readonly ThemeId[];
  private readonly loadoutTicks: number;
  private readonly singleTurn: boolean;

  constructor(opts: MatchOptions) {
    if (opts.players.length < 2) throw new Error('Mindestens 2 Spieler');
    this.mode = opts.mode;
    this.players = opts.players;
    this.seed = opts.seed >>> 0;
    this.themes = opts.themes && opts.themes.length > 0 ? opts.themes : THEMES;
    this.loadoutTicks = secondsToTicks(opts.loadoutS ?? CONFIG.match.loadoutS);
    this.singleTurn = opts.singleTurn ?? false;
    for (const p of this.players) {
      this.roundWins.set(p.id, 0);
      this.scores.set(p.id, 0);
      this.loadouts.set(p.id, { ...DEFAULT_LOADOUT });
    }
    this.buildInitialPlans();
    this.plan = this.plans[0]!;
    this.track = this.trackFor(this.plan);
    this.enter('loadout', this.loadoutTicks);
  }

  drainEvents(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  roleOf(playerId: string): 'runner' | 'sniper' | 'none' {
    if (this.plan.runnerIds.includes(playerId)) return 'runner';
    if (this.plan.sniperIds.includes(playerId)) return 'sniper';
    return 'none';
  }

  setLoadout(playerId: string, choice: Partial<Loadout>, markReady = true): void {
    if (this.phase !== 'loadout') return;
    const current = this.loadouts.get(playerId);
    if (!current) return;
    if (choice.weapon && choice.weapon in CONFIG.weapons) current.weapon = choice.weapon;
    if (choice.gadget !== undefined) current.gadget = choice.gadget;
    if (markReady) this.ready.add(playerId);
    const involved = [...this.plan.runnerIds, ...this.plan.sniperIds];
    if (involved.every((id) => this.ready.has(id))) {
      // Alle haben gewählt → nicht länger warten
      this.phaseEndsAt = Math.min(this.phaseEndsAt, this.matchTick + secondsToTicks(0.4));
    }
  }

  /** Aufgabe/Abbruch: Der andere Spieler gewinnt kampflos. */
  forfeit(loserId: string): void {
    if (this.phase === 'matchResult') return;
    const winner = this.players.find((p) => p.id !== loserId);
    this.paused = false;
    this.winnerId = winner?.id ?? null;
    this.draw = this.winnerId === null;
    this.turn = null;
    this.enter('matchResult', 0);
    this.events.push({ t: 'matchEnd', winnerId: this.winnerId, draw: this.draw });
  }

  /** Ein Tick. */
  step(): void {
    if (this.paused || this.phase === 'matchResult') return;
    this.matchTick++;

    if (this.phase === 'running' && this.turn) {
      this.turn.step();
      for (const ev of this.turn.drainEvents()) this.events.push({ t: 'turn', ev });
      if (this.turn.over) this.finishTurn();
      return;
    }

    if (this.matchTick < this.phaseEndsAt) return;

    switch (this.phase) {
      case 'loadout':
        this.startCountdown();
        break;
      case 'countdown':
        this.enter('running', 0);
        break;
      case 'turnResult':
        this.afterTurnResult();
        break;
      case 'roundResult':
        this.nextTurn();
        break;
      default:
        break;
    }
  }

  // ----------------------------------------------------------------------

  private enter(phase: MatchPhase, durationTicks: number): void {
    this.phase = phase;
    this.phaseEndsAt = this.matchTick + durationTicks;
    this.events.push({ t: 'phase', phase, endsAtTick: this.phaseEndsAt, plan: phase === 'matchResult' ? null : this.plan });
  }

  private startCountdown(): void {
    this.turn = new TurnSim({
      track: this.track,
      runners: this.plan.runnerIds.map((id) => ({ id, gadget: this.loadouts.get(id)?.gadget ?? null })),
      snipers: this.plan.sniperIds.map((id) => ({ id, weapon: this.loadouts.get(id)?.weapon ?? 'precision' })),
    });
    this.enter('countdown', secondsToTicks(CONFIG.match.countdownS));
  }

  private finishTurn(): void {
    if (!this.turn) return;
    const result = this.turn.results();
    const record: TurnRecord = { plan: this.plan, result };
    if (this.mode === 'classic') {
      const pts = classicPoints(result);
      record.points = Object.fromEntries(pts);
      for (const [id, p] of pts) this.scores.set(id, (this.scores.get(id) ?? 0) + p);
    }
    this.records.push(record);
    this.enter('turnResult', secondsToTicks(CONFIG.match.turnResultS));
  }

  private afterTurnResult(): void {
    if (this.singleTurn) {
      this.endMatch();
      return;
    }
    if (this.mode === 'duel' && this.plan.turnInRound === 1) {
      const [a, b] = this.records.slice(-2);
      const runA = a?.result.runs[0];
      const runB = b?.result.runs[0];
      let winnerId: string | null = null;
      if (runA && runB) {
        const w = roundWinner(runA, runB);
        winnerId = w === 0 ? runA.runnerId : w === 1 ? runB.runnerId : null;
      }
      if (b) b.roundWinnerId = winnerId;
      if (winnerId) this.roundWins.set(winnerId, (this.roundWins.get(winnerId) ?? 0) + 1);
      this.events.push({ t: 'roundEnd', round: this.plan.round, winnerId });

      const leader = [...this.roundWins.entries()].sort((x, y) => y[1] - x[1])[0];
      const roundsPlayed = this.plan.round + 1;
      if ((leader && leader[1] >= CONFIG.match.roundsToWin) || roundsPlayed >= CONFIG.match.maxRounds) {
        this.endMatch();
        return;
      }
      this.enter('roundResult', secondsToTicks(CONFIG.match.roundResultS));
      return;
    }
    if (this.mode === 'classic' && this.plan.index >= this.plans.length - 1) {
      this.endMatch();
      return;
    }
    this.nextTurn();
  }

  private nextTurn(): void {
    const nextIndex = this.plan.index + 1;
    if (!this.plans[nextIndex]) this.plans.push(this.makeDuelPlan(nextIndex));
    this.plan = this.plans[nextIndex]!;
    this.track = this.trackFor(this.plan);
    this.turn = null;
    this.ready.clear();
    this.enter('loadout', this.loadoutTicks);
  }

  private endMatch(): void {
    const table = this.mode === 'duel' ? this.roundWins : this.scores;
    const sorted = [...table.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const second = sorted[1];
    this.draw = !top || (second !== undefined && second[1] === top[1]);
    this.winnerId = this.draw || !top ? null : top[0];
    this.turn = null;
    this.enter('matchResult', 0);
    this.events.push({ t: 'matchEnd', winnerId: this.winnerId, draw: this.draw });
  }

  private buildInitialPlans(): void {
    if (this.mode === 'duel') {
      this.plans.push(this.makeDuelPlan(0));
      return;
    }
    // Klassik: jeder ist einmal Sniper (bei 2 Snipern paarweise)
    const n = this.players.length;
    const sCount = sniperCount(n);
    const turns = Math.ceil(n / sCount);
    const order = [...this.players];
    for (let i = 0; i < turns; i++) {
      const snipers: string[] = [];
      for (let k = 0; k < sCount; k++) snipers.push(order[(i * sCount + k) % n]!.id);
      const runners = order.map((p) => p.id).filter((id) => !snipers.includes(id));
      this.plans.push({
        index: i,
        round: i,
        turnInRound: 0,
        runnerIds: runners,
        sniperIds: snipers,
        seed: hashString(`${this.seed}:t${i}`),
        theme: this.pickTheme(i),
      });
    }
  }

  /** Duell: Runde r, Zug 0/1. Wer zuerst läuft, wechselt pro Runde; Runde 3+ per Münzwurf. */
  private makeDuelPlan(index: number): TurnPlan {
    const round = Math.floor(index / 2);
    const turnInRound = index % 2;
    const [p0, p1] = [this.players[0]!.id, this.players[1]!.id];
    let firstRunner: string;
    if (round < 2) firstRunner = round === 0 ? p0 : p1;
    else firstRunner = new Rng(hashString(`${this.seed}:coin${round}`)).int(0, 1) === 0 ? p0 : p1;
    const secondRunner = firstRunner === p0 ? p1 : p0;
    const runner = turnInRound === 0 ? firstRunner : secondRunner;
    const sniper = runner === p0 ? p1 : p0;
    return {
      index,
      round,
      turnInRound,
      runnerIds: [runner],
      sniperIds: [sniper],
      // Beide Züge einer Runde: gleiche Strecke
      seed: hashString(`${this.seed}:r${round}`),
      theme: this.pickTheme(round),
    };
  }

  private pickTheme(i: number): ThemeId {
    const rng = new Rng(hashString(`${this.seed}:theme${i}`));
    return this.themes[rng.int(0, this.themes.length - 1)] ?? 'meadow';
  }

  private trackFor(plan: TurnPlan): Track {
    return generateTrack({ seed: plan.seed, theme: plan.theme });
  }

  /** Wie viele Züge hat das Match (Duell: unbekannt → null) */
  get plannedTurns(): number | null {
    return this.mode === 'classic' ? this.plans.length : null;
  }

  /** Tick-Rest der aktuellen Phase */
  get phaseTicksLeft(): number {
    return Math.max(0, this.phaseEndsAt - this.matchTick);
  }
}
