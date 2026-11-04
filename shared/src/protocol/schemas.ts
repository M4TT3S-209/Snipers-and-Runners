import { z } from 'zod';
import type { ClientMessage } from './messages';
import type { RoomClientMessage } from './room';

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
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _hubCheck: Same<z.infer<typeof ClientMessageSchema>, ClientMessage> = true;
void _hubCheck;

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Liest eine rohe WebSocket-Nachricht sicher ein.
 * Gibt `null` zurück, wenn sie zu groß, kein gültiges JSON oder ungültig ist.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  const result = ClientMessageSchema.safeParse(parseJson(raw));
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------- Raum

const num = z.number().finite();
const vec = z.tuple([num.min(-2).max(2), num.min(-2).max(2), num.min(-2).max(2)]);
const weapon = z.enum(['precision', 'semi', 'rocket']);
const gadget = z.enum(['smoke', 'shield', 'sprint', 'decoy']);
const action = z.enum(['left', 'right', 'jump', 'slide', 'duckOn', 'duckOff', 'gadget']);

export const RoomClientSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    name: z.string().max(40),
    key: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
    token: z.string().max(100).optional(),
    spectate: z.boolean().optional(),
  }),
  z.object({ t: z.literal('sync'), c: num }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  z.object({ t: z.literal('mode'), mode: z.enum(['duel', 'classic']) }),
  z.object({ t: z.literal('loadout'), weapon: weapon.optional(), gadget: gadget.nullable().optional(), ready: z.boolean() }),
  z.object({ t: z.literal('in'), k: num.int().min(0).max(100000), a: action }),
  z.object({ t: z.literal('aim'), d: vec, z: num.int().min(0).max(3) }),
  z.object({ t: z.literal('fire'), d: vec, v: num.min(0).max(100000) }),
  z.object({ t: z.literal('rematch') }),
  z.object({ t: z.literal('wait') }),
  z.object({ t: z.literal('claim') }),
  z.object({ t: z.literal('leave') }),
]);

type RoomParsed = z.infer<typeof RoomClientSchema>;
// zod macht optionale Felder zu `T | undefined` – für den Vergleich angleichen
type Loose<T> = { [K in keyof T]: T[K] };
const _roomCheck: Same<Loose<RoomParsed>['t'], RoomClientMessage['t']> = true;
void _roomCheck;

export function parseRoomMessage(raw: unknown): RoomClientMessage | null {
  const result = RoomClientSchema.safeParse(parseJson(raw));
  return result.success ? (result.data as RoomClientMessage) : null;
}
