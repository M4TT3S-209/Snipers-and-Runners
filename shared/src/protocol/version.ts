/**
 * Protokollversion zwischen Client und Server.
 *
 * Immer erhöhen, wenn sich Nachrichten so ändern, dass alte Clients nicht
 * mehr mit dem neuen Server sprechen können. Der Client zeigt dann
 * „Update verfügbar – neu laden“.
 */
export const PROTOCOL_VERSION = 1;

/** Name des Heartbeats, den der Server automatisch beantwortet (ohne aufzuwachen). */
export const HEARTBEAT_PING = 'ping';
export const HEARTBEAT_PONG = 'pong';

/** WebSocket-Schließcodes (4000–4999 sind für Anwendungen frei). */
export const CLOSE_CODES = {
  /** Client ist zu alt oder zu neu → neu laden. */
  versionMismatch: 4001,
  /** Ungültige Nachrichten oder zu viele davon. */
  badClient: 4002,
  /** Herkunft (Origin) nicht erlaubt. */
  forbiddenOrigin: 4003,
} as const;
