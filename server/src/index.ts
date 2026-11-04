import { CLOSE_CODES, PROTOCOL_VERSION } from '@scope-rush/shared';
import type { VersionInfo } from '@scope-rush/shared';
import type { Env } from './env';
import { CONFIG_SERVER } from './serverConfig';
import { corsHeaders, isOriginAllowed } from './util/origin';

export { HubDO } from './hub/HubDO';
export { RoomDO } from './room/RoomDO';

/**
 * Einstieg des Workers:
 *  GET /version       → Protokoll- und Server-Version (für Update-Check)
 *  GET /health        → „ok“
 *  GET /hub?v=1       → WebSocket zum HubDO
 *  GET /room/<id>?v=1 → WebSocket zum RoomDO (ab M2)
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const originOk = isOriginAllowed(origin, env.ALLOWED_ORIGINS, env.ENVIRONMENT);

    if (request.method === 'OPTIONS') {
      return originOk && origin
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : new Response(null, { status: 403 });
    }

    if (request.method !== 'GET') {
      return new Response('Methode nicht erlaubt', { status: 405 });
    }

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    if (url.pathname === '/version') {
      const body: VersionInfo = { protocol: PROTOCOL_VERSION, server: env.BUILD_ID };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      };
      if (originOk && origin) Object.assign(headers, corsHeaders(origin));
      return new Response(JSON.stringify(body), { headers });
    }

    const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

    if (url.pathname === '/hub' || url.pathname.startsWith('/room/')) {
      if (!isUpgrade) return new Response('WebSocket erwartet', { status: 426 });
      if (!originOk) return new Response('Herkunft nicht erlaubt', { status: 403 });

      // Falsche Version: Verbindung annehmen und sofort mit eigenem Code
      // schließen – so weiß der Client, dass er neu laden muss.
      if (url.searchParams.get('v') !== String(PROTOCOL_VERSION)) {
        return closeImmediately(CLOSE_CODES.versionMismatch, 'update');
      }

      if (url.pathname === '/hub') {
        const stub = env.HUB.get(env.HUB.idFromName('global'));
        return stub.fetch(request);
      }


      const roomId = url.pathname.slice('/room/'.length);
      if (!CONFIG_SERVER.roomIdPattern.test(roomId)) {
        return new Response('Ungültige Raum-ID', { status: 400 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
      const forward = new Request(request);
      forward.headers.set('X-Room-Id', roomId);
      return stub.fetch(forward);
    }

    return new Response('Nicht gefunden', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function closeImmediately(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
