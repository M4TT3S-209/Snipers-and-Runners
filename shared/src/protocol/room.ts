import type { GadgetId, WeaponId } from '../config';
import type { Loadout, MatchMode, MatchPhase, TurnPlan, TurnRecord } from '../rules/match';
import type { RunnerAction, RunnerMove } from '../sim/runner';
import type { ProjectileInfo, TurnEvent } from '../sim/turn';
import type { EmoteId } from '../unlocks';

/**
 * Protokoll zwischen Client und Raum (RoomDO): Lobby + Match.
 * Kompakt gehalten: Zustandsupdates als Zahlen-Arrays.
 */

export type Vec3Tuple = [number, number, number];

// ---------------------------------------------------------------- Client → Raum

export type RoomClientMessage =
  | { t: 'join'; name: string; key: string; token?: string; spectate?: boolean }
  | { t: 'sync'; c: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'mode'; mode: MatchMode }
  | { t: 'loadout'; weapon?: WeaponId; gadget?: GadgetId | null; ready: boolean }
  | { t: 'in'; k: number; a: RunnerAction }
  | { t: 'aim'; d: Vec3Tuple; z: number }
  | { t: 'fire'; d: Vec3Tuple; v: number }
  | { t: 'rematch' }
  | { t: 'wait' }
  | { t: 'claim' }
  | { t: 'leave' };

// ---------------------------------------------------------------- Raum → Client

export interface RoomMember {
  id: string;
  name: string;
  color: number;
  seat: 'player' | 'spectator';
  connected: boolean;
  ready: boolean;
}

export interface RoomInfo {
  members: RoomMember[];
  hostId: string | null;
  mode: MatchMode;
  stage: 'lobby' | 'match';
}

/** Vollständiger Zustand eines Zugs (für Einstieg/Wiederverbinden) */
export interface TurnSnapshotFull {
  tick: number;
  runners: Array<{
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
    decoyLane: number;
  }>;
  snipers: SniperSnap[];
  projectiles: ProjectileInfo[];
  coverHp: number[];
  /** Tick der Zerstörung, -1 = steht noch */
  coverDestroyedTick: number[];
}

export interface MatchSnapshot {
  mode: MatchMode;
  players: Array<{ id: string; name: string; color: number; emote: EmoteId }>;
  phase: MatchPhase;
  matchTick: number;
  phaseEndsAt: number;
  serverTime: number;
  plan: TurnPlan;
  roundWins: Record<string, number>;
  scores: Record<string, number>;
  records: TurnRecord[];
  loadouts: Record<string, Loadout>;
  ready: string[];
  winnerId: string | null;
  draw: boolean;
  rematchVotes: string[];
  turn: TurnSnapshotFull | null;
}

/**
 * Läufer kompakt:
 * [id, x, y, z, lane, pose, flags, hp, decoyLane, gadgetUses]
 * flags: 1 blockiert · 2 raus · 4 im Ziel · 8 fällt · 16 Schild · 32 Rauch · 64 Sprint · 128 Köder · 256 Zeit um
 */
export type RunnerSnap = [string, number, number, number, number, number, number, number, number, number];

/** Sniper kompakt: [id, aimX, aimY, aimZ, zoom, mag, ammoLeft, reloadEndTick, nextShotTick, weaponIndex] */
export type SniperSnap = [string, number, number, number, number, number, number, number, number, number];

export interface StateMessage {
  t: 's';
  /** Match-Tick */
  mt: number;
  /** Zug-Tick (-1 = kein Zug aktiv) */
  k: number;
  /** Server-Zeit (ms), zu der dieser Zustand galt */
  st: number;
  r: RunnerSnap[];
  sn: SniperSnap[];
  /** Eigener Läufer: kompletter Bewegungszustand (für den Abgleich der Vorhersage) */
  me?: { k: number; m: RunnerMove };
}

export type RoomServerMessage =
  | { t: 'welcome'; you: string; protocol: number; server: string; room: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'sync'; c: number; s: number }
  | { t: 'match'; m: MatchSnapshot }
  | StateMessage
  | { t: 'ev'; e: TurnEvent[] }
  | { t: 'pause'; by: string; until: number; canClaim: boolean }
  | { t: 'resume'; at: number }
  | { t: 'error'; code: 'bad_message' | 'rate_limited' | 'room_full' | 'bad_name' | 'not_allowed' }
  | { t: 'bye'; reason: 'left' | 'replaced' | 'closed' };

export const POSE_CODES = ['run', 'jump', 'slide', 'duck', 'fall', 'idle'] as const;
export const WEAPON_CODES: readonly WeaponId[] = ['precision', 'semi', 'rocket'];

export const RUNNER_FLAGS = {
  blocked: 1,
  out: 2,
  finished: 4,
  respawning: 8,
  shield: 16,
  smoke: 32,
  sprint: 64,
  decoy: 128,
  timedOut: 256,
} as const;

/** Rundet für kompakte Übertragung (mm-genau reicht) */
export function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
