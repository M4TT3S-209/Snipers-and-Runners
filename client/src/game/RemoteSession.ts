import {
  CONFIG,
  PROTOCOL_VERSION,
  POSE_CODES,
  RUNNER_FLAGS,
  WEAPON_CODES,
  applyMoveAction,
  cloneMove,
  generateTrack,
  laneX,
  poseOf,
  r3,
  secondsToTicks,
  sniperEye,
  stepMove,
  type CoverDef,
  type Loadout,
  type MatchSnapshot,
  type MoveContext,
  type MoveEvent,
  type ProjectileInfo,
  type RoomClientMessage,
  type RoomInfo,
  type RoomServerMessage,
  type RunnerAction,
  type RunnerMove,
  type RunnerSnap,
  type SniperSnap,
  type Track,
  type TurnEvent,
  type Vec3,
} from '@scope-rush/shared';
import { ClockSync } from '../net/clock';
import type { LagSettings } from '../net/lagSim';
import { ReconnectingSocket, type SocketStatus } from '../net/socket';
import { toWebSocketUrl } from '../net/serverUrl';
import { markUpdateAvailable } from '../platform/updateCheck';
import type { GameSession, GameView, MatchMeta, MyRole, PlayerInfo, RunnerView, SessionEvent, SniperView } from './view';

/**
 * Online-Spiel über einen Raum (RoomDO).
 *
 *  - Uhr-Abgleich → geschätzte Server-Zeit/Ticks
 *  - Eigener Läufer: Vorhersage (läuft dem Server um halbe Laufzeit voraus),
 *    Abgleich mit dem Server-Zustand, weiches Ausgleichen kleiner Fehler
 *  - Gegner: Interpolation zwischen Server-Zuständen (≈100 ms Verzögerung)
 *  - Eigene Schüsse sofort sichtbar (lokales Echo)
 *  - Ereignisse werden genau dann abgespielt, wenn die Anzeige ihren Tick erreicht
 */

const HZ = CONFIG.sim.hz;
const SYNC_MS = 1000;
const INTERP_TICKS = (CONFIG.sim.interpDelayMs / 1000) * HZ;
/** Höchstens so viele Ticks darf die eigene Vorhersage vor dem Server liegen */
const MAX_LEAD_TICKS = 36;

interface DecodedRunner {
  id: string;
  x: number;
  y: number;
  z: number;
  lane: number;
  pose: (typeof POSE_CODES)[number];
  flags: number;
  hp: number;
  decoyLane: number;
  gadgetUses: number;
}

interface Snapshot {
  k: number;
  runners: Map<string, DecodedRunner>;
  snipers: SniperSnap[];
}

export interface RemoteOptions {
  serverUrl: string;
  roomId: string;
  name: string;
  lag?: LagSettings | null;
}

export class RemoteSession implements GameSession {
  readonly kind = 'online' as const;
  readonly roomId: string;
  private readonly socket: ReconnectingSocket<RoomServerMessage, RoomClientMessage>;
  private readonly clock = new ClockSync();
  private readonly listeners = new Set<(e: SessionEvent) => void>();
  private readonly key: string;
  myId = '';
  status: SocketStatus = 'connecting';
  room: RoomInfo | null = null;
  error: string | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  // Match
  private match: MatchSnapshot | null = null;
  private track: Track | null = null;
  private trackKey = '';
  private anchor = { mt: 0, k: -1, st: 0 };
  private estTurn = 0;
  private estMatch = 0;
  private lastUpdate = -1;

  // Zug
  private snaps: Snapshot[] = [];
  private coverHp: number[] = [];
  private coverDestroyedTick: number[] = [];
  private readonly projectiles = new Map<number, ProjectileInfo>();
  private readonly impactAt = new Map<number, number>();
  private localShots: ProjectileInfo[] = [];
  private nextLocalId = -1;
  private pending: TurnEvent[] = [];
  private turnKey = '';
  private fireCooldownUntil = 0;

  // Eigener Läufer (Vorhersage)
  private myMove: RunnerMove | null = null;
  private predTick = 0;
  private inputLog: Array<{ tick: number; action: RunnerAction }> = [];
  private visual = { x: 0, y: 0, z: 0 };

  private paused: { by: string; until: number; canClaim: boolean; resumeAt: number | null } | null = null;
  private left = false;

  constructor(opts: RemoteOptions) {
    this.roomId = opts.roomId;
    this.key = roomKey(opts.roomId);
    this.socket = new ReconnectingSocket<RoomServerMessage, RoomClientMessage>({
      url: () => toWebSocketUrl(opts.serverUrl, `/room/${opts.roomId}?v=${PROTOCOL_VERSION}`),
      lag: opts.lag ?? null,
      onStatus: (s) => {
        this.status = s;
        this.emit({ t: 'status', text: s });
      },
      onUpdateRequired: markUpdateAvailable,
      onOpen: () => {
        this.send({ t: 'join', name: opts.name, key: this.key });
        this.sendSync();
      },
      onMessage: (m) => this.onMessage(m),
    });
    this.socket.start();
    this.syncTimer = setInterval(() => this.sendSync(), SYNC_MS);
  }

  // ------------------------------------------------------------------ öffentliche Steuerung

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  claimWin(): void {
    this.send({ t: 'claim' });
  }

  keepWaiting(): void {
    this.send({ t: 'wait' });
  }

  get rtt(): number {
    return this.clock.rtt;
  }

  get pauseInfo(): { by: string; leftS: number; canClaim: boolean; resumeInS: number | null } | null {
    if (!this.paused) return null;
    const now = this.clock.serverNow();
    return {
      by: this.paused.by,
      leftS: Math.max(0, (this.paused.until - now) / 1000),
      canClaim: now >= this.paused.until,
      resumeInS: this.paused.resumeAt !== null ? Math.max(0, (this.paused.resumeAt - now) / 1000) : null,
    };
  }

  runnerAction(action: RunnerAction): void {
    if (!this.match || this.match.phase !== 'running' || !this.myMove || this.myRole() !== 'runner') return;
    const tick = this.predTick;
    if (action === 'gadget') {
      const me = this.latestRunner(this.myId);
      const gadget = this.match.loadouts[this.myId]?.gadget;
      if (!me || me.gadgetUses <= 0) return;
      if (gadget === 'sprint') this.myMove.sprintTicks = secondsToTicks(CONFIG.gadgets.sprint.durationS);
    } else {
      const ev = applyMoveAction(this.myMove, action, this.ctx(tick));
      if (ev) this.emitTurn({ t: 'move', tick, runnerId: this.myId, ev });
    }
    this.inputLog.push({ tick, action });
    this.send({ t: 'in', k: tick, a: action });
  }

  sniperAim(dir: Vec3, zoom: number): void {
    if (this.myRole() !== 'sniper' || !this.match?.turn) return;
    this.send({ t: 'aim', d: [r3(dir.x), r3(dir.y), r3(dir.z)], z: zoom });
  }

  sniperFire(dir: Vec3): void {
    if (!this.match || this.match.phase !== 'running' || this.myRole() !== 'sniper' || !this.track) return;
    const me = this.mySniper();
    if (!me || !me.canFire || performance.now() < this.fireCooldownUntil) return;
    const weapon = me.weapon;
    const w = CONFIG.weapons[weapon];
    const viewTick = Math.max(0, this.renderTick());
    // Lokales Echo: Kugel sofort zeigen
    const local: ProjectileInfo = {
      id: this.nextLocalId--,
      ownerId: this.myId,
      weapon,
      origin: sniperEye(this.track),
      vel: { x: dir.x * w.speed, y: dir.y * w.speed, z: dir.z * w.speed },
      gravity: w.gravity,
      spawnTime: viewTick,
    };
    this.localShots.push(local);
    this.fireCooldownUntil = performance.now() + Math.max(250, w.fireIntervalS * 1000);
    this.emitTurn({ t: 'shot', tick: Math.floor(viewTick), sniperId: this.myId, projectile: local });
    this.send({ t: 'fire', d: [r3(dir.x), r3(dir.y), r3(dir.z)], v: Math.round(viewTick * 100) / 100 });
  }

  setLoadout(choice: Partial<Loadout>, ready: boolean): void {
    const msg: RoomClientMessage = { t: 'loadout', ready };
    if (choice.weapon) msg.weapon = choice.weapon;
    if (choice.gadget !== undefined) msg.gadget = choice.gadget;
    this.send(msg);
  }

  rematch(): void {
    this.send({ t: 'rematch' });
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    this.send({ t: 'leave' });
    if (this.syncTimer) clearInterval(this.syncTimer);
    setTimeout(() => this.socket.stop(), 100);
    this.emit({ t: 'left' });
  }

  // ------------------------------------------------------------------ Schleife

  update(nowMs: number): void {
    const dt = this.lastUpdate < 0 ? 0 : Math.min(0.25, (nowMs - this.lastUpdate) / 1000);
    this.lastUpdate = nowMs;
    const m = this.match;
    if (!m || !this.clock.ready) return;

    // Geschätzte Server-Ticks (weich nachgeführt). Ohne lebendige Verbindung
    // wissen wir nichts über den Server → nicht weiterrechnen.
    const connected = this.socket.healthy();
    const running = connected && (!this.paused || (this.paused.resumeAt !== null && this.clock.serverNow() >= this.paused.resumeAt));
    const elapsed = running ? ((this.clock.serverNow(nowMs) - this.anchor.st) * HZ) / 1000 : 0;
    const targetMatch = this.anchor.mt + Math.max(0, elapsed);
    const targetTurn = this.anchor.k + Math.max(0, elapsed);
    const ticking = running && (m.phase === 'running' || m.phase === 'countdown');
    this.estMatch = follow(this.estMatch, targetMatch, dt, running);
    this.estTurn = this.anchor.k < 0 ? 0 : follow(this.estTurn, targetTurn, dt, ticking && m.phase === 'running');

    // Eigene Vorhersage vorlaufen lassen
    if (this.myMove && this.myRole() === 'runner' && m.phase === 'running' && running) {
      const lead = Math.min(MAX_LEAD_TICKS, ((this.clock.rtt / 2 + CONFIG.net.inputLeadBufferMs) / 1000) * HZ);
      const target = Math.floor(this.estTurn + lead);
      let guard = 0;
      while (this.predTick < target && guard++ < 30) {
        const events: MoveEvent[] = [];
        stepMove(this.myMove, this.ctx(this.predTick), events);
        this.predTick++;
        for (const ev of events) if (ev !== 'finish') this.emitTurn({ t: 'move', tick: this.predTick, runnerId: this.myId, ev });
      }
    }
    // Ausgleich kleiner Abweichungen abklingen lassen
    const decay = Math.exp(-dt * 10);
    this.visual.x *= decay;
    this.visual.y *= decay;
    this.visual.z *= decay;

    // Ereignisse freigeben, wenn die Anzeige ihren Zeitpunkt erreicht
    const vt = this.viewTime();
    if (this.pending.length > 0) {
      const ready = this.pending.filter((e) => e.tick <= vt + 0.5);
      if (ready.length > 0) {
        this.pending = this.pending.filter((e) => e.tick > vt + 0.5);
        for (const e of ready) this.emitTurn(e);
      }
    }
    for (const [id, tick] of this.impactAt) {
      if (tick <= vt) {
        this.projectiles.delete(id);
        this.impactAt.delete(id);
      }
    }
    // Lokale Schüsse verfallen, falls der Server sie nie bestätigt
    this.localShots = this.localShots.filter((p) => vt - p.spawnTime < HZ * 4);
  }

  view(): GameView | null {
    const m = this.match;
    const track = this.track;
    if (!m || !track) return null;
    const role = this.myRole();
    const vt = this.viewTime();
    const rt = this.renderTick();
    const runners = this.runnerViews(rt);
    return {
      track,
      phase: m.phase,
      phaseLeftS: Math.max(0, (m.phaseEndsAt - this.estMatch) / HZ),
      turnTime: vt,
      runners,
      snipers: this.sniperViews(),
      projectiles: [...this.projectiles.values(), ...this.localShots],
      coverHp: this.coverHp,
      coverDestroyed: this.coverDestroyedTick.map((t) => t <= vt),
      myId: this.myId,
      myRole: role,
    };
  }

  meta(): MatchMeta | null {
    const m = this.match;
    if (!m) return null;
    const connected = new Map((this.room?.members ?? []).map((x) => [x.id, x.connected]));
    const players: PlayerInfo[] = m.players.map((p) => ({
      id: p.id,
      name: p.name,
      colorIndex: p.color,
      isBot: false,
      connected: connected.get(p.id) ?? false,
    }));
    const pause = this.pauseInfo;
    return {
      mode: m.mode,
      players,
      plan: m.plan,
      phase: m.phase,
      phaseLeftS: Math.max(0, (m.phaseEndsAt - this.estMatch) / HZ),
      roundWins: m.roundWins,
      scores: m.scores,
      records: m.records,
      loadouts: m.loadouts,
      ready: m.ready,
      winnerId: m.winnerId,
      draw: m.draw,
      paused: pause ? { by: pause.by, leftS: pause.leftS } : null,
      rematchVotes: m.rematchVotes,
      myId: this.myId,
    };
  }

  /** Läuft gerade ein Match (oder nur Lobby)? */
  get inMatch(): boolean {
    return this.room?.stage === 'match' || (this.match !== null && this.match.phase !== 'matchResult');
  }

  // ------------------------------------------------------------------ Nachrichten

  private onMessage(msg: RoomServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.you;
        this.error = null;
        break;
      case 'room':
        this.room = msg.room;
        this.emit({ t: 'status', text: 'room' });
        break;
      case 'sync':
        this.clock.addSample(msg.c, msg.s, performance.now());
        break;
      case 'match':
        this.applyMatch(msg.m);
        break;
      case 's':
        this.anchor = { mt: msg.mt, k: msg.k, st: msg.st };
        if (this.match) this.match.matchTick = msg.mt;
        if (msg.k >= 0) {
          this.snaps.push({ k: msg.k, runners: new Map(msg.r.map((r) => [r[0], decodeRunner(r)])), snipers: msg.sn });
          if (this.snaps.length > 40) this.snaps.shift();
        }
        if (msg.me) this.reconcile(msg.me.k, msg.me.m);
        break;
      case 'ev':
        for (const e of msg.e) this.onTurnEvent(e);
        break;
      case 'pause':
        this.paused = { by: msg.by, until: msg.until, canClaim: msg.canClaim, resumeAt: null };
        break;
      case 'resume':
        if (this.paused) this.paused.resumeAt = msg.at;
        setTimeout(() => {
          if (this.paused?.resumeAt === msg.at) this.paused = null;
        }, Math.max(0, msg.at - this.clock.serverNow()) + 50);
        break;
      case 'error':
        this.error = msg.code;
        this.emit({ t: 'status', text: `error:${msg.code}` });
        break;
      case 'bye':
        if (msg.reason === 'replaced') this.socket.stop();
        break;
    }
  }

  private applyMatch(m: MatchSnapshot): void {
    const prev = this.match;
    this.match = m;
    this.anchor = { mt: m.matchTick, k: m.turn?.tick ?? -1, st: m.serverTime };
    if (!prev) {
      this.estMatch = m.matchTick;
      this.estTurn = m.turn?.tick ?? 0;
    }
    const key = `${m.plan.seed}:${m.plan.theme}`;
    if (key !== this.trackKey) {
      this.trackKey = key;
      this.track = generateTrack({ seed: m.plan.seed, theme: m.plan.theme });
    }
    const track = this.track!;
    const turnKey = `${m.plan.index}:${m.turn ? 'turn' : 'none'}:${m.matchTick < (prev?.matchTick ?? 0) ? 'new' : ''}`;
    const newTurn = m.turn && (turnKey !== this.turnKey || !prev || prev.plan.index !== m.plan.index || !prev.turn);
    if (m.turn && (newTurn || this.snaps.length === 0)) {
      this.turnKey = turnKey;
      const t = m.turn;
      this.coverHp = [...t.coverHp];
      this.coverDestroyedTick = t.coverDestroyedTick.map((x) => (x < 0 ? Infinity : x));
      this.projectiles.clear();
      this.impactAt.clear();
      for (const p of t.projectiles) this.projectiles.set(p.id, p);
      this.localShots = [];
      this.pending = [];
      this.snaps = [
        {
          k: t.tick,
          runners: new Map(
            t.runners.map((r) => [
              r.id,
              {
                id: r.id,
                x: r.move.x,
                y: r.move.y,
                z: r.move.z,
                lane: r.move.lane,
                pose: poseOf(r.move),
                flags: (r.out ? RUNNER_FLAGS.out : 0) | (r.move.phase === 'finished' ? RUNNER_FLAGS.finished : 0),
                hp: r.hp,
                decoyLane: r.decoyLane,
                gadgetUses: r.gadgetUses,
              },
            ]),
          ),
          snipers: t.snipers,
        },
      ];
      const mine = t.runners.find((r) => r.id === this.myId);
      this.myMove = mine && !mine.out ? cloneMove(mine.move) : null;
      this.predTick = t.tick;
      this.inputLog = [];
      this.estTurn = t.tick;
    } else if (!m.turn) {
      this.myMove = null;
      if (this.coverHp.length !== track.covers.length) {
        this.coverHp = track.covers.map((c: CoverDef) => c.hp);
        this.coverDestroyedTick = track.covers.map(() => Infinity);
      }
    }
    if (!prev || prev.phase !== m.phase || prev.plan.index !== m.plan.index) {
      this.emit({ t: 'phase', phase: m.phase, endsAtTick: m.phaseEndsAt, plan: m.plan });
      if (m.phase === 'matchResult') this.emit({ t: 'matchEnd', winnerId: m.winnerId, draw: m.draw });
    }
  }

  private onTurnEvent(e: TurnEvent): void {
    switch (e.t) {
      case 'shot':
        this.projectiles.set(e.projectile.id, e.projectile);
        if (e.sniperId === this.myId) {
          // eigenes Echo ersetzen, nicht doppelt abspielen
          this.localShots.shift();
          return;
        }
        break;
      case 'impact':
        this.impactAt.set(e.projectileId, e.tick);
        break;
      case 'cover': {
        const idx = this.track?.covers.findIndex((c) => c.id === e.coverId) ?? -1;
        if (idx >= 0) {
          this.coverHp[idx] = e.hpLeft;
          if (e.hpLeft <= 0) this.coverDestroyedTick[idx] = e.tick;
        }
        break;
      }
      case 'move':
        // Eigene Bewegungs-Ereignisse kommen schon aus der Vorhersage
        if (e.runnerId === this.myId) return;
        break;
      default:
        break;
    }
    this.pending.push(e);
  }

  /** Server-Zustand des eigenen Läufers übernehmen und Eingaben seitdem neu anwenden. */
  private reconcile(k: number, m: RunnerMove): void {
    if (!this.track || !this.match || this.myRole() !== 'runner') return;
    const old = this.myMove;
    const base = cloneMove(m);
    if (!old || this.predTick < k) {
      this.myMove = base;
      this.predTick = Math.max(this.predTick, k);
      return;
    }
    // Nie weiter als MAX_LEAD vor dem Server vorhersagen (z. B. nach Funkloch)
    if (this.predTick > k + MAX_LEAD_TICKS) this.predTick = k + MAX_LEAD_TICKS;
    this.inputLog = this.inputLog.filter((i) => i.tick >= k && i.tick <= this.predTick);
    for (let t = k; t < this.predTick; t++) {
      const ctx = this.ctx(t);
      for (const i of this.inputLog) {
        if (i.tick !== t) continue;
        if (i.action === 'gadget') {
          if (this.match.loadouts[this.myId]?.gadget === 'sprint') base.sprintTicks = secondsToTicks(CONFIG.gadgets.sprint.durationS);
        } else {
          applyMoveAction(base, i.action, ctx);
        }
      }
      stepMove(base, ctx);
    }
    for (const i of this.inputLog) if (i.tick === this.predTick && i.action !== 'gadget') applyMoveAction(base, i.action, this.ctx(this.predTick));
    // kleine Unterschiede weich ausgleichen, große sofort übernehmen
    const dx = old.x - base.x;
    const dy = old.y - base.y;
    const dz = old.z - base.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 3) {
      this.visual.x += dx;
      this.visual.y += dy;
      this.visual.z += dz;
    }
    this.myMove = base;
  }

  // ------------------------------------------------------------------ Hilfen

  private ctx(tick: number): MoveContext {
    return {
      track: this.track!,
      tick,
      coverAlive: (_c, i, t) => (this.coverDestroyedTick[i] ?? Infinity) > t,
    };
  }

  private myRole(): MyRole {
    const plan = this.match?.plan;
    if (!plan) return 'spectator';
    if (plan.runnerIds.includes(this.myId)) return 'runner';
    if (plan.sniperIds.includes(this.myId)) return 'sniper';
    return 'spectator';
  }

  /** Tick, zu dem Gegner gezeichnet werden (etwas in der Vergangenheit) */
  private renderTick(): number {
    return this.estTurn - INTERP_TICKS;
  }

  /** Zeitbasis der Anzeige: Läufer sehen ihre vorhergesagte Zeit, alle anderen die Interpolationszeit */
  private viewTime(): number {
    if (this.myRole() === 'runner' && this.myMove && this.match?.phase === 'running') return this.predTick;
    return this.renderTick();
  }

  private latestRunner(id: string): DecodedRunner | undefined {
    return this.snaps.at(-1)?.runners.get(id);
  }

  private runnerViews(rt: number): RunnerView[] {
    const m = this.match!;
    const latest = this.snaps.at(-1);
    if (!latest) {
      return m.plan.runnerIds.map((id, i) => idleRunner(id, this.nameOf(id), this.colorOf(id), i, m.plan.runnerIds.length));
    }
    // passendes Paar von Zuständen finden
    let a = latest;
    let b = latest;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const s = this.snaps[i]!;
      if (s.k <= rt) {
        a = s;
        b = this.snaps[i + 1] ?? s;
        break;
      }
      a = s;
      b = s;
    }
    const span = b.k - a.k;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (rt - a.k) / span)) : 0;
    const out: RunnerView[] = [];
    for (const [id, cur] of latest.runners) {
      const ra = a.runners.get(id) ?? cur;
      const rb = b.runners.get(id) ?? cur;
      const own = id === this.myId && this.myMove && m.phase === 'running' && !(cur.flags & RUNNER_FLAGS.out);
      const mv = this.myMove;
      const x = own && mv ? mv.x + this.visual.x : ra.x + (rb.x - ra.x) * alpha;
      const y = own && mv ? mv.y + this.visual.y : ra.y + (rb.y - ra.y) * alpha;
      const z = own && mv ? mv.z + this.visual.z : ra.z + (rb.z - ra.z) * alpha;
      const pose = own && mv ? poseOf(mv) : rb.pose;
      const flags = cur.flags;
      out.push({
        id,
        name: this.nameOf(id),
        colorIndex: this.colorOf(id),
        x,
        y,
        z,
        lane: own && mv ? mv.lane : rb.lane,
        pose,
        blocked: own && mv ? mv.blocked : (flags & RUNNER_FLAGS.blocked) !== 0,
        speed: (flags & RUNNER_FLAGS.sprint) !== 0 ? 1.4 : 1,
        hp: cur.hp,
        out: (flags & RUNNER_FLAGS.out) !== 0,
        finished: own && mv ? mv.phase === 'finished' : (flags & RUNNER_FLAGS.finished) !== 0,
        respawning: own && mv ? mv.phase === 'respawning' : (flags & RUNNER_FLAGS.respawning) !== 0,
        shield: (flags & RUNNER_FLAGS.shield) !== 0,
        smoke: (flags & RUNNER_FLAGS.smoke) !== 0,
        sprint: (flags & RUNNER_FLAGS.sprint) !== 0,
        decoyX: (flags & RUNNER_FLAGS.decoy) !== 0 ? laneX(cur.decoyLane) : null,
        gadget: m.loadouts[id]?.gadget ?? null,
        gadgetUses: cur.gadgetUses,
      });
    }
    return out;
  }

  private sniperViews(): SniperView[] {
    const m = this.match!;
    const latest = this.snaps.at(-1);
    const tick = this.estTurn;
    if (!latest || !m.turn) {
      return m.plan.sniperIds.map((id) => ({
        id,
        name: this.nameOf(id),
        weapon: m.loadouts[id]?.weapon ?? 'precision',
        aim: { x: 0, y: -0.25, z: -1 },
        zoom: 0,
        canFire: false,
        reload: 1,
        mag: 1,
        ammoLeft: -1,
      }));
    }
    return latest.snipers.map((s) => {
      const [id, ax, ay, az, zoom, mag, ammoLeft, reloadEnd, nextShot, wi] = s;
      const weapon = WEAPON_CODES[wi] ?? 'precision';
      const w = CONFIG.weapons[weapon];
      let canFire = m.phase === 'running' && tick >= nextShot && (reloadEnd === 0 || tick >= reloadEnd) && (mag > 0 || reloadEnd > 0) && ammoLeft !== 0;
      if (id === this.myId && performance.now() < this.fireCooldownUntil) canFire = false;
      let reload = 1;
      if (reloadEnd > 0 && tick < reloadEnd) {
        reload = Math.max(0, Math.min(1, 1 - (reloadEnd - tick) / (w.reloadS * HZ)));
        canFire = false;
      }
      return { id, name: this.nameOf(id), weapon, aim: { x: ax, y: ay, z: az }, zoom, canFire, reload, mag, ammoLeft };
    });
  }

  private mySniper(): SniperView | undefined {
    return this.sniperViews().find((s) => s.id === this.myId);
  }

  private nameOf(id: string): string {
    return this.match?.players.find((p) => p.id === id)?.name ?? this.room?.members.find((m) => m.id === id)?.name ?? '?';
  }

  private colorOf(id: string): number {
    return this.match?.players.find((p) => p.id === id)?.color ?? 0;
  }

  private send(msg: RoomClientMessage): void {
    this.socket.send(msg);
  }

  private sendSync(): void {
    if (this.socket.isOpen) this.send({ t: 'sync', c: performance.now() });
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  private emitTurn(ev: TurnEvent): void {
    this.emit({ t: 'turn', ev });
  }
}

/** Weiches Nachführen eines geschätzten Tick-Zählers */
function follow(current: number, target: number, dt: number, advancing: boolean): number {
  let next = advancing ? current + dt * HZ : current;
  const err = target - next;
  if (Math.abs(err) > 8) return target;
  next += err * Math.min(1, dt * 6);
  return next;
}

function decodeRunner(r: RunnerSnap): DecodedRunner {
  return {
    id: r[0],
    x: r[1],
    y: r[2],
    z: r[3],
    lane: r[4],
    pose: POSE_CODES[r[5]] ?? 'run',
    flags: r[6],
    hp: r[7],
    decoyLane: r[8],
    gadgetUses: r[9],
  };
}

function idleRunner(id: string, name: string, colorIndex: number, i: number, n: number): RunnerView {
  return {
    id,
    name,
    colorIndex,
    x: laneX(n === 1 ? 1 : i % 3),
    y: 0,
    z: 0,
    lane: 1,
    pose: 'idle',
    blocked: false,
    speed: 0,
    hp: CONFIG.runner.hp,
    out: false,
    finished: false,
    respawning: false,
    shield: false,
    smoke: false,
    sprint: false,
    decoyX: null,
    gadget: null,
    gadgetUses: 0,
  };
}

/** Geheimer Schlüssel pro Raum: damit man nach einem Abbruch seinen Platz zurückbekommt. */
function roomKey(roomId: string): string {
  const storageKey = `rvs.room.${roomId}`;
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing && /^[A-Za-z0-9_-]{8,40}$/.test(existing)) return existing;
  } catch {
    // ignorieren
  }
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const key = Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[b % 64]).join('');
  try {
    localStorage.setItem(storageKey, key);
  } catch {
    // ignorieren
  }
  return key;
}

/** Neue Raum-ID (10 Zeichen, gut lesbar) */
export function newRoomId(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
