/**
 * Standard-Nachrichten der Hub-Verbindung (für den M0-Gerätetest und die
 * generische Socket-Klasse). Das eigentliche Protokoll steht in `hub.ts`.
 */
import type { HubClientMessage, HubServerMessage } from './hub';

export type ClientMessage = HubClientMessage;
export type ServerMessage = HubServerMessage;

/** Antwort von GET /version. */
export interface VersionInfo {
  protocol: number;
  server: string;
}
