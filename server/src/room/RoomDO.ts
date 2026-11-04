import { DurableObject } from 'cloudflare:workers';
import { HEARTBEAT_PING, HEARTBEAT_PONG } from '@scope-rush/shared';
import type { Env } from '../env';
import { RoomCore, type Conn, type MatchSummary, type RoomPersist } from './RoomCore';

/**
 * RoomDO – ein Objekt pro Duell bzw. Party.
 *
 * Adapter um RoomCore:
 *  - WebSockets über die Hibernation-API (in der Lobby darf das DO schlafen)
 *  - während eines Matches tickt ein Timer alle 50 ms (dann schläft es nicht)
 *  - Mitglieder werden gespeichert, damit sie ein Aufwachen überstehen
 */
interface Attachment {
  memberId: string | null;
}

const EMPTY_CLEANUP_MS = 30 * 60 * 1000;

export class RoomDO extends DurableObject<Env> {
  private core: RoomCore;
  private readonly conns = new Map<WebSocket, Conn>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat „ping“ → „pong“ ohne Aufwecken
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));
    this.core = this.makeCore('');
    ctx.blockConcurrencyWhile(async () => {
      const roomId = (await ctx.storage.get<string>('roomId')) ?? '';
      this.core = this.makeCore(roomId);
      const saved = await ctx.storage.get<RoomPersist>('room');
      if (saved) this.core.restore(saved);
      // Nach dem Aufwachen: vorhandene Verbindungen wieder zuordnen
      for (const ws of ctx.getWebSockets()) {
        const conn = this.connFor(ws);
        const memberId = conn.memberId;
        const member = memberId ? this.core.members.get(memberId) : undefined;
        if (member) member.conn = conn;
      }
    });
  }

  private makeCore(roomId: string): RoomCore {
    return new RoomCore(roomId, () => Date.now(), {
      buildId: this.env.BUILD_ID,
      persist: (p) => {
        void this.ctx.storage.put('room', p);
      },
      onMatchEnd: (s) => this.reportMatch(s),
      onEmpty: () => {
        void this.ctx.storage.setAlarm(Date.now() + EMPTY_CLEANUP_MS);
      },
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket erwartet', { status: 426 });
    }
    const roomId = request.headers.get('X-Room-Id') ?? '';
    if (roomId && roomId !== this.core.roomId) {
      this.core.roomId = roomId;
      await this.ctx.storage.put('roomId', roomId);
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ memberId: null } satisfies Attachment);
    this.core.attach(this.connFor(server));
    await this.ctx.storage.deleteAlarm();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = this.connFor(ws);
    const before = conn.memberId;
    this.core.handle(conn, message);
    if (conn.memberId !== before) ws.serializeAttachment({ memberId: conn.memberId } satisfies Attachment);
    this.ensureLoop();
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const conn = this.connFor(ws);
    this.core.detach(conn);
    this.conns.delete(ws);
    const safe = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
    try {
      ws.close(safe, 'bye');
    } catch {
      // schon zu
    }
    this.ensureLoop();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    const conn = this.connFor(ws);
    this.core.detach(conn);
    this.conns.delete(ws);
    this.ensureLoop();
  }

  override async alarm(): Promise<void> {
    // 30 Minuten niemand da → Raum aufräumen
    if (this.ctx.getWebSockets().length === 0) await this.ctx.storage.deleteAll();
  }

  private connFor(ws: WebSocket): Conn {
    let conn = this.conns.get(ws);
    if (!conn) {
      const att = (ws.deserializeAttachment() as Attachment | null) ?? { memberId: null };
      conn = {
        send: (d) => ws.send(d),
        close: (c, r) => ws.close(c, r),
        memberId: att.memberId,
        lastSeen: Date.now(),
      };
      this.conns.set(ws, conn);
    }
    return conn;
  }

  private ensureLoop(): void {
    if (this.core.needsLoop && !this.interval) {
      this.interval = setInterval(() => {
        this.core.tick();
        if (!this.core.needsLoop && this.interval) {
          clearInterval(this.interval);
          this.interval = null;
        }
      }, 50);
    }
  }

  private reportMatch(summary: MatchSummary): void {
    // Ab M3: Ergebnis an den Hub (Statistik, Trophäen)
    void this.env.HUB.get(this.env.HUB.idFromName('global'))
      .reportMatch(summary)
      .catch(() => undefined);
  }
}
