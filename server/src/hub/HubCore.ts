import {
  CONFIG,
  PROTOCOL_VERSION,
  checkName,
  sanitizeCosmetics,
  type AuthInfo,
  type Profile,
  type AccountInfo,
  type ChallengeInfo,
  type FriendInfo,
  type HubErrorCode,
  type HubServerMessage,
  type PairingOffer,
  type PartyInviteInfo,
  type PresenceStatus,
  type StatsInfo,
} from '@scope-rush/shared';
import { parseHubMessage } from '@scope-rush/shared/schemas';
import { takeToken, type BucketState } from '../util/rateLimit';
import type { MatchSummary } from '../room/RoomCore';

/**
 * Hub-Logik (Konten, Freunde, Status, Herausforderungen, Partys, Statistik)
 * – ohne Cloudflare-Abhängigkeit, damit sie mit SQLite in Node getestet
 * werden kann. Der HubDO ist nur der Adapter.
 */

export type SqlValue = string | number | null;
export interface Sql {
  exec(query: string, ...params: SqlValue[]): Array<Record<string, SqlValue>>;
}

export interface HubConn {
  send(data: string): void;
  close(code: number, reason: string): void;
  accountId: string | null;
  ip: string;
  bucket?: BucketState;
}

export interface RoomSetup {
  mode: 'duel' | 'classic';
  /** Erwartete Spieler (Konto-IDs) */
  expected: string[];
  /** Startet automatisch, sobald alle Erwarteten da sind (Herausforderung) */
  auto: boolean;
  hostId: string | null;
}

export interface HubHooks {
  buildId: string;
  now(): number;
  randomBytes(n: number): Uint8Array;
  sha256(text: string): Promise<string>;
  setupRoom(roomId: string, setup: RoomSetup): Promise<void>;
  scheduleAlarm(at: number): void;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const CHALLENGE_ONLINE_MS = CONFIG.social.challengeTimeoutS * 1000;
const INBOX_MS = CONFIG.social.inboxTtlMin * MIN;
const INVITE_MS = CONFIG.social.inviteLinkTtlDays * DAY;
const TRANSFER_MS = CONFIG.social.transferCodeTtlMin * MIN;
const PAIRING_MS = CONFIG.social.pairingTtlMin * MIN;
const PARTY_INVITE_MS = 5 * MIN;
const IN_MATCH_MS = 2 * 60 * MIN;
const ACCOUNTS_PER_IP_PER_DAY = 5;
const RATE_BURST = 20;
const RATE_PER_S = 5;
const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const SCHEMA_VERSION = 1;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_lc TEXT NOT NULL, tag INTEGER NOT NULL,
    created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, in_match_until INTEGER NOT NULL DEFAULT 0,
    trophies INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0, party_games INTEGER NOT NULL DEFAULT 0, cosmetics TEXT NOT NULL DEFAULT '{}',
    UNIQUE(name_lc, tag))`,
  `CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS friendships (a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (a, b))`,
  `CREATE TABLE IF NOT EXISTS friend_requests (from_id TEXT NOT NULL, to_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id))`,
  `CREATE TABLE IF NOT EXISTS invite_links (hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS party_invites (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, room_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS transfer_codes (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pairings (id TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, kind TEXT NOT NULL, account_id TEXT, invite_hash TEXT, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, mode TEXT NOT NULL, ended_at INTEGER NOT NULL, winner_id TEXT, draw INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS match_players (match_id TEXT NOT NULL, account_id TEXT NOT NULL, result TEXT NOT NULL, points INTEGER NOT NULL, trophies_delta INTEGER NOT NULL, PRIMARY KEY (match_id, account_id))`,
  `CREATE TABLE IF NOT EXISTS unlocks (account_id TEXT NOT NULL, item_id TEXT NOT NULL, unlocked_at INTEGER NOT NULL, PRIMARY KEY (account_id, item_id))`,
  `CREATE TABLE IF NOT EXISTS ip_limits (ip_hash TEXT NOT NULL, day INTEGER NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (ip_hash, day, kind))`,
  `CREATE INDEX IF NOT EXISTS idx_mp_account ON match_players (account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_challenges_to ON challenges (to_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_pairings_ip ON pairings (ip_hash)`,
];

export class HubCore {
  private readonly conns = new Set<HubConn>();
  private readonly byAccount = new Map<string, Set<HubConn>>();
  private ipSalt = '';

  constructor(
    private readonly sql: Sql,
    private readonly hooks: HubHooks,
  ) {}

  init(): void {
    for (const q of SCHEMA) this.sql.exec(q);
    const v = this.sql.exec(`SELECT value FROM meta WHERE key = 'schema'`)[0];
    if (!v) this.sql.exec(`INSERT INTO meta (key, value) VALUES ('schema', ?)`, String(SCHEMA_VERSION));
    const salt = this.sql.exec(`SELECT value FROM meta WHERE key = 'ipSalt'`)[0];
    if (salt) this.ipSalt = String(salt.value);
    else {
      this.ipSalt = this.randomString(24, TOKEN_CHARS);
      this.sql.exec(`INSERT INTO meta (key, value) VALUES ('ipSalt', ?)`, this.ipSalt);
    }
  }

  /** Nach dem Aufwachen: bestehende Verbindungen wieder anmelden */
  restoreConn(conn: HubConn): void {
    this.conns.add(conn);
    if (conn.accountId) this.indexConn(conn.accountId, conn);
  }

  attach(conn: HubConn): void {
    this.conns.add(conn);
  }

  detach(conn: HubConn): void {
    this.conns.delete(conn);
    const id = conn.accountId;
    if (!id) return;
    const set = this.byAccount.get(id);
    set?.delete(conn);
    if (set && set.size === 0) {
      this.byAccount.delete(id);
      this.sql.exec(`UPDATE accounts SET last_seen = ? WHERE id = ?`, this.now(), id);
      this.broadcastPresence(id);
    }
  }

  // ------------------------------------------------------------------ RPC vom Raum

  async authenticate(token: string): Promise<AuthInfo | null> {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
    const hash = await this.hooks.sha256(token);
    const row = this.sql.exec(`SELECT a.id FROM tokens t JOIN accounts a ON a.id = t.account_id WHERE t.hash = ?`, hash)[0];
    if (!row) return null;
    const account = this.account(String(row.id))!;
    return { ...account, ...this.profile(account.id) };
  }

  profile(id: string): Profile {
    const r = this.sql.exec(`SELECT trophies, cosmetics FROM accounts WHERE id = ?`, id)[0];
    const trophies = Number(r?.trophies ?? 0);
    let raw: unknown = {};
    try {
      raw = JSON.parse(String(r?.cosmetics ?? '{}'));
    } catch {
      raw = {};
    }
    return { trophies, cosmetics: sanitizeCosmetics(raw, trophies) };
  }

  setInMatch(ids: string[], inMatch: boolean): void {
    for (const id of ids) {
      this.sql.exec(`UPDATE accounts SET in_match_until = ? WHERE id = ?`, inMatch ? this.now() + IN_MATCH_MS : 0, id);
      this.broadcastPresence(id);
    }
  }

  reportMatch(s: MatchSummary): void {
    this.recordMatch(s);
    for (const p of s.players) if (p.accountId) this.sendToAccount(p.accountId, { t: 'profile', profile: this.profile(p.accountId) });
  }

  private recordMatch(s: MatchSummary): void {
    const players = s.players.filter((p) => p.accountId);
    this.setInMatch(
      players.map((p) => p.accountId!),
      false,
    );
    if (players.length < 2) return;
    const id = this.randomString(12, ID_CHARS);
    this.sql.exec(`INSERT INTO matches (id, mode, ended_at, winner_id, draw) VALUES (?, ?, ?, ?, ?)`, id, s.mode, this.now(), s.winnerId, s.draw ? 1 : 0);
    if (s.mode === 'duel') {
      for (const p of players) {
        const result = s.draw ? 'draw' : p.id === s.winnerId ? 'win' : 'loss';
        const delta = result === 'win' ? CONFIG.trophies.win : result === 'loss' ? CONFIG.trophies.loss : CONFIG.trophies.draw;
        this.sql.exec(
          `INSERT INTO match_players (match_id, account_id, result, points, trophies_delta) VALUES (?, ?, ?, ?, ?)`,
          id,
          p.accountId!,
          result,
          s.roundWins[p.id] ?? 0,
          delta,
        );
        const col = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
        this.sql.exec(`UPDATE accounts SET ${col} = ${col} + 1, trophies = trophies + ? WHERE id = ?`, delta, p.accountId!);
      }
    } else {
      const ranked = [...players].sort((a, b) => (s.scores[b.id] ?? 0) - (s.scores[a.id] ?? 0));
      const table = CONFIG.trophies.partyPlacement;
      ranked.forEach((p, place) => {
        const delta = table[Math.min(place, table.length - 1)] ?? 0;
        this.sql.exec(
          `INSERT INTO match_players (match_id, account_id, result, points, trophies_delta) VALUES (?, ?, ?, ?, ?)`,
          id,
          p.accountId!,
          place === 0 ? 'win' : 'place',
          s.scores[p.id] ?? 0,
          delta,
        );
        this.sql.exec(`UPDATE accounts SET party_games = party_games + 1, trophies = trophies + ? WHERE id = ?`, delta, p.accountId!);
      });
    }
  }

  // ------------------------------------------------------------------ Nachrichten

  async handle(conn: HubConn, raw: unknown): Promise<void> {
    const now = this.now();
    const { allowed, state } = takeToken(conn.bucket ?? { tokens: RATE_BURST, last: now }, now, RATE_BURST, RATE_PER_S);
    conn.bucket = state;
    if (!allowed) return this.error(conn, 'rate_limited');
    const msg = parseHubMessage(raw);
    if (!msg) return this.error(conn, 'bad_message');

    // Ohne Konto erlaubt:
    switch (msg.t) {
      case 'echo':
        return this.send(conn, { t: 'echo', c: msg.c, s: now });
      case 'hello':
        return this.hello(conn, msg.token);
      case 'createAccount':
        return this.createAccount(conn, msg.name, msg.invite);
      case 'transferRedeem':
        return this.transferRedeem(conn, msg.code);
      case 'pairingOffer':
        if (msg.kind === 'invite' && msg.invite) return this.pairingOffer(conn, 'invite', msg.invite);
        break;
      case 'pairingCheck':
        return this.pairingCheck(conn);
      case 'pairingAccept':
        return this.pairingAccept(conn, msg.id);
      case 'inviteInfo':
        return this.inviteInfo(conn, msg.token);
      default:
        break;
    }

    const me = conn.accountId;
    if (!me) return this.error(conn, 'need_account', msg.t);

    switch (msg.t) {
      case 'rename': {
        const check = checkName(msg.name);
        if (!check.ok) return this.error(conn, 'bad_name');
        const tag = this.freeTag(check.name.toLowerCase());
        this.sql.exec(`UPDATE accounts SET name = ?, name_lc = ?, tag = ? WHERE id = ?`, check.name, check.name.toLowerCase(), tag, me);
        return this.sendWelcome(conn, me);
      }
      case 'pairingOffer':
        return this.pairingOffer(conn, 'account', null);
      case 'transferCreate':
        return this.transferCreate(conn, me);
      case 'inviteCreate':
        return this.inviteCreate(conn, me);
      case 'inviteRedeem':
        return this.inviteRedeem(conn, me, msg.token);
      case 'friendSearch':
        return this.friendSearch(conn, me, msg.name, msg.tag);
      case 'friendRespond':
        return this.friendRespond(me, msg.id, msg.accept);
      case 'friendRemove':
        this.sql.exec(`DELETE FROM friendships WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)`, me, msg.id, msg.id, me);
        this.pushFriends(me);
        this.pushFriends(msg.id);
        return;
      case 'challenge':
        return this.challenge(conn, me, msg.friendId);
      case 'challengeRespond':
        return this.challengeRespond(conn, me, msg.id, msg.accept);
      case 'challengeCancel':
        return this.closeChallenge(msg.id, 'cancelled', me);
      case 'partyCreate':
        return this.partyCreate(conn, me);
      case 'partyInvite':
        return this.partyInvite(conn, me, msg.friendId, msg.roomId);
      case 'partyRespond':
        return this.partyRespond(conn, me, msg.id, msg.accept);
      case 'stats':
        return this.send(conn, { t: 'stats', stats: this.stats(me) });
      case 'cosmetics': {
        const trophies = this.profile(me).trophies;
        const c = sanitizeCosmetics({ skin: msg.skin, emote: msg.emote }, trophies);
        this.sql.exec(`UPDATE accounts SET cosmetics = ? WHERE id = ?`, JSON.stringify(c), me);
        return this.sendToAccount(me, { t: 'profile', profile: this.profile(me) });
      }
      default:
        return;
    }
  }

  /** Abgelaufenes aufräumen. Gibt den nächsten Zeitpunkt zurück, an dem wieder etwas abläuft. */
  alarm(): void {
    const now = this.now();
    const expired = this.sql.exec(`SELECT id, from_id, to_id FROM challenges WHERE status = 'pending' AND expires_at <= ?`, now);
    for (const c of expired) {
      this.sql.exec(`UPDATE challenges SET status = 'expired' WHERE id = ?`, String(c.id));
      for (const id of [String(c.from_id), String(c.to_id)]) this.sendToAccount(id, { t: 'challengeClosed', id: String(c.id), reason: 'expired' });
    }
    this.sql.exec(`DELETE FROM challenges WHERE status != 'pending' AND created_at < ?`, now - DAY);
    this.sql.exec(`DELETE FROM pairings WHERE expires_at <= ?`, now);
    this.sql.exec(`DELETE FROM transfer_codes WHERE expires_at <= ?`, now);
    this.sql.exec(`DELETE FROM invite_links WHERE expires_at <= ?`, now);
    this.sql.exec(`DELETE FROM party_invites WHERE expires_at <= ?`, now);
    this.sql.exec(`DELETE FROM ip_limits WHERE day < ?`, Math.floor(now / DAY) - 2);
    this.scheduleNextAlarm();
  }

  // ------------------------------------------------------------------ Konto

  private async hello(conn: HubConn, token?: string): Promise<void> {
    if (token) {
      const account = await this.authenticate(token);
      if (account) {
        this.bindConn(conn, account.id);
        this.sql.exec(`UPDATE accounts SET last_seen = ? WHERE id = ?`, this.now(), account.id);
        return this.sendWelcome(conn, account.id);
      }
      this.error(conn, 'bad_token');
    }
    this.send(conn, { t: 'needAccount', protocol: PROTOCOL_VERSION, server: this.hooks.buildId });
  }

  private async createAccount(conn: HubConn, rawName: string, invite?: string): Promise<void> {
    if (conn.accountId) return this.sendWelcome(conn, conn.accountId);
    const check = checkName(rawName);
    if (!check.ok) return this.error(conn, 'bad_name');
    const ipHash = await this.ipHash(conn.ip);
    if (!this.countIp(ipHash, 'account', ACCOUNTS_PER_IP_PER_DAY)) return this.error(conn, 'too_many');
    const id = this.randomString(12, ID_CHARS);
    const nameLc = check.name.toLowerCase();
    const tag = this.freeTag(nameLc);
    const now = this.now();
    this.sql.exec(
      `INSERT INTO accounts (id, name, name_lc, tag, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      check.name,
      nameLc,
      tag,
      now,
      now,
    );
    const token = await this.issueToken(id);
    this.bindConn(conn, id);
    this.send(conn, { t: 'account', me: { id, name: check.name, tag }, token });
    if (invite) await this.inviteRedeem(conn, id, invite);
    this.sendWelcome(conn, id);
  }

  private async issueToken(accountId: string): Promise<string> {
    const token = this.randomString(43, TOKEN_CHARS);
    this.sql.exec(`INSERT INTO tokens (hash, account_id, created_at) VALUES (?, ?, ?)`, await this.hooks.sha256(token), accountId, this.now());
    return token;
  }

  private freeTag(nameLc: string): number {
    for (let i = 0; i < 50; i++) {
      const bytes = this.hooks.randomBytes(2);
      const tag = 1000 + (((bytes[0]! << 8) | bytes[1]!) % 9000);
      if (!this.sql.exec(`SELECT 1 FROM accounts WHERE name_lc = ? AND tag = ?`, nameLc, tag)[0]) return tag;
    }
    throw new Error('Kein freier Tag');
  }

  private async transferCreate(conn: HubConn, me: string): Promise<void> {
    const raw = this.randomString(8, CODE_CHARS);
    const expiresAt = this.now() + TRANSFER_MS;
    this.sql.exec(`DELETE FROM transfer_codes WHERE account_id = ?`, me);
    this.sql.exec(`INSERT INTO transfer_codes (hash, account_id, expires_at) VALUES (?, ?, ?)`, await this.hooks.sha256(raw), me, expiresAt);
    this.scheduleNextAlarm();
    this.send(conn, { t: 'transferCode', code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt });
  }

  private async transferRedeem(conn: HubConn, code: string): Promise<void> {
    const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length !== 8) return this.error(conn, 'not_found');
    const hash = await this.hooks.sha256(raw);
    const row = this.sql.exec(`SELECT account_id FROM transfer_codes WHERE hash = ? AND expires_at > ?`, hash, this.now())[0];
    if (!row) return this.error(conn, 'not_found', 'transfer');
    this.sql.exec(`DELETE FROM transfer_codes WHERE hash = ?`, hash);
    await this.loginAs(conn, String(row.account_id));
  }

  private async loginAs(conn: HubConn, accountId: string): Promise<void> {
    const account = this.account(accountId);
    if (!account) return this.error(conn, 'not_found');
    if (conn.accountId && conn.accountId !== accountId) {
      this.detach(conn);
      conn.accountId = null;
      this.conns.add(conn);
    }
    const token = await this.issueToken(accountId);
    this.bindConn(conn, accountId);
    this.send(conn, { t: 'account', me: account, token });
    this.sendWelcome(conn, accountId);
  }

  // ------------------------------------------------------------------ Kopplung (Safari ↔ Home-Bildschirm-App)

  private async pairingOffer(conn: HubConn, kind: 'account' | 'invite', invite: string | null): Promise<void> {
    const ipHash = await this.ipHash(conn.ip);
    const id = this.randomString(10, ID_CHARS);
    const expires = this.now() + PAIRING_MS;
    if (kind === 'account') {
      if (!conn.accountId) return;
      this.sql.exec(`DELETE FROM pairings WHERE kind = 'account' AND account_id = ?`, conn.accountId);
      this.sql.exec(`INSERT INTO pairings (id, ip_hash, kind, account_id, expires_at) VALUES (?, ?, 'account', ?, ?)`, id, ipHash, conn.accountId, expires);
    } else if (invite) {
      const inviteHash = await this.hooks.sha256(invite);
      if (!this.sql.exec(`SELECT 1 FROM invite_links WHERE hash = ? AND expires_at > ?`, inviteHash, this.now())[0]) return;
      this.sql.exec(`DELETE FROM pairings WHERE kind = 'invite' AND ip_hash = ? AND invite_hash = ?`, ipHash, inviteHash);
      this.sql.exec(`INSERT INTO pairings (id, ip_hash, kind, invite_hash, expires_at) VALUES (?, ?, 'invite', ?, ?)`, id, ipHash, inviteHash, expires);
    }
    this.scheduleNextAlarm();
  }

  private async pairingCheck(conn: HubConn): Promise<void> {
    const ipHash = await this.ipHash(conn.ip);
    const rows = this.sql.exec(`SELECT * FROM pairings WHERE ip_hash = ? AND expires_at > ? ORDER BY expires_at DESC`, ipHash, this.now());
    const offers: PairingOffer[] = [];
    for (const r of rows) {
      if (r.kind === 'account' && !conn.accountId) {
        const account = this.account(String(r.account_id));
        if (account) offers.push({ id: String(r.id), kind: 'account', account });
      } else if (r.kind === 'invite' && conn.accountId) {
        const owner = this.sql.exec(`SELECT owner_id FROM invite_links WHERE hash = ?`, String(r.invite_hash))[0];
        const from = owner ? this.account(String(owner.owner_id)) : null;
        if (from && from.id !== conn.accountId && !this.areFriends(from.id, conn.accountId)) offers.push({ id: String(r.id), kind: 'invite', from });
      }
    }
    this.send(conn, { t: 'pairing', offers });
  }

  private async pairingAccept(conn: HubConn, id: string): Promise<void> {
    const ipHash = await this.ipHash(conn.ip);
    const r = this.sql.exec(`SELECT * FROM pairings WHERE id = ? AND ip_hash = ? AND expires_at > ?`, id, ipHash, this.now())[0];
    if (!r) return this.error(conn, 'expired', 'pairing');
    this.sql.exec(`DELETE FROM pairings WHERE id = ?`, id);
    if (r.kind === 'account' && !conn.accountId) {
      await this.loginAs(conn, String(r.account_id));
    } else if (r.kind === 'invite' && conn.accountId) {
      const owner = this.sql.exec(`SELECT owner_id FROM invite_links WHERE hash = ? AND expires_at > ?`, String(r.invite_hash), this.now())[0];
      if (owner) this.makeFriends(String(owner.owner_id), conn.accountId);
    }
  }

  // ------------------------------------------------------------------ Einladungslinks

  private async inviteCreate(conn: HubConn, me: string): Promise<void> {
    const token = this.randomString(24, TOKEN_CHARS);
    const expiresAt = this.now() + INVITE_MS;
    this.sql.exec(`INSERT INTO invite_links (hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)`, await this.hooks.sha256(token), me, this.now(), expiresAt);
    this.send(conn, { t: 'invite', token, expiresAt });
  }

  private async inviteInfo(conn: HubConn, token: string): Promise<void> {
    const row = this.sql.exec(`SELECT owner_id FROM invite_links WHERE hash = ? AND expires_at > ?`, await this.hooks.sha256(token), this.now())[0];
    this.send(conn, { t: 'inviteInfo', token, from: row ? this.account(String(row.owner_id)) : null });
  }

  private async inviteRedeem(conn: HubConn, me: string, token: string): Promise<void> {
    const hash = await this.hooks.sha256(token);
    const row = this.sql.exec(`SELECT owner_id FROM invite_links WHERE hash = ? AND expires_at > ?`, hash, this.now())[0];
    if (!row) return this.error(conn, 'expired', 'invite');
    const owner = String(row.owner_id);
    if (owner === me) return this.error(conn, 'self');
    this.sql.exec(`UPDATE invite_links SET uses = uses + 1 WHERE hash = ?`, hash);
    this.makeFriends(owner, me);
  }

  // ------------------------------------------------------------------ Freunde

  private friendSearch(conn: HubConn, me: string, name: string, tag: number): void {
    const target = this.sql.exec(`SELECT id, name, tag FROM accounts WHERE name_lc = ? AND tag = ?`, name.trim().toLowerCase(), tag)[0];
    if (!target) return this.error(conn, 'not_found', 'friend');
    const id = String(target.id);
    if (id === me) return this.error(conn, 'self');
    if (this.areFriends(me, id)) return this.error(conn, 'already_friends');
    // Hat der andere mich schon angefragt? Dann direkt befreunden.
    if (this.sql.exec(`SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?`, id, me)[0]) {
      this.makeFriends(me, id);
      return;
    }
    this.sql.exec(`INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)`, me, id, this.now());
    const meInfo = this.account(me)!;
    this.sendToAccount(id, { t: 'friendRequest', from: meInfo });
    this.pushFriends(id);
    this.pushFriends(me);
  }

  private friendRespond(me: string, from: string, accept: boolean): void {
    const exists = this.sql.exec(`SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?`, from, me)[0];
    if (!exists) return;
    this.sql.exec(`DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?`, from, me);
    if (accept) this.makeFriends(from, me);
    else {
      this.pushFriends(me);
      this.pushFriends(from);
    }
  }

  private makeFriends(x: string, y: string): void {
    if (x === y) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    this.sql.exec(`INSERT OR IGNORE INTO friendships (a, b, created_at) VALUES (?, ?, ?)`, a, b, this.now());
    this.sql.exec(`DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)`, x, y, y, x);
    const ax = this.account(x);
    const ay = this.account(y);
    if (ax) this.sendToAccount(y, { t: 'friendAdded', friend: ax });
    if (ay) this.sendToAccount(x, { t: 'friendAdded', friend: ay });
    this.pushFriends(x);
    this.pushFriends(y);
  }

  private areFriends(x: string, y: string): boolean {
    const [a, b] = x < y ? [x, y] : [y, x];
    return !!this.sql.exec(`SELECT 1 FROM friendships WHERE a = ? AND b = ?`, a, b)[0];
  }

  private friendIds(id: string): string[] {
    return this.sql.exec(`SELECT CASE WHEN a = ? THEN b ELSE a END AS f FROM friendships WHERE a = ? OR b = ?`, id, id, id).map((r) => String(r.f));
  }

  private friendList(id: string): FriendInfo[] {
    const rows = this.sql.exec(
      `SELECT x.id, x.name, x.tag, x.last_seen, x.in_match_until FROM accounts x
       JOIN friendships f ON (f.a = ? AND f.b = x.id) OR (f.b = ? AND f.a = x.id)
       ORDER BY x.name_lc`,
      id,
      id,
    );
    return rows.map((r) => ({ ...toAccount(r), status: this.presenceOf(String(r.id), Number(r.in_match_until)), lastSeen: Number(r.last_seen) }));
  }

  private requests(id: string): { incoming: AccountInfo[]; outgoing: AccountInfo[] } {
    const incoming = this.sql.exec(`SELECT a.id, a.name, a.tag FROM friend_requests r JOIN accounts a ON a.id = r.from_id WHERE r.to_id = ?`, id).map(toAccount);
    const outgoing = this.sql.exec(`SELECT a.id, a.name, a.tag FROM friend_requests r JOIN accounts a ON a.id = r.to_id WHERE r.from_id = ?`, id).map(toAccount);
    return { incoming, outgoing };
  }

  private pushFriends(id: string): void {
    if (!this.byAccount.has(id)) return;
    this.sendToAccount(id, { t: 'friends', friends: this.friendList(id), ...this.requests(id) });
  }

  private presenceOf(id: string, inMatchUntil?: number): PresenceStatus {
    const online = (this.byAccount.get(id)?.size ?? 0) > 0;
    if (!online) return 'offline';
    const until = inMatchUntil ?? Number(this.sql.exec(`SELECT in_match_until FROM accounts WHERE id = ?`, id)[0]?.in_match_until ?? 0);
    return until > this.now() ? 'match' : 'online';
  }

  private broadcastPresence(id: string): void {
    const status = this.presenceOf(id);
    const lastSeen = Number(this.sql.exec(`SELECT last_seen FROM accounts WHERE id = ?`, id)[0]?.last_seen ?? 0);
    for (const f of this.friendIds(id)) this.sendToAccount(f, { t: 'presence', id, status, lastSeen });
  }

  // ------------------------------------------------------------------ Herausforderungen

  private challenge(conn: HubConn, me: string, friendId: string): void {
    if (!this.areFriends(me, friendId)) return this.error(conn, 'not_friends');
    // eine offene Herausforderung pro Paar
    this.sql.exec(`UPDATE challenges SET status = 'cancelled' WHERE from_id = ? AND to_id = ? AND status = 'pending'`, me, friendId);
    const online = (this.byAccount.get(friendId)?.size ?? 0) > 0;
    const now = this.now();
    const c: ChallengeInfo = {
      id: this.randomString(10, ID_CHARS),
      from: this.account(me)!,
      to: this.account(friendId)!,
      mode: 'duel',
      createdAt: now,
      expiresAt: now + (online ? CHALLENGE_ONLINE_MS : INBOX_MS),
    };
    this.sql.exec(
      `INSERT INTO challenges (id, from_id, to_id, mode, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      c.id,
      me,
      friendId,
      c.mode,
      c.createdAt,
      c.expiresAt,
    );
    this.scheduleNextAlarm();
    this.sendToAccount(friendId, { t: 'challengeIncoming', challenge: c });
    this.sendToAccount(me, { t: 'challengeSent', challenge: c });
  }

  private async challengeRespond(conn: HubConn, me: string, id: string, accept: boolean): Promise<void> {
    const row = this.sql.exec(`SELECT * FROM challenges WHERE id = ? AND to_id = ? AND status = 'pending'`, id, me)[0];
    if (!row || Number(row.expires_at) <= this.now()) return this.error(conn, 'expired', 'challenge');
    const from = String(row.from_id);
    if (!accept) return this.closeChallenge(id, 'declined', me);
    if (!this.byAccount.has(from)) return this.closeChallenge(id, 'gone', me);
    this.sql.exec(`UPDATE challenges SET status = 'accepted' WHERE id = ?`, id);
    const roomId = this.randomString(10, ID_CHARS);
    await this.hooks.setupRoom(roomId, { mode: 'duel', expected: [from, me], auto: true, hostId: from });
    for (const acc of [from, me]) {
      this.sendToAccount(acc, { t: 'challengeClosed', id, reason: 'accepted' });
      this.sendToAccount(acc, { t: 'roomReady', roomId, reason: 'challenge' });
    }
  }

  private closeChallenge(id: string, reason: 'declined' | 'cancelled' | 'gone', by: string): void {
    const row = this.sql.exec(`SELECT * FROM challenges WHERE id = ? AND status = 'pending'`, id)[0];
    if (!row) return;
    const from = String(row.from_id);
    const to = String(row.to_id);
    if (by !== from && by !== to) return;
    this.sql.exec(`UPDATE challenges SET status = ? WHERE id = ?`, reason, id);
    for (const acc of [from, to]) this.sendToAccount(acc, { t: 'challengeClosed', id, reason });
  }

  private pendingChallenges(me: string): ChallengeInfo[] {
    const rows = this.sql.exec(`SELECT * FROM challenges WHERE (to_id = ? OR from_id = ?) AND status = 'pending' AND expires_at > ?`, me, me, this.now());
    return rows.flatMap((r) => {
      const from = this.account(String(r.from_id));
      const to = this.account(String(r.to_id));
      if (!from || !to) return [];
      return [{ id: String(r.id), from, to, mode: 'duel' as const, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at) }];
    });
  }

  // ------------------------------------------------------------------ Party

  private async partyCreate(conn: HubConn, me: string): Promise<void> {
    const roomId = this.randomString(10, ID_CHARS);
    await this.hooks.setupRoom(roomId, { mode: 'classic', expected: [me], auto: false, hostId: me });
    this.send(conn, { t: 'roomReady', roomId, reason: 'party' });
  }

  private partyInvite(conn: HubConn, me: string, friendId: string, roomId: string): void {
    if (!this.areFriends(me, friendId)) return this.error(conn, 'not_friends');
    const now = this.now();
    const invite: PartyInviteInfo = { id: this.randomString(10, ID_CHARS), from: this.account(me)!, roomId, expiresAt: now + PARTY_INVITE_MS };
    this.sql.exec(
      `INSERT INTO party_invites (id, from_id, to_id, room_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      invite.id,
      me,
      friendId,
      roomId,
      now,
      invite.expiresAt,
    );
    this.scheduleNextAlarm();
    this.sendToAccount(friendId, { t: 'partyInvite', invite });
  }

  private partyRespond(conn: HubConn, me: string, id: string, accept: boolean): void {
    const row = this.sql.exec(`SELECT * FROM party_invites WHERE id = ? AND to_id = ? AND expires_at > ?`, id, me, this.now())[0];
    this.sql.exec(`DELETE FROM party_invites WHERE id = ?`, id);
    if (!row) return this.error(conn, 'expired', 'party');
    if (accept) this.send(conn, { t: 'roomReady', roomId: String(row.room_id), reason: 'party' });
  }

  private partyInvites(me: string): PartyInviteInfo[] {
    return this.sql
      .exec(`SELECT * FROM party_invites WHERE to_id = ? AND expires_at > ?`, me, this.now())
      .flatMap((r) => {
        const from = this.account(String(r.from_id));
        return from ? [{ id: String(r.id), from, roomId: String(r.room_id), expiresAt: Number(r.expires_at) }] : [];
      });
  }

  // ------------------------------------------------------------------ Statistik

  stats(me: string): StatsInfo {
    const a = this.sql.exec(`SELECT wins, losses, draws, trophies, party_games FROM accounts WHERE id = ?`, me)[0];
    const h2h = this.sql.exec(
      `SELECT o.account_id AS friend,
              SUM(CASE WHEN mine.result = 'win' THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN mine.result = 'loss' THEN 1 ELSE 0 END) AS losses,
              SUM(CASE WHEN mine.result = 'draw' THEN 1 ELSE 0 END) AS draws
       FROM match_players mine
       JOIN match_players o ON o.match_id = mine.match_id AND o.account_id != mine.account_id
       JOIN matches m ON m.id = mine.match_id
       WHERE mine.account_id = ? AND m.mode = 'duel'
       GROUP BY o.account_id`,
      me,
    );
    const ids = [me, ...this.friendIds(me)];
    const placeholders = ids.map(() => '?').join(',');
    const board = this.sql.exec(`SELECT id, name, tag, trophies, wins, losses FROM accounts WHERE id IN (${placeholders}) ORDER BY trophies DESC, wins DESC`, ...ids);
    return {
      wins: Number(a?.wins ?? 0),
      losses: Number(a?.losses ?? 0),
      draws: Number(a?.draws ?? 0),
      trophies: Number(a?.trophies ?? 0),
      partyGames: Number(a?.party_games ?? 0),
      headToHead: h2h.map((r) => ({ friendId: String(r.friend), wins: Number(r.wins), losses: Number(r.losses), draws: Number(r.draws) })),
      leaderboard: board.map((r) => ({ ...toAccount(r), trophies: Number(r.trophies), wins: Number(r.wins), losses: Number(r.losses) })),
    };
  }

  // ------------------------------------------------------------------ Hilfen

  private sendWelcome(conn: HubConn, id: string): void {
    const me = this.account(id);
    if (!me) return;
    this.send(conn, {
      t: 'welcome',
      me,
      friends: this.friendList(id),
      ...this.requests(id),
      challenges: this.pendingChallenges(id),
      parties: this.partyInvites(id),
      profile: this.profile(id),
      protocol: PROTOCOL_VERSION,
      server: this.hooks.buildId,
    });
  }

  private bindConn(conn: HubConn, accountId: string): void {
    if (conn.accountId === accountId) return;
    conn.accountId = accountId;
    const wasOnline = this.byAccount.has(accountId);
    this.indexConn(accountId, conn);
    if (!wasOnline) this.broadcastPresence(accountId);
  }

  private indexConn(accountId: string, conn: HubConn): void {
    let set = this.byAccount.get(accountId);
    if (!set) {
      set = new Set();
      this.byAccount.set(accountId, set);
    }
    set.add(conn);
  }

  account(id: string): AccountInfo | null {
    const r = this.sql.exec(`SELECT id, name, tag FROM accounts WHERE id = ?`, id)[0];
    return r ? toAccount(r) : null;
  }

  private sendToAccount(id: string, msg: HubServerMessage): void {
    const set = this.byAccount.get(id);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const c of set) safeSend(c, data);
  }

  private send(conn: HubConn, msg: HubServerMessage): void {
    safeSend(conn, JSON.stringify(msg));
  }

  private error(conn: HubConn, code: HubErrorCode, ctx?: string): void {
    this.send(conn, ctx ? { t: 'error', code, ctx } : { t: 'error', code });
  }

  private async ipHash(ip: string): Promise<string> {
    // IPv6: nur das /64-Netz (Datenschutz-Adressen wechseln)
    const norm = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
    return (await this.hooks.sha256(`${this.ipSalt}:${norm}`)).slice(0, 32);
  }

  private countIp(ipHash: string, kind: string, limit: number): boolean {
    const day = Math.floor(this.now() / DAY);
    const row = this.sql.exec(`SELECT count FROM ip_limits WHERE ip_hash = ? AND day = ? AND kind = ?`, ipHash, day, kind)[0];
    const count = Number(row?.count ?? 0);
    if (count >= limit) return false;
    this.sql.exec(
      `INSERT INTO ip_limits (ip_hash, day, kind, count) VALUES (?, ?, ?, 1) ON CONFLICT (ip_hash, day, kind) DO UPDATE SET count = count + 1`,
      ipHash,
      day,
      kind,
    );
    return true;
  }

  private scheduleNextAlarm(): void {
    const now = this.now();
    const next = this.sql.exec(
      `SELECT MIN(t) AS t FROM (
         SELECT MIN(expires_at) AS t FROM challenges WHERE status = 'pending'
         UNION ALL SELECT MIN(expires_at) FROM pairings
         UNION ALL SELECT MIN(expires_at) FROM transfer_codes
         UNION ALL SELECT MIN(expires_at) FROM party_invites)`,
    )[0];
    const t = next?.t;
    if (t !== null && t !== undefined) this.hooks.scheduleAlarm(Math.max(now + 1000, Number(t)));
  }

  private randomString(len: number, chars: string): string {
    const bytes = this.hooks.randomBytes(len);
    let out = '';
    for (const b of bytes) out += chars[b % chars.length];
    return out;
  }

  private now(): number {
    return this.hooks.now();
  }
}

function toAccount(r: Record<string, SqlValue>): AccountInfo {
  return { id: String(r.id), name: String(r.name), tag: Number(r.tag) };
}

function safeSend(conn: HubConn, data: string): void {
  try {
    conn.send(data);
  } catch {
    // Verbindung schon weg
  }
}
