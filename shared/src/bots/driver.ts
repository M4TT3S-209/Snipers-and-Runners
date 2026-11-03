import { CONFIG, type BotLevel, type GadgetId, type WeaponId } from '../config';
import { Rng, hashString } from '../math/rng';
import type { MatchFlow } from '../rules/match';
import type { TurnSim } from '../sim/turn';
import { RunnerBot } from './runnerBot';
import { SniperBot } from './sniperBot';

/**
 * Steuert Bot-Spieler in einem Match: wählt Ausrüstung, läuft, schießt.
 * Vor jedem `flow.step()` aufrufen.
 */
export class BotDriver {
  private readonly levels = new Map<string, BotLevel>();
  private runnerBots = new Map<string, RunnerBot>();
  private sniperBots = new Map<string, SniperBot>();
  private currentTurn: TurnSim | null = null;
  private readonly rng: Rng;

  constructor(
    private readonly flow: MatchFlow,
    bots: ReadonlyArray<{ id: string; level: BotLevel }>,
    seed: number,
    private readonly weapons: readonly WeaponId[] = ['precision'],
    private readonly gadgets: ReadonlyArray<GadgetId | null> = [null],
  ) {
    for (const b of bots) this.levels.set(b.id, b.level);
    this.rng = new Rng(seed);
  }

  isBot(id: string): boolean {
    return this.levels.has(id);
  }

  beforeStep(): void {
    const flow = this.flow;
    if (flow.phase === 'loadout') {
      for (const id of this.levels.keys()) {
        if (flow.ready.has(id)) continue;
        const role = flow.roleOf(id);
        if (role === 'none') continue;
        // Bots wählen nach kurzer „Bedenkzeit“
        if (this.rng.next() > 0.04) continue;
        if (role === 'sniper') flow.setLoadout(id, { weapon: this.weapons[this.rng.int(0, this.weapons.length - 1)]! });
        else flow.setLoadout(id, { gadget: this.gadgets[this.rng.int(0, this.gadgets.length - 1)] ?? null });
      }
      return;
    }
    const turn = flow.turn;
    if (flow.phase !== 'running' || !turn) return;
    if (turn !== this.currentTurn) this.setupTurn(turn);

    for (const [id, bot] of this.runnerBots) {
      for (const action of bot.think(turn)) turn.queueRunnerAction(id, action);
    }
    for (const [id, bot] of this.sniperBots) {
      const out = bot.think(turn);
      turn.setAim(id, out.aim, out.zoom);
      if (out.fire) turn.fire(id, out.aim);
    }
  }

  private setupTurn(turn: TurnSim): void {
    this.currentTurn = turn;
    this.runnerBots = new Map();
    this.sniperBots = new Map();
    for (const [id, level] of this.levels) {
      const seed = hashString(`${id}:${this.flow.plan.index}:${this.flow.seed}`);
      if (turn.runner(id)) this.runnerBots.set(id, new RunnerBot(id, level, seed));
      if (turn.sniper(id)) this.sniperBots.set(id, new SniperBot(id, level, seed));
    }
  }
}

/** Alle Waffen/Gadgets (für Bots, wenn nichts eingeschränkt ist) */
export const ALL_WEAPONS = Object.keys(CONFIG.weapons) as WeaponId[];
export const ALL_GADGETS: GadgetId[] = ['smoke', 'shield', 'sprint', 'decoy'];
