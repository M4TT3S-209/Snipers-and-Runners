import { DurableObject } from 'cloudflare:workers';
import { HEARTBEAT_PING, HEARTBEAT_PONG, type AuthInfo } from '@scope-rush/shared';
import type { Env } from '../env';
import type { MatchSummary } from '../room/RoomCore';
import { HubCore, type HubConn, type Sql, type SqlValue } from './HubCore';
import { generateVapidKeys, sendPush } from '../push/webpush';

/**
 * HubDO – genau eine Instanz („global“): Konten, Freunde, Online-Status,
 * Herausforderungen, Partys, Statistik.
 *
 * Adapter um HubCore:
 *  - SQLite des Durable Objects
 *  - WebSockets über die Hibernation-API (schläft zwischen Nachrichten)
 *  - Heartbeats („ping“) beantwortet Cloudflare automatisch, ohne aufzuwecken
 *  - Alarm für ablaufende Herausforderungen/Codes
 */
interface Attachment {
  accountId: string | null;
  ip: string;
}

export class HubDO extends DurableObject<Env> {
  private readonly core: HubCore;
  private readonly conns = new Map<WebSocket, HubConn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));
    const sql: Sql = {
      exec: (query: string, ...params: SqlValue[]) => ctx.storage.sql.exec(query, ...params).toArray() as Array<Record<string, SqlValue>>,
    };
    this.core = new HubCore(sql, {
      buildId: env.BUILD_ID,
      now: () => Date.now(),
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      sha256: async (text) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      },
      setupRoom: async (roomId, setup) => {
        await env.ROOM.get(env.ROOM.idFromName(roomId)).configure(roomId, setup);
      },
      generateVapid: () => generateVapidKeys(),
      sendPush: (sub, payload, keys) => sendPush(sub, payload, keys, `${(env.ALLOWED_ORIGINS.split(',')[0] ?? '').trim()}/`),
      scheduleAlarm: (at) => {
        void ctx.storage.getAlarm().then((current) => {
          if (current === null || current > at) void ctx.storage.setAlarm(at);
        });
      },
    });
    ctx.blockConcurrencyWhile(async () => {
      this.core.init();
      // Nach dem Aufwachen: Verbindungen wieder zuordnen
      for (const ws of ctx.getWebSockets()) this.core.restoreConn(this.connFor(ws));
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket erwartet', { status: 426 });
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
    server.serializeAttachment({ accountId: null, ip } satisfies Attachment);
    this.core.attach(this.connFor(server));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = this.connFor(ws);
    const before = conn.accountId;
    await this.core.handle(conn, message);
    if (conn.accountId !== before) ws.serializeAttachment({ accountId: conn.accountId, ip: conn.ip } satisfies Attachment);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.drop(ws);
    const safe = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
    try {
      ws.close(safe, 'bye');
    } catch {
      // schon zu
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  override async alarm(): Promise<void> {
    this.core.alarm();
  }

  // ------------------------------------------------------------------ RPC (vom RoomDO)

  async authenticate(token: string): Promise<AuthInfo | null> {
    return this.core.authenticate(token);
  }

  async setInMatch(ids: string[], inMatch: boolean): Promise<void> {
    this.core.setInMatch(ids, inMatch);
  }

  async reportMatch(summary: MatchSummary): Promise<void> {
    this.core.reportMatch(summary);
  }

  // ------------------------------------------------------------------

  private drop(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (conn) this.core.detach(conn);
    this.conns.delete(ws);
  }

  private connFor(ws: WebSocket): HubConn {
    let conn = this.conns.get(ws);
    if (!conn) {
      const att = (ws.deserializeAttachment() as Attachment | null) ?? { accountId: null, ip: '0.0.0.0' };
      conn = {
        send: (d) => ws.send(d),
        close: (c, r) => ws.close(c, r),
        accountId: att.accountId,
        ip: att.ip,
      };
      this.conns.set(ws, conn);
    }
    return conn;
  }
}
