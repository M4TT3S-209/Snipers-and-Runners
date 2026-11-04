import { z } from 'zod';
import type { RoomClientMessage } from './room';
import type { HubClientMessage } from './hub';

/**
 * zod-Schemas für alle Nachrichten Client → Server.
 * Nur der Server importiert diese Datei.
 */

/** Maximale Größe einer Nachricht in Zeichen. */
export const MAX_MESSAGE_CHARS = 4096;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
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

// ---------------------------------------------------------------- Hub

const id = z.string().regex(/^[a-z0-9]{6,16}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{20,80}$/);
const name = z.string().min(1).max(40);

export const HubClientSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), v: num.int(), token: token.optional() }),
  z.object({ t: z.literal('createAccount'), name, invite: token.optional() }),
  z.object({ t: z.literal('rename'), name }),
  z.object({ t: z.literal('transferCreate') }),
  z.object({ t: z.literal('transferRedeem'), code: z.string().min(4).max(20) }),
  z.object({ t: z.literal('pairingOffer'), kind: z.enum(['account', 'invite']), invite: token.optional() }),
  z.object({ t: z.literal('pairingCheck') }),
  z.object({ t: z.literal('pairingAccept'), id }),
  z.object({ t: z.literal('inviteCreate') }),
  z.object({ t: z.literal('inviteInfo'), token }),
  z.object({ t: z.literal('inviteRedeem'), token }),
  z.object({ t: z.literal('friendSearch'), name, tag: num.int().min(0).max(9999) }),
  z.object({ t: z.literal('friendRespond'), id, accept: z.boolean() }),
  z.object({ t: z.literal('friendRemove'), id }),
  z.object({ t: z.literal('challenge'), friendId: id }),
  z.object({ t: z.literal('challengeRespond'), id, accept: z.boolean() }),
  z.object({ t: z.literal('challengeCancel'), id }),
  z.object({ t: z.literal('partyCreate') }),
  z.object({ t: z.literal('partyInvite'), friendId: id, roomId: id }),
  z.object({ t: z.literal('partyRespond'), id, accept: z.boolean() }),
  z.object({ t: z.literal('stats') }),
  z.object({ t: z.literal('echo'), c: num }),
]);

const _hubMsgCheck: Same<z.infer<typeof HubClientSchema>['t'], HubClientMessage['t']> = true;
void _hubMsgCheck;

export function parseHubMessage(raw: unknown): HubClientMessage | null {
  const result = HubClientSchema.safeParse(parseJson(raw));
  return result.success ? (result.data as HubClientMessage) : null;
}

/** Liest eine rohe Hub-Nachricht sicher ein (null bei Fehlern). */
export const parseClientMessage = parseHubMessage;
