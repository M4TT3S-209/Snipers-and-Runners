import type { AccountInfo } from '@scope-rush/shared';
import type { RoomSetup } from '../hub/HubCore';
import {
  CONFIG,
  MatchFlow,
  PROTOCOL_VERSION,
  POSE_CODES,
  RUNNER_FLAGS,
  WEAPON_CODES,
  checkName,
  isActive,
  poseOf,
  projectileInfo,
  r3,
  type MatchMode,
  type MatchSnapshot,
  type RoomInfo,
  type RoomMember,
  type RoomServerMessage,
  type RunnerSnap,
  type SniperSnap,
  type StateMessage,
  type TurnEvent,
  type TurnSim,
} from '@scope-rush/shared';
import { parseRoomMessage } from '@scope-rush/shared/schemas';
import { takeToken, type BucketState } from '../util/rateLimit';

/**
 * Logik eines Raums (Lobby + Match) – ohne Cloudflare-Abhängigkeiten,
 * damit sie mit simulierten Clients getestet werden kann. Der RoomDO ist
 * nur der Adapter (WebSockets, Speicher, Timer).
 */

export interface Conn {
  send(data: string): void;
  close(code: number, reason: string): void;
  memberId: string | null;
  bucket?: BucketState;
  lastSeen: number;
}

interface Member {
  id: string;
  /** Konto (null = Gast über Raum-Link) */
  accountId: string | null;
  key: string;
  name: string;
  color: number;
  seat: 'player' | 'spectator';
  ready: boolean;
  conn: Conn | null;
}

export interface RoomPersist {
  members: Array<Omit<Member, 'conn'>>;
  hostId: string | null;
  mode: MatchMode;
  expected?: string[];
  auto?: boolean;
}

export interface MatchSummary {
  mode: MatchMode;
  players: Array<{ id: string; name: string; key: string; accountId: string | null }>;
  winnerId: string | null;
  draw: boolean;
  roundWins: Record<string, number>;
  scores: Record<string, number>;
}

export interface RoomHooks {
  buildId: string;
  persist?(p: RoomPersist): void;
  onMatchEnd?(s: MatchSummary): void;
  onEmpty?(): void;
  /** Konto-Token prüfen (beim Hub) */
  authenticate?(token: string): Promise<AccountInfo | null>;
  /** Konten sind jetzt im Match / nicht mehr (für den Online-Status) */
  onInMatch?(accountIds: string[], inMatch: boolean): void;
}

const TICK_MS = 1000 / CONFIG.sim.hz;
const RATE_BURST = 60;
const RATE_PER_S = 40;
const LIVENESS_MS = 4000;
const RESUME_COUNTDOWN_MS = 3000;
const MAX_MEMBERS = 12;
/** Diese Bewegungs-Ereignisse gehen an alle (Rest erzeugt der eigene Client) */
const SHARED_MOVE_EVENTS = new Set(['trip', 'fall', 'respawn', 'pad', 'finish']);

export class RoomCore {
  readonly members = new Map<string, Member>();
  hostId: string | null = null;
  mode: MatchMode = 'duel';
  flow: MatchFlow | null = null;
  private baseTime = 0;
  private baseTick = 0;
  private pause: { by: string; until: number; resumeAt: number | null } | null = null;
  private readonly rematchVotes = new Set<string>();
  private lastLightState = 0;
  private reported = false;
  /** Vom Hub vorgegeben (Herausforderung/Party) */
  private expected: string[] = [];
  private auto = false;

  constructor(
    public roomId: string,
    private readonly now: () => number,
    private readonly hooks: RoomHooks,
  ) {}

  restore(p: RoomPersist): void {
    this.members.clear();
    for (const m of p.members) this.members.set(m.id, { ...m, accountId: m.accountId ?? null, conn: null });
    this.hostId = p.hostId;
    this.mode = p.mode;
    this.expected = p.expected ?? [];
    this.auto = p.auto ?? false;
  }

  /** Vom Hub: Modus, erwartete Spieler, Autostart */
  configure(setup: RoomSetup): void {
    if (this.flow && this.flow.phase !== 'matchResult') return;
    this.mode = setup.mode;
    this.expected = setup.expected;
    this.auto = setup.auto;
    if (setup.hostId) this.hostId = setup.hostId;
    this.persist();
  }

  /** Läuft gerade etwas, das die Schleife (alle 50 ms) braucht? */
  get needsLoop(): boolean {
    return this.flow !== null && (this.flow.phase !== 'matchResult' || this.pause !== null);
  }

  attach(conn: Conn): void {
    conn.lastSeen = this.now();
  }

  detach(conn: Conn): void {
    const m = conn.memberId ? this.members.get(conn.memberId) : undefined;
    if (!m || m.conn !== conn) return;
    m.conn = null;
    this.onMemberGone(m);
    this.broadcastRoom();
    if ([...this.members.values()].every((x) => !x.conn)) this.hooks.onEmpty?.();
  }

  handle(conn: Conn, raw: unknown): void | Promise<void> {
    const now = this.now();
    const { allowed, state } = takeToken(conn.bucket ?? { tokens: RATE_BURST, last: now }, now, RATE_BURST, RATE_PER_S);
    conn.bucket = state;
    if (!allowed) {
      this.sendTo(conn, { t: 'error', code: 'rate_limited' });
      return;
    }
    const msg = parseRoomMessage(raw);
    if (!msg) {
      this.sendTo(conn, { t: 'error', code: 'bad_message' });
      return;
    }
    conn.lastSeen = now;

    if (msg.t === 'join') {
      if (msg.token && this.hooks.authenticate) {
        const spectate = msg.spectate ?? false;
        return this.hooks.authenticate(msg.token).then((account) => this.join(conn, msg.name, msg.key, spectate, account));
      }
      this.join(conn, msg.name, msg.key, msg.spectate ?? false, null);
      return;
    }
    if (msg.t === 'sync') {
      this.sendTo(conn, { t: 'sync', c: msg.c, s: now });
      return;
    }
    const m = conn.memberId ? this.members.get(conn.memberId) : undefined;
    if (!m || m.conn !== conn) return;
    const flow = this.flow;
    const turn = flow?.turn ?? null;

    switch (msg.t) {
      case 'ready':
        if (flow && flow.phase !== 'matchResult') return;
        m.ready = msg.ready;
        this.persist();
        this.broadcastRoom();
        this.maybeStart();
        break;
      case 'mode':
        if (m.id !== this.hostId || (flow && flow.phase !== 'matchResult')) return;
        this.mode = msg.mode;
        this.reseat();
        this.persist();
        this.broadcastRoom();
        break;
      case 'loadout': {
        if (!flow) return;
        const choice: { weapon?: typeof msg.weapon; gadget?: typeof msg.gadget } = {};
        if (msg.weapon) choice.weapon = msg.weapon;
        if (msg.gadget !== undefined) choice.gadget = msg.gadget;
        flow.setLoadout(m.id, choice, msg.ready);
        this.broadcastMatch();
        break;
      }
      case 'in':
        if (flow?.phase === 'running' && turn?.runner(m.id)) turn.queueRunnerAction(m.id, msg.a, msg.k);
        break;
      case 'aim':
        if (turn?.sniper(m.id)) turn.setAim(m.id, { x: msg.d[0], y: msg.d[1], z: msg.d[2] }, msg.z);
        break;
      case 'fire':
        if (flow?.phase === 'running' && turn?.sniper(m.id)) turn.fire(m.id, { x: msg.d[0], y: msg.d[1], z: msg.d[2] }, msg.v);
        break;
      case 'rematch':
        if (!flow || flow.phase !== 'matchResult' || m.seat !== 'player') return;
        this.rematchVotes.add(m.id);
        this.broadcastMatch();
        this.maybeRematch();
        break;
      case 'wait':
        if (this.pause && now >= this.pause.until) {
          this.pause.until = now + CONFIG.net.graceS * 1000;
          this.broadcast({ t: 'pause', by: this.pause.by, until: this.pause.until, canClaim: false });
        }
        break;
      case 'claim':
        if (flow && this.pause && now >= this.pause.until && m.id !== this.pause.by && m.seat === 'player') {
          const loser = this.pause.by;
          this.pause = null;
          flow.forfeit(loser);
          this.drainAndBroadcast();
        }
        break;
      case 'leave':
        this.leave(m);
        break;
      default:
        break;
    }
  }

  /** Alle 50 ms aufrufen, solange needsLoop. */
  tick(): void {
    const now = this.now();
    // Stumme Verbindungen (iOS friert Apps ohne Abmeldung ein) erkennen
    for (const m of this.members.values()) {
      if (m.conn && now - m.conn.lastSeen > LIVENESS_MS) {
        const c = m.conn;
        c.close(4000, 'timeout');
        this.detach(c);
      }
    }
    const flow = this.flow;
    if (!flow) return;

    if (this.pause) {
      if (this.pause.resumeAt !== null && now >= this.pause.resumeAt) {
        this.pause = null;
        flow.paused = false;
        this.baseTime = now;
        this.baseTick = flow.matchTick;
      } else {
        if (now - this.lastLightState > 500) this.sendStates();
        return;
      }
    }
    if (flow.phase === 'matchResult') return;

    const target = this.baseTick + Math.floor((now - this.baseTime) / TICK_MS);
    let steps = 0;
    while (flow.matchTick < target && steps < 12 && !matchOver(flow)) {
      flow.step();
      steps++;
    }
    if (steps >= 12) {
      this.baseTime = now;
      this.baseTick = flow.matchTick;
    }
    this.drainAndBroadcast();
    this.sendStates();
  }

  // ------------------------------------------------------------------ intern

  private join(conn: Conn, rawName: string, key: string, spectate: boolean, account: AccountInfo | null): void {
    const check = account ? ({ ok: true, name: account.name } as const) : checkName(rawName);
    if (!check.ok) {
      this.sendTo(conn, { t: 'error', code: 'bad_name' });
      return;
    }
    let m = account
      ? this.members.get(account.id)
      : [...this.members.values()].find((x) => x.key === key && !x.accountId);
    if (m) {
      if (m.conn && m.conn !== conn) {
        this.sendTo(m.conn, { t: 'bye', reason: 'replaced' });
        m.conn.close(4004, 'replaced');
      }
      m.conn = conn;
      m.name = check.name;
    } else {
      if (this.members.size >= MAX_MEMBERS) {
        this.sendTo(conn, { t: 'error', code: 'room_full' });
        return;
      }
      const players = [...this.members.values()].filter((x) => x.seat === 'player').length;
      const matchRunning = this.flow !== null && this.flow.phase !== 'matchResult';
      const expectedPlayer = account !== null && this.expected.includes(account.id);
      const seat = !spectate && !matchRunning && (players < this.maxPlayers() || expectedPlayer) ? 'player' : 'spectator';
      m = { id: account?.id ?? randomId(8), accountId: account?.id ?? null, key, name: check.name, color: this.freeColor(), seat, ready: false, conn };
      this.members.set(m.id, m);
      if (!this.hostId || !this.members.has(this.hostId)) this.hostId = m.id;
    }
    conn.memberId = m.id;
    this.persist();
    this.sendTo(conn, { t: 'welcome', you: m.id, protocol: PROTOCOL_VERSION, server: this.hooks.buildId, room: this.roomId });
    this.broadcastRoom();
    if (this.flow) this.sendTo(conn, { t: 'match', m: this.matchSnapshot() });
    if (this.pause && this.pause.by === m.id && this.pause.resumeAt === null) {
      this.pause.resumeAt = this.now() + RESUME_COUNTDOWN_MS;
      // Der Zurückkehrende kennt die Pause noch nicht → erst Pause, dann Countdown
      this.sendTo(conn, this.pauseMessage());
      this.broadcast({ t: 'resume', at: this.pause.resumeAt });
    } else if (this.pause) {
      this.sendTo(conn, this.pauseMessage());
    }
    // Herausforderung: Sobald alle Erwarteten da sind, geht es los
    if (this.auto && !this.flow && this.expected.length > 0) {
      const all = this.expected.every((id) => this.members.get(id)?.conn);
      if (all) {
        for (const id of this.expected) this.members.get(id)!.ready = true;
        this.maybeStart();
      }
    }
  }

  private leave(m: Member): void {
    const flow = this.flow;
    if (flow && flow.phase !== 'matchResult' && this.isInMatch(m.id) && this.mode === 'duel') {
      this.pause = null;
      flow.forfeit(m.id);
      this.drainAndBroadcast();
    }
    const conn = m.conn;
    m.conn = null;
    this.members.delete(m.id);
    if (this.hostId === m.id) this.hostId = [...this.members.keys()][0] ?? null;
    if (conn) {
      this.sendTo(conn, { t: 'bye', reason: 'left' });
      conn.close(1000, 'left');
    }
    this.reseat();
    this.persist();
    this.broadcastRoom();
  }

  private onMemberGone(m: Member): void {
    const flow = this.flow;
    if (!flow || flow.phase === 'matchResult' || !this.isInMatch(m.id)) return;
    if (this.mode !== 'duel' && !flow.plan.sniperIds.includes(m.id)) return; // Klassik: Läufer weg → kein Stopp
    if (this.pause) return;
    flow.paused = true;
    this.pause = { by: m.id, until: this.now() + CONFIG.net.graceS * 1000, resumeAt: null };
    this.broadcast(this.pauseMessage());
  }

  private pauseMessage(): RoomServerMessage {
    const p = this.pause!;
    return { t: 'pause', by: p.by, until: p.until, canClaim: this.now() >= p.until };
  }

  private isInMatch(id: string): boolean {
    return this.flow?.players.some((p) => p.id === id) ?? false;
  }

  private maxPlayers(): number {
    return this.mode === 'duel' ? 2 : CONFIG.party.maxPlayers;
  }

  /** Plätze neu verteilen (z. B. nach Moduswechsel oder Verlassen) */
  private reseat(): void {
    if (this.flow && this.flow.phase !== 'matchResult') return;
    let players = 0;
    for (const m of this.members.values()) {
      if (players < this.maxPlayers()) {
        m.seat = 'player';
        players++;
      } else {
        m.seat = 'spectator';
      }
    }
  }

  private maybeStart(): void {
    if (this.flow && this.flow.phase !== 'matchResult') return;
    const players = [...this.members.values()].filter((m) => m.seat === 'player');
    const min = this.mode === 'duel' ? 2 : CONFIG.party.minPlayers;
    if (players.length < min || players.length > this.maxPlayers()) return;
    if (!players.every((p) => p.ready && p.conn)) return;
    this.startMatch(players);
  }

  private maybeRematch(): void {
    const flow = this.flow;
    if (!flow) return;
    const players = flow.players.map((p) => this.members.get(p.id)).filter((m): m is Member => !!m && !!m.conn);
    if (players.length < flow.players.length) return;
    if (!players.every((p) => this.rematchVotes.has(p.id))) return;
    // Revanche: wer zuletzt zuerst gelaufen ist, ist jetzt zuerst Sniper
    this.startMatch([...players].reverse());
  }

  private startMatch(players: Member[]): void {
    this.flow = new MatchFlow({
      mode: this.mode,
      players: players.map((p) => ({ id: p.id, name: p.name })),
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
    for (const m of this.members.values()) m.ready = false;
    this.rematchVotes.clear();
    this.pause = null;
    this.reported = false;
    this.baseTime = this.now();
    this.baseTick = 0;
    this.flow.drainEvents();
    this.auto = false;
    this.persist();
    this.broadcastRoom();
    this.broadcastMatch();
    const accounts = players.map((p) => p.accountId).filter((x): x is string => !!x);
    if (accounts.length > 0) this.hooks.onInMatch?.(accounts, true);
  }

  private drainAndBroadcast(): void {
    const flow = this.flow;
    if (!flow) return;
    const turnEvents: TurnEvent[] = [];
    let phaseChanged = false;
    for (const e of flow.drainEvents()) {
      if (e.t === 'turn') {
        if (e.ev.t === 'move' && !SHARED_MOVE_EVENTS.has(e.ev.ev)) continue;
        turnEvents.push(e.ev);
      } else {
        phaseChanged = true;
      }
    }
    if (turnEvents.length > 0) this.broadcast({ t: 'ev', e: turnEvents });
    if (phaseChanged) this.broadcastMatch();
    if (flow.phase === 'matchResult' && !this.reported) {
      this.reported = true;
      this.hooks.onMatchEnd?.({
        mode: flow.mode,
        players: flow.players.map((p) => ({
          id: p.id,
          name: p.name,
          key: this.members.get(p.id)?.key ?? '',
          accountId: this.members.get(p.id)?.accountId ?? null,
        })),
        winnerId: flow.winnerId,
        draw: flow.draw,
        roundWins: Object.fromEntries(flow.roundWins),
        scores: Object.fromEntries(flow.scores),
      });
      this.broadcastRoom();
    }
  }

  private sendStates(): void {
    const flow = this.flow;
    if (!flow) return;
    const now = this.now();
    const turn = flow.turn;
    if (!turn) {
      if (now - this.lastLightState < 250) return;
      this.lastLightState = now;
      this.broadcast({ t: 's', mt: flow.matchTick, k: -1, st: now, r: [], sn: [] });
      return;
    }
    this.lastLightState = now;
    const base: StateMessage = { t: 's', mt: flow.matchTick, k: turn.tick, st: now, r: runnerSnaps(turn), sn: sniperSnaps(turn) };
    const shared = JSON.stringify(base);
    for (const m of this.members.values()) {
      if (!m.conn) continue;
      const r = turn.runner(m.id);
      if (r && isActive(r)) {
        this.sendTo(m.conn, { ...base, me: { k: turn.tick, m: r.move } });
      } else {
        safeSend(m.conn, shared);
      }
    }
  }

  matchSnapshot(): MatchSnapshot {
    const f = this.flow!;
    const turn = f.turn;
    return {
      mode: f.mode,
      players: f.players.map((p) => ({ id: p.id, name: p.name, color: this.members.get(p.id)?.color ?? 0 })),
      phase: f.phase,
      matchTick: f.matchTick,
      phaseEndsAt: f.phaseEndsAt,
      serverTime: this.now(),
      plan: f.plan,
      roundWins: Object.fromEntries(f.roundWins),
      scores: Object.fromEntries(f.scores),
      records: f.records,
      loadouts: Object.fromEntries(f.loadouts),
      ready: [...f.ready],
      winnerId: f.winnerId,
      draw: f.draw,
      rematchVotes: [...this.rematchVotes],
      turn: turn
        ? {
            tick: turn.tick,
            runners: turn.runners.map((r) => ({
              id: r.id,
              move: r.move,
              hp: r.hp,
              out: r.out,
              outTick: r.outTick,
              timedOut: r.timedOut,
              gadget: r.gadget,
              gadgetUses: r.gadgetUses,
              shieldTicks: r.shieldTicks,
              smokeTicks: r.smokeTicks,
              decoyTicks: r.decoyTicks,
              decoyLane: r.decoyLane,
            })),
            snipers: sniperSnaps(turn),
            projectiles: turn.projectiles.filter((p) => p.alive).map(projectileInfo),
            coverHp: [...turn.coverHp],
            coverDestroyedTick: turn.coverDestroyedTick.map((t) => (Number.isFinite(t) ? t : -1)),
          }
        : null,
    };
  }

  roomInfo(): RoomInfo {
    const members: RoomMember[] = [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      seat: m.seat,
      connected: m.conn !== null,
      ready: m.ready,
    }));
    const stage = this.flow && this.flow.phase !== 'matchResult' ? 'match' : 'lobby';
    return { members, hostId: this.hostId, mode: this.mode, stage };
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.roomInfo() });
  }

  private broadcastMatch(): void {
    if (this.flow) this.broadcast({ t: 'match', m: this.matchSnapshot() });
  }

  private broadcast(msg: RoomServerMessage): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) if (m.conn) safeSend(m.conn, data);
  }

  private sendTo(conn: Conn, msg: RoomServerMessage): void {
    safeSend(conn, JSON.stringify(msg));
  }

  private freeColor(): number {
    const used = new Set([...this.members.values()].map((m) => m.color));
    for (let c = 0; c < 8; c++) if (!used.has(c)) return c;
    return this.members.size % 8;
  }

  private persist(): void {
    this.hooks.persist?.({
      members: [...this.members.values()].map(({ conn: _c, ...rest }) => rest),
      hostId: this.hostId,
      mode: this.mode,
      expected: this.expected,
      auto: this.auto,
    });
  }
}

/** Eigene Funktion, weil flow.step() die Phase ändert (TypeScript sieht das sonst nicht) */
function matchOver(flow: MatchFlow): boolean {
  return flow.phase === 'matchResult';
}

function safeSend(conn: Conn, data: string): void {
  try {
    conn.send(data);
  } catch {
    // Verbindung schon weg
  }
}

export function runnerSnaps(turn: TurnSim): RunnerSnap[] {
  return turn.runners.map((r) => {
    const m = r.move;
    let flags = 0;
    if (m.blocked) flags |= RUNNER_FLAGS.blocked;
    if (r.out) flags |= RUNNER_FLAGS.out;
    if (m.phase === 'finished') flags |= RUNNER_FLAGS.finished;
    if (m.phase === 'respawning') flags |= RUNNER_FLAGS.respawning;
    if (r.shieldTicks > 0) flags |= RUNNER_FLAGS.shield;
    if (r.smokeTicks > 0) flags |= RUNNER_FLAGS.smoke;
    if (m.sprintTicks > 0) flags |= RUNNER_FLAGS.sprint;
    if (r.decoyTicks > 0) flags |= RUNNER_FLAGS.decoy;
    if (r.timedOut) flags |= RUNNER_FLAGS.timedOut;
    return [r.id, r3(m.x), r3(m.y), r3(m.z), m.lane, POSE_CODES.indexOf(poseOf(m)), flags, r.hp, r.decoyLane, r.gadgetUses];
  });
}

export function sniperSnaps(turn: TurnSim): SniperSnap[] {
  return turn.snipers.map((s) => [
    s.id,
    r3(s.aim.x),
    r3(s.aim.y),
    r3(s.aim.z),
    s.zoom,
    s.mag,
    s.ammoLeft,
    s.reloadEndTick,
    s.nextShotTick,
    WEAPON_CODES.indexOf(s.weapon),
  ]);
}

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomId(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ID_CHARS[b % ID_CHARS.length];
  return out;
}
