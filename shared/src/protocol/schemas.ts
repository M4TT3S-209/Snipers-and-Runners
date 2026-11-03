import { z } from 'zod';
import type { ClientMessage } from './messages';

/**
 * zod-Schemas für alle Nachrichten Client → Server.
 * Nur der Server importiert diese Datei.
 */

/** Maximale Größe einer Nachricht in Zeichen. */
export const MAX_MESSAGE_CHARS = 4096;

const ClientEchoSchema = z.object({
  t: z.literal('echo'),
  c: z.number().finite(),
});

export const ClientMessageSchema = z.discriminatedUnion('t', [ClientEchoSchema]);

// Sicherstellen, dass Schema und Typ zusammenpassen (Fehler beim Typecheck, falls nicht).
type SchemaType = z.infer<typeof ClientMessageSchema>;
const _typeCheck: [SchemaType] extends [ClientMessage] ? ([ClientMessage] extends [SchemaType] ? true : never) : never = true;
void _typeCheck;

/**
 * Liest eine rohe WebSocket-Nachricht sicher ein.
 * Gibt `null` zurück, wenn sie zu groß, kein gültiges JSON oder ungültig ist.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}
