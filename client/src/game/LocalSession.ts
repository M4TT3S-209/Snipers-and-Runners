import {
  ALL_GADGETS,
  ALL_WEAPONS,
  BotDriver,
  CONFIG,
  MatchFlow,
  cloneMove,
  poseOf,
  type BotLevel,
  type Loadout,
  type MatchMode,
  type RunnerAction,
  type RunnerMove,
  type Vec3,
} from '@scope-rush/shared';
import type { GameSession, GameView, MatchMeta, PlayerInfo, SessionEvent } from './view';
import { buildView } from './viewBuilder';

/**
 * Offline-Spiel gegen Bots. Der Client übernimmt hier selbst die Rolle des
 * Servers – mit genau derselben Simulation.
 */
export type LocalMode = 'duel' | 'classic' | 'practiceRunner' | 'practiceSniper' | 'demo';

export interface LocalOptions {
  mode: LocalMode;
  myName: string;
  botLevel: BotLevel;
  /** Anzahl Bots im Klassik-Modus */
  bots?: number;
  seed?: number;
}

const STEP_MS = 1000 / CONFIG.sim.hz;
const BOT_NAMES = ['Bot Brummi', 'Bot Flitzi', 'Bot Knalli', 'Bot Hüpfi', 'Bot Zappi', 'Bot Rolli', 'Bot Pieps'];

export class LocalSession implements GameSession {
  readonly kind = 'local' as const;
  private flow: MatchFlow;
  private driver: BotDriver;
  private readonly players: PlayerInfo[];
  private readonly listeners = new Set<(e: SessionEvent) => void>();
  private acc = 0;
  private last = -1;
  private prevMoves = new Map<string, RunnerMove>();
  private readonly myId = 'me';
  private rematchVotes = new Set<string>();

  constructor(private readonly opts: LocalOptions) {
    const me: PlayerInfo = { id: this.myId, name: opts.myName || 'Du', colorIndex: 0, isBot: false, connected: true };
    const botCount = opts.mode === 'classic' ? Math.max(2, Math.min(7, opts.bots ?? 3)) : 1;
    const bots: PlayerInfo[] = Array.from({ length: botCount }, (_, i) => ({
      id: `bot${i + 1}`,
      name: BOT_NAMES[i % BOT_NAMES.length]!,
      colorIndex: i + 1,
      isBot: true,
      connected: true,
    }));
    // Übung als Sniper: der Bot läuft im ersten (einzigen) Zug.
    // Demo (Menü-Hintergrund): zwei Bots, man schaut nur zu.
    if (opts.mode === 'demo') {
      bots.push({ id: 'bot2', name: BOT_NAMES[1]!, colorIndex: 2, isBot: true, connected: true });
      this.players = bots;
    } else {
      this.players = opts.mode === 'practiceSniper' ? [bots[0]!, me] : [me, ...bots];
    }
    const created = this.create();
    this.flow = created.flow;
    this.driver = created.driver;
  }

  private create(): { flow: MatchFlow; driver: BotDriver } {
    const practice = this.opts.mode === 'practiceRunner' || this.opts.mode === 'practiceSniper' || this.opts.mode === 'demo';
    const mode: MatchMode = this.opts.mode === 'classic' ? 'classic' : 'duel';
    const flow = new MatchFlow({
      mode,
      players: this.players.map((p) => ({ id: p.id, name: p.name })),
      seed: this.opts.seed ?? (Math.random() * 2 ** 32) >>> 0,
      singleTurn: practice,
      ...(practice ? { loadoutS: this.opts.mode === 'demo' ? 1 : 6 } : {}),
    });
    const driver = new BotDriver(
      flow,
      this.players.filter((p) => p.isBot).map((p) => ({ id: p.id, level: this.opts.botLevel })),
      (Math.random() * 2 ** 32) >>> 0,
      ALL_WEAPONS,
      [null, ...ALL_GADGETS],
    );
    this.prevMoves.clear();
    return { flow, driver };
  }

  get isDemo(): boolean {
    return this.opts.mode === 'demo';
  }

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  update(nowMs: number): void {
    if (this.last < 0) this.last = nowMs;
    // Nach App-Wechsel nicht „nachholen“ (offline einfach pausieren)
    const dt = Math.min(250, Math.max(0, nowMs - this.last));
    this.last = nowMs;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP_MS && steps < 8) {
      this.acc -= STEP_MS;
      steps++;
      this.driver.beforeStep();
      const turn = this.flow.turn;
      if (turn && this.flow.phase === 'running') {
        for (const r of turn.runners) this.prevMoves.set(r.id, cloneMove(r.move));
      }
      this.flow.step();
      for (const e of this.flow.drainEvents()) this.emit(e);
    }
    if (steps === 8) this.acc = 0;
    // Menü-Hintergrund läuft endlos
    if (this.opts.mode === 'demo' && this.flow.phase === 'matchResult') this.rematch();
  }

  view(): GameView | null {
    const alpha = this.flow.phase === 'running' ? this.acc / STEP_MS : 0;
    return buildView(this.flow, this.players, this.myId, this.prevMoves, alpha);
  }

  meta(): MatchMeta {
    const f = this.flow;
    return {
      mode: this.opts.mode === 'practiceRunner' || this.opts.mode === 'practiceSniper' ? 'practice' : f.mode,
      players: this.players,
      plan: f.plan,
      phase: f.phase,
      phaseLeftS: f.phaseTicksLeft / CONFIG.sim.hz,
      roundWins: Object.fromEntries(f.roundWins),
      scores: Object.fromEntries(f.scores),
      records: f.records,
      loadouts: Object.fromEntries(f.loadouts),
      ready: [...f.ready],
      winnerId: f.winnerId,
      draw: f.draw,
      paused: null,
      rematchVotes: [...this.rematchVotes],
      myId: this.myId,
    };
  }

  runnerAction(action: RunnerAction): void {
    const turn = this.flow.turn;
    if (!turn || this.flow.phase !== 'running') return;
    turn.queueRunnerAction(this.myId, action);
  }

  sniperAim(dir: Vec3, zoom: number): void {
    this.flow.turn?.setAim(this.myId, dir, zoom);
  }

  sniperFire(dir: Vec3): void {
    if (this.flow.phase !== 'running') return;
    this.flow.turn?.fire(this.myId, dir);
  }

  setLoadout(choice: Partial<Loadout>, ready: boolean): void {
    this.flow.setLoadout(this.myId, choice, ready);
  }

  rematch(): void {
    const created = this.create();
    this.flow = created.flow;
    this.driver = created.driver;
    this.acc = 0;
    this.emit({ t: 'phase', phase: this.flow.phase, endsAtTick: this.flow.phaseEndsAt, plan: this.flow.plan });
  }

  leave(): void {
    this.emit({ t: 'left' });
  }

  /** Für den Debug-Modus: Pose des eigenen Läufers */
  debugPose(): string {
    const r = this.flow.turn?.runner(this.myId);
    return r ? poseOf(r.move) : '-';
  }
}
