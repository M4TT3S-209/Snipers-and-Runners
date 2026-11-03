import { DurableObject } from 'cloudflare:workers';
import { CONFIG_SERVER } from '../serverConfig';
import { HEARTBEAT_PING, HEARTBEAT_PONG, PROTOCOL_VERSION, CLOSE_CODES } from '@scope-rush/shared';
import type { ServerMessage } from '@scope-rush/shared';
import { parseClientMessage } from '@scope-rush/shared/schemas';
import type { Env } from '../env';
import { takeToken, type BucketState } from '../util/rateLimit';

/**
 * HubDO – genau eine Instanz („global“).
 *
 * Später: Konten, Freunde, Online-Status, Herausforderungen (SQLite).
 * M0: Verbindungstest mit Echo + Zähler, damit wir sehen, dass
 *  - WebSockets mit der Hibernation-API funktionieren,
 *  - SQLite im Free-Plan funktioniert,
 *  - Heartbeats automatisch beantwortet werden (ohne das DO aufzuwecken).
 */
export class HubDO extends DurableObject<Env> {
  private boots = 0;
  /** Rate-Limit pro Verbindung. Geht beim Schlafen verloren – das ist ok. */
  private readonly buckets = new WeakMap<WebSocket, BucketState>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat „ping“ → „pong“ ohne das Objekt aufzuwecken (kostet nichts).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));

    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'boots'").toArray()[0];
      this.boots = (row ? Number(row.value) : 0) + 1;
      sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('boots', ?)", String(this.boots));
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket erwartet', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation-API: Das DO darf zwischen Nachrichten schlafen.
    this.ctx.acceptWebSocket(server);

    this.send(server, {
      t: 'welcome',
      protocol: PROTOCOL_VERSION,
      server: this.env.BUILD_ID,
      connections: this.ctx.getWebSockets().length,
      boots: this.boots,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    const bucket = this.buckets.get(ws) ?? { tokens: CONFIG_SERVER.hubRateBurst, last: now };
    const { allowed, state } = takeToken(bucket, now, CONFIG_SERVER.hubRateBurst, CONFIG_SERVER.hubRatePerSecond);
    this.buckets.set(ws, state);
    if (!allowed) {
      this.send(ws, { t: 'error', code: 'rate_limited' });
      return;
    }

    const msg = parseClientMessage(message);
    if (!msg) {
      this.send(ws, { t: 'error', code: 'bad_message' });
      return;
    }

    switch (msg.t) {
      case 'echo':
        this.send(ws, { t: 'echo', c: msg.c, s: now });
        break;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Code 1005/1006 darf man nicht selbst senden → normal schließen.
    const safeCode = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
    try {
      ws.close(safeCode, 'bye');
    } catch {
      // schon zu
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(CLOSE_CODES.badClient, 'error');
    } catch {
      // schon zu
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Verbindung schon weg – egal.
    }
  }
}
