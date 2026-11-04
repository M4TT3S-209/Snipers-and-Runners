import type { MatchMode } from '../rules/match';

/**
 * Protokoll zwischen Client und Hub (Konten, Freunde, Online-Status,
 * Herausforderungen, Party-Einladungen, Statistik).
 */

export type PresenceStatus = 'online' | 'match' | 'offline';

export interface AccountInfo {
  id: string;
  name: string;
  tag: number;
}

export interface FriendInfo extends AccountInfo {
  status: PresenceStatus;
  /** zuletzt gesehen (ms) */
  lastSeen: number;
}

export interface ChallengeInfo {
  id: string;
  from: AccountInfo;
  to: AccountInfo;
  mode: MatchMode;
  createdAt: number;
  expiresAt: number;
}

export interface PartyInviteInfo {
  id: string;
  from: AccountInfo;
  roomId: string;
  expiresAt: number;
}

export interface PairingOffer {
  id: string;
  kind: 'account' | 'invite';
  /** kind=account: das Konto, das übernommen werden kann */
  account?: AccountInfo;
  /** kind=invite: wer einlädt */
  from?: AccountInfo;
}

export interface HeadToHead {
  friendId: string;
  wins: number;
  losses: number;
  draws: number;
}

export interface StatsInfo {
  wins: number;
  losses: number;
  draws: number;
  trophies: number;
  partyGames: number;
  headToHead: HeadToHead[];
  /** Rangliste (Freunde + ich), nach Trophäen */
  leaderboard: Array<AccountInfo & { trophies: number; wins: number; losses: number }>;
}

// ---------------------------------------------------------------- Client → Hub

export type HubClientMessage =
  | { t: 'hello'; v: number; token?: string }
  | { t: 'createAccount'; name: string; invite?: string }
  | { t: 'rename'; name: string }
  | { t: 'transferCreate' }
  | { t: 'transferRedeem'; code: string }
  | { t: 'pairingOffer'; kind: 'account' | 'invite'; invite?: string }
  | { t: 'pairingCheck' }
  | { t: 'pairingAccept'; id: string }
  | { t: 'inviteCreate' }
  | { t: 'inviteInfo'; token: string }
  | { t: 'inviteRedeem'; token: string }
  | { t: 'friendSearch'; name: string; tag: number }
  | { t: 'friendRespond'; id: string; accept: boolean }
  | { t: 'friendRemove'; id: string }
  | { t: 'challenge'; friendId: string }
  | { t: 'challengeRespond'; id: string; accept: boolean }
  | { t: 'challengeCancel'; id: string }
  | { t: 'partyCreate' }
  | { t: 'partyInvite'; friendId: string; roomId: string }
  | { t: 'partyRespond'; id: string; accept: boolean }
  | { t: 'stats' }
  | { t: 'echo'; c: number };

// ---------------------------------------------------------------- Hub → Client

export type HubErrorCode =
  | 'bad_message'
  | 'rate_limited'
  | 'bad_token'
  | 'bad_name'
  | 'not_found'
  | 'not_friends'
  | 'already_friends'
  | 'self'
  | 'expired'
  | 'too_many'
  | 'busy'
  | 'need_account';

export type HubServerMessage =
  | {
      t: 'welcome';
      me: AccountInfo;
      friends: FriendInfo[];
      incoming: AccountInfo[];
      outgoing: AccountInfo[];
      challenges: ChallengeInfo[];
      parties: PartyInviteInfo[];
      protocol: number;
      server: string;
    }
  | { t: 'needAccount'; protocol: number; server: string }
  | { t: 'account'; me: AccountInfo; token: string }
  | { t: 'friends'; friends: FriendInfo[]; incoming: AccountInfo[]; outgoing: AccountInfo[] }
  | { t: 'presence'; id: string; status: PresenceStatus; lastSeen: number }
  | { t: 'friendAdded'; friend: AccountInfo }
  | { t: 'friendRequest'; from: AccountInfo }
  | { t: 'challengeIncoming'; challenge: ChallengeInfo }
  | { t: 'challengeSent'; challenge: ChallengeInfo }
  | { t: 'challengeClosed'; id: string; reason: 'declined' | 'expired' | 'cancelled' | 'accepted' | 'gone' }
  | { t: 'roomReady'; roomId: string; reason: 'challenge' | 'party' }
  | { t: 'partyInvite'; invite: PartyInviteInfo }
  | { t: 'invite'; token: string; expiresAt: number }
  | { t: 'inviteInfo'; token: string; from: AccountInfo | null }
  | { t: 'transferCode'; code: string; expiresAt: number }
  | { t: 'pairing'; offers: PairingOffer[] }
  | { t: 'stats'; stats: StatsInfo }
  | { t: 'echo'; c: number; s: number }
  | { t: 'error'; code: HubErrorCode; ctx?: string };

/** „Max#4821“ */
export function formatTag(a: { name: string; tag: number }): string {
  return `${a.name}#${String(a.tag).padStart(4, '0')}`;
}

/** „Max#4821“ → { name, tag } */
export function parseTag(input: string): { name: string; tag: number } | null {
  const m = /^\s*(.{2,14}?)\s*#\s*(\d{1,4})\s*$/u.exec(input);
  if (!m) return null;
  return { name: m[1]!, tag: Number(m[2]) };
}
