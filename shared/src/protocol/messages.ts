/**
 * Nachrichten-Typen zwischen Client und Server.
 *
 * Die passenden zod-Schemas (Prüfung auf dem Server) stehen in
 * `schemas.ts` und werden über `@scope-rush/shared/schemas` importiert –
 * so landet zod nicht im Spiel-Bundle.
 *
 * M0: nur der Verbindungstest (Echo + Laufzeitmessung).
 */

// ---------- Client → Server ----------

export interface ClientEcho {
  t: 'echo';
  /** Zeitstempel des Clients (ms), kommt unverändert zurück. */
  c: number;
}

export type ClientMessage = ClientEcho;

// ---------- Server → Client ----------

export interface ServerWelcome {
  t: 'welcome';
  protocol: number;
  server: string;
  /** Wie viele Verbindungen der Hub gerade offen hat (Test). */
  connections: number;
  /** Wie oft das Durable Object schon gestartet ist (SQLite-Test). */
  boots: number;
}

export interface ServerEcho {
  t: 'echo';
  c: number;
  /** Server-Zeit (ms). */
  s: number;
}

export interface ServerError {
  t: 'error';
  code: 'bad_message' | 'rate_limited';
}

export type ServerMessage = ServerWelcome | ServerEcho | ServerError;

/** Antwort von GET /version. */
export interface VersionInfo {
  protocol: number;
  server: string;
}
