import type {
  Loadout,
  MatchEvent,
  MatchMode,
  MatchPhase,
  ProjectileInfo,
  RunnerAction,
  RunnerPose,
  Track,
  TurnPlan,
  TurnRecord,
  Vec3,
  WeaponId,
  GadgetId,
} from '@scope-rush/shared';

/**
 * Was der Bildschirm zum Zeichnen braucht – egal ob das Spiel lokal
 * (gegen Bots) oder online läuft.
 */
export interface RunnerView {
  id: string;
  name: string;
  colorIndex: number;
  x: number;
  y: number;
  z: number;
  lane: number;
  pose: RunnerPose;
  blocked: boolean;
  speed: number;
  hp: number;
  out: boolean;
  finished: boolean;
  respawning: boolean;
  shield: boolean;
  smoke: boolean;
  sprint: boolean;
  decoyX: number | null;
  gadget: GadgetId | null;
  gadgetUses: number;
}

export interface SniperView {
  id: string;
  name: string;
  weapon: WeaponId;
  aim: Vec3;
  zoom: number;
  canFire: boolean;
  /** 0 … 1 (1 = bereit) */
  reload: number;
  mag: number;
  ammoLeft: number;
}

export type MyRole = 'runner' | 'sniper' | 'spectator';

export interface GameView {
  track: Track;
  phase: MatchPhase;
  phaseLeftS: number;
  /** Zug-Zeit in Ticks (mit Nachkommastellen, für flüssige Darstellung) */
  turnTime: number;
  runners: RunnerView[];
  snipers: SniperView[];
  projectiles: readonly ProjectileInfo[];
  coverHp: readonly number[];
  coverDestroyed: readonly boolean[];
  myId: string;
  myRole: MyRole;
}

export interface PlayerInfo {
  id: string;
  name: string;
  colorIndex: number;
  isBot: boolean;
  connected: boolean;
}

export interface MatchMeta {
  mode: MatchMode | 'practice';
  players: PlayerInfo[];
  plan: TurnPlan;
  phase: MatchPhase;
  phaseLeftS: number;
  roundWins: Record<string, number>;
  scores: Record<string, number>;
  records: TurnRecord[];
  loadouts: Record<string, Loadout>;
  ready: string[];
  winnerId: string | null;
  draw: boolean;
  paused: { by: string; leftS: number } | null;
  rematchVotes: string[];
  myId: string;
}

export type SessionEvent = MatchEvent | { t: 'status'; text: string } | { t: 'left' };

export interface GameSession {
  readonly kind: 'local' | 'online';
  update(nowMs: number): void;
  view(): GameView | null;
  meta(): MatchMeta | null;
  runnerAction(action: RunnerAction): void;
  sniperAim(dir: Vec3, zoom: number): void;
  sniperFire(dir: Vec3): void;
  /** Auswahl ändern; `ready` = bestätigt („Bereit!“) */
  setLoadout(choice: Partial<Loadout>, ready: boolean): void;
  rematch(): void;
  leave(): void;
  onEvent(cb: (e: SessionEvent) => void): () => void;
}
