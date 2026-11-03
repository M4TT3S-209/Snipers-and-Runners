import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/**
 * RoomDO – ein Objekt pro Duell bzw. Party (Lobby + Match-Simulation).
 *
 * M0: nur das Gerüst, damit die Migration (new_sqlite_classes) von Anfang an
 * beide Klassen enthält. Die Spiel-Logik kommt in M2.
 */
export class RoomDO extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response('Räume kommen in M2', { status: 501 });
  }
}
