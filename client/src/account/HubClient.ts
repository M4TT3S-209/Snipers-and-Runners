import {
  PROTOCOL_VERSION,
  type AccountInfo,
  type ChallengeInfo,
  type FriendInfo,
  type HubClientMessage,
  type HubErrorCode,
  type HubServerMessage,
  type PairingOffer,
  type PartyInviteInfo,
  type StatsInfo,
} from '@scope-rush/shared';
import { ReconnectingSocket, type SocketStatus } from '../net/socket';
import { toWebSocketUrl } from '../net/serverUrl';
import { markUpdateAvailable } from '../platform/updateCheck';
import { loadToken, refreshCookie, saveToken } from './tokenStore';

/**
 * Verbindung zum Hub: Konto, Freunde, Status, Herausforderungen, Partys.
 * Hält den Zustand und benachrichtigt die Oberfläche bei Änderungen.
 */
export interface HubState {
  status: SocketStatus | 'none';
  /** unbekannt = noch keine Antwort; none = kein Konto auf diesem Gerät */
  account: 'unknown' | 'none' | AccountInfo;
  friends: FriendInfo[];
  incoming: AccountInfo[];
  outgoing: AccountInfo[];
  challengesIn: ChallengeInfo[];
  challengesOut: ChallengeInfo[];
  parties: PartyInviteInfo[];
  pairing: PairingOffer[];
  /** Wurde nach Kopplungen gefragt (Antwort da)? */
  pairingChecked: boolean;
  invite: { token: string; expiresAt: number } | null;
  inviteInfo: { token: string; from: AccountInfo | null } | null;
  transfer: { code: string; expiresAt: number } | null;
  stats: StatsInfo | null;
  lastError: { code: HubErrorCode; ctx?: string; at: number } | null;
  toast: { text: string; at: number } | null;
}

export type HubEvent =
  | { t: 'state' }
  | { t: 'roomReady'; roomId: string; reason: 'challenge' | 'party' }
  | { t: 'challengeClosed'; id: string; reason: string; byName?: string };

export class HubClient {
  state: HubState = {
    status: 'none',
    account: 'unknown',
    friends: [],
    incoming: [],
    outgoing: [],
    challengesIn: [],
    challengesOut: [],
    parties: [],
    pairing: [],
    pairingChecked: false,
    invite: null,
    inviteInfo: null,
    transfer: null,
    stats: null,
    lastError: null,
    toast: null,
  };
  private readonly socket: ReconnectingSocket<HubServerMessage, HubClientMessage>;
  private readonly listeners = new Set<(e: HubEvent) => void>();

  constructor(serverUrl: string) {
    this.socket = new ReconnectingSocket<HubServerMessage, HubClientMessage>({
      url: () => toWebSocketUrl(serverUrl, `/hub?v=${PROTOCOL_VERSION}`),
      queueWhileClosed: true,
      onStatus: (s) => this.set({ status: s }),
      onUpdateRequired: markUpdateAvailable,
      onOpen: () => {
        const token = loadToken();
        this.send(token ? { t: 'hello', v: PROTOCOL_VERSION, token } : { t: 'hello', v: PROTOCOL_VERSION });
      },
      onMessage: (m) => this.onMessage(m),
    });
    this.socket.start();
    refreshCookie();
  }

  get token(): string | null {
    return loadToken();
  }

  get me(): AccountInfo | null {
    return typeof this.state.account === 'object' ? this.state.account : null;
  }

  on(cb: (e: HubEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ------------------------------------------------------------------ Aktionen

  createAccount(name: string, invite?: string): void {
    this.send(invite ? { t: 'createAccount', name, invite } : { t: 'createAccount', name });
  }
  rename(name: string): void {
    this.send({ t: 'rename', name });
  }
  checkPairing(): void {
    this.send({ t: 'pairingCheck' });
  }
  offerPairing(kind: 'account' | 'invite', invite?: string): void {
    this.send(invite ? { t: 'pairingOffer', kind, invite } : { t: 'pairingOffer', kind });
  }
  acceptPairing(id: string): void {
    this.send({ t: 'pairingAccept', id });
    this.set({ pairing: this.state.pairing.filter((p) => p.id !== id) });
  }
  dismissPairing(): void {
    this.set({ pairing: [] });
  }
  createInvite(): void {
    this.send({ t: 'inviteCreate' });
  }
  lookupInvite(token: string): void {
    this.send({ t: 'inviteInfo', token });
  }
  redeemInvite(token: string): void {
    this.send({ t: 'inviteRedeem', token });
  }
  createTransfer(): void {
    this.send({ t: 'transferCreate' });
  }
  redeemTransfer(code: string): void {
    this.send({ t: 'transferRedeem', code });
  }
  searchFriend(name: string, tag: number): void {
    this.send({ t: 'friendSearch', name, tag });
  }
  respondFriend(id: string, accept: boolean): void {
    this.send({ t: 'friendRespond', id, accept });
  }
  removeFriend(id: string): void {
    this.send({ t: 'friendRemove', id });
  }
  challenge(friendId: string): void {
    this.send({ t: 'challenge', friendId });
  }
  respondChallenge(id: string, accept: boolean): void {
    this.send({ t: 'challengeRespond', id, accept });
    this.set({ challengesIn: this.state.challengesIn.filter((c) => c.id !== id) });
  }
  cancelChallenge(id: string): void {
    this.send({ t: 'challengeCancel', id });
  }
  createParty(): void {
    this.send({ t: 'partyCreate' });
  }
  inviteToParty(friendId: string, roomId: string): void {
    this.send({ t: 'partyInvite', friendId, roomId });
  }
  respondParty(id: string, accept: boolean): void {
    this.send({ t: 'partyRespond', id, accept });
    this.set({ parties: this.state.parties.filter((p) => p.id !== id) });
  }
  loadStats(): void {
    this.send({ t: 'stats' });
  }
  clearToast(): void {
    this.set({ toast: null });
  }

  // ------------------------------------------------------------------

  private onMessage(m: HubServerMessage): void {
    switch (m.t) {
      case 'needAccount':
        this.set({ account: 'none' });
        break;
      case 'account':
        saveToken(m.token);
        this.set({ account: m.me });
        break;
      case 'welcome':
        this.set({
          account: m.me,
          friends: m.friends,
          incoming: m.incoming,
          outgoing: m.outgoing,
          challengesIn: m.challenges.filter((c) => c.to.id === m.me.id),
          challengesOut: m.challenges.filter((c) => c.from.id === m.me.id),
          parties: m.parties,
        });
        break;
      case 'friends':
        this.set({ friends: m.friends, incoming: m.incoming, outgoing: m.outgoing });
        break;
      case 'presence':
        this.set({ friends: this.state.friends.map((f) => (f.id === m.id ? { ...f, status: m.status, lastSeen: m.lastSeen } : f)) });
        break;
      case 'friendAdded':
        this.set({ toast: { text: `🤝 ${m.friend.name}`, at: Date.now() } });
        break;
      case 'friendRequest':
        this.set({ toast: { text: `👋 ${m.from.name}`, at: Date.now() } });
        break;
      case 'challengeIncoming':
        this.set({ challengesIn: [...this.state.challengesIn.filter((c) => c.id !== m.challenge.id), m.challenge] });
        break;
      case 'challengeSent':
        this.set({ challengesOut: [...this.state.challengesOut.filter((c) => c.to.id !== m.challenge.to.id), m.challenge] });
        break;
      case 'challengeClosed': {
        const out = this.state.challengesOut.find((c) => c.id === m.id);
        this.set({
          challengesIn: this.state.challengesIn.filter((c) => c.id !== m.id),
          challengesOut: this.state.challengesOut.filter((c) => c.id !== m.id),
        });
        this.emit({ t: 'challengeClosed', id: m.id, reason: m.reason, ...(out ? { byName: out.to.name } : {}) });
        break;
      }
      case 'roomReady':
        this.emit({ t: 'roomReady', roomId: m.roomId, reason: m.reason });
        break;
      case 'partyInvite':
        this.set({ parties: [...this.state.parties, m.invite] });
        break;
      case 'invite':
        this.set({ invite: { token: m.token, expiresAt: m.expiresAt } });
        break;
      case 'inviteInfo':
        this.set({ inviteInfo: { token: m.token, from: m.from } });
        break;
      case 'transferCode':
        this.set({ transfer: { code: m.code, expiresAt: m.expiresAt } });
        break;
      case 'pairing':
        this.set({ pairing: m.offers, pairingChecked: true });
        break;
      case 'stats':
        this.set({ stats: m.stats });
        break;
      case 'error':
        this.set({ lastError: { code: m.code, ...(m.ctx ? { ctx: m.ctx } : {}), at: Date.now() } });
        if (m.code === 'bad_token') this.set({ account: 'none' });
        break;
      default:
        break;
    }
  }

  private set(patch: Partial<HubState>): void {
    this.state = { ...this.state, ...patch };
    this.emit({ t: 'state' });
  }

  private emit(e: HubEvent): void {
    for (const l of this.listeners) l(e);
  }

  private send(msg: HubClientMessage): void {
    this.socket.send(msg);
  }
}
