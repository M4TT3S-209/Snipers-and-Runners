import { createHash, getRandomValues } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CONFIG, type HubServerMessage } from '@scope-rush/shared';
import { HubCore, type HubConn, type RoomSetup, type Sql, type SqlValue } from '../src/hub/HubCore';

// node:sqlite ist (noch) experimentell → per require laden, Warnung ignorieren
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => { prepare(q: string): { all(...p: SqlValue[]): unknown[]; run(...p: SqlValue[]): unknown } };
};

function memorySql(): Sql {
  const db = new DatabaseSync(':memory:');
  return {
    exec(query: string, ...params: SqlValue[]) {
      const stmt = db.prepare(query);
      if (/^\s*(SELECT|WITH)/i.test(query)) return stmt.all(...params) as Array<Record<string, SqlValue>>;
      stmt.run(...params);
      return [];
    },
  };
}

class Client implements HubConn {
  accountId: string | null = null;
  inbox: HubServerMessage[] = [];
  closed = false;
  token = '';
  constructor(
    readonly hub: HubCore,
    readonly ip: string,
  ) {
    hub.attach(this);
  }
  send(d: string): void {
    const m = JSON.parse(d) as HubServerMessage;
    if (m.t === 'account') this.token = m.token;
    this.inbox.push(m);
  }
  close(): void {
    this.closed = true;
  }
  async msg(m: object): Promise<void> {
    await this.hub.handle(this, JSON.stringify(m));
  }
  last<T extends HubServerMessage['t']>(t: T): Extract<HubServerMessage, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i]!.t === t) return this.inbox[i] as Extract<HubServerMessage, { t: T }>;
    return undefined;
  }
}

function setup() {
  let now = 1_800_000_000_000;
  const rooms: Array<{ roomId: string; setup: RoomSetup }> = [];
  const pushes: Array<{ endpoint: string; payload: { title: string } }> = [];
  const alarms: number[] = [];
  const hub = new HubCore(memorySql(), {
    buildId: 'test',
    now: () => now,
    randomBytes: (n) => getRandomValues(new Uint8Array(n)),
    sha256: async (t) => createHash('sha256').update(t).digest('hex'),
    setupRoom: async (roomId, setup) => {
      rooms.push({ roomId, setup });
    },
    scheduleAlarm: (at) => alarms.push(at),
    generateVapid: async () => ({ publicKey: 'TESTKEY', privateJwk: {} }),
    sendPush: async (sub, payload) => {
      pushes.push({ endpoint: sub.endpoint, payload: payload as { title: string } });
      return sub.endpoint.endsWith('/gone') ? 'gone' : 'ok';
    },
  });
  hub.init();
  const account = async (name: string, ip = '1.2.3.4') => {
    const c = new Client(hub, ip);
    await c.msg({ t: 'createAccount', name });
    return c;
  };
  return { hub, rooms, alarms, pushes, account, advance: (ms: number) => (now += ms), now: () => now };
}

async function befriend(_s: ReturnType<typeof setup>, a: Client, b: Client) {
  await a.msg({ t: 'inviteCreate' });
  await b.msg({ t: 'inviteRedeem', token: a.last('invite')!.token });
}

describe('Hub: Konten', () => {
  it('Konto anlegen → Name#Tag + Token, danach Anmeldung per Token', async () => {
    const s = setup();
    const a = await s.account('Max');
    const acc = a.last('account')!;
    expect(acc.me.name).toBe('Max');
    expect(acc.me.tag).toBeGreaterThanOrEqual(1000);
    expect(acc.me.tag).toBeLessThanOrEqual(9999);
    expect(a.last('welcome')!.me.id).toBe(acc.me.id);

    const again = new Client(s.hub, '9.9.9.9');
    await again.msg({ t: 'hello', v: 1, token: acc.token });
    expect(again.last('welcome')!.me.id).toBe(acc.me.id);

    const bad = new Client(s.hub, '9.9.9.9');
    await bad.msg({ t: 'hello', v: 1, token: 'x'.repeat(43) });
    expect(bad.last('error')!.code).toBe('bad_token');
    expect(bad.last('needAccount')).toBeDefined();
  });

  it('gleicher Name bekommt einen anderen Tag', async () => {
    const s = setup();
    const a = await s.account('Lena', '1.1.1.1');
    const b = await s.account('Lena', '2.2.2.2');
    expect(a.last('account')!.me.tag).not.toBe(b.last('account')!.me.tag);
  });

  it('böse Namen werden abgelehnt, max. 5 Konten pro IP und Tag', async () => {
    const s = setup();
    const c = new Client(s.hub, '5.5.5.5');
    await c.msg({ t: 'createAccount', name: 'Arschloch' });
    expect(c.last('error')!.code).toBe('bad_name');
    for (let i = 0; i < 5; i++) await s.account(`Spieler${i}`, '7.7.7.7');
    const sixth = await s.account('Zuviel', '7.7.7.7');
    expect(sixth.last('error')!.code).toBe('too_many');
  });

  it('Übertragungscode: Konto auf zweitem Gerät, beide bleiben angemeldet', async () => {
    const s = setup();
    const a = await s.account('Max');
    await a.msg({ t: 'transferCreate' });
    const code = a.last('transferCode')!.code;
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const phone2 = new Client(s.hub, '8.8.8.8');
    await phone2.msg({ t: 'transferRedeem', code: code.toLowerCase() });
    expect(phone2.last('account')!.me.id).toBe(a.accountId);
    expect(phone2.token).not.toBe(a.token);
    // Code nur einmal gültig
    const phone3 = new Client(s.hub, '8.8.8.8');
    await phone3.msg({ t: 'transferRedeem', code });
    expect(phone3.last('error')!.code).toBe('not_found');
    // altes Token funktioniert weiter
    const back = new Client(s.hub, '1.2.3.4');
    await back.msg({ t: 'hello', v: 1, token: a.token });
    expect(back.last('welcome')).toBeDefined();
  });

  it('Kopplung Safari → Home-Bildschirm-App über dieselbe IP (mit Bestätigung)', async () => {
    const s = setup();
    const safari = await s.account('Lena', '80.1.2.3');
    await safari.msg({ t: 'pairingOffer', kind: 'account' });
    const app = new Client(s.hub, '80.1.2.3');
    await app.msg({ t: 'pairingCheck' });
    const offer = app.last('pairing')!.offers[0]!;
    expect(offer.kind).toBe('account');
    expect(offer.account!.name).toBe('Lena');
    await app.msg({ t: 'pairingAccept', id: offer.id });
    expect(app.last('account')!.me.id).toBe(safari.accountId);
    // Andere IP sieht nichts
    const stranger = new Client(s.hub, '99.9.9.9');
    await stranger.msg({ t: 'pairingCheck' });
    expect(stranger.last('pairing')!.offers).toHaveLength(0);
  });

  it('IPv6: gleiche /64 gilt als gleiches Netz', async () => {
    const s = setup();
    const safari = await s.account('Ben', '2a02:810d:1:2:aaaa:1:2:3');
    await safari.msg({ t: 'pairingOffer', kind: 'account' });
    const app = new Client(s.hub, '2a02:810d:1:2:ffff:9:8:7');
    await app.msg({ t: 'pairingCheck' });
    expect(app.last('pairing')!.offers).toHaveLength(1);
  });
});

describe('Hub: Freunde', () => {
  it('Einladungslink → sofort befreundet (beide bekommen Bescheid)', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    expect(max.last('friendAdded')!.friend.name).toBe('Lena');
    expect(lena.last('friendAdded')!.friend.name).toBe('Max');
    expect(max.last('friends')!.friends.map((f) => f.name)).toEqual(['Lena']);
  });

  it('neues Konto direkt über Einladungslink', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    await max.msg({ t: 'inviteCreate' });
    const token = max.last('invite')!.token;
    const info = new Client(s.hub, '3.3.3.3');
    await info.msg({ t: 'inviteInfo', token });
    expect(info.last('inviteInfo')!.from!.name).toBe('Max');
    await info.msg({ t: 'createAccount', name: 'Neu', invite: token });
    expect(info.last('welcome')!.friends.map((f) => f.name)).toEqual(['Max']);
  });

  it('Name#Tag-Suche → Anfrage → annehmen', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    const tag = lena.last('account')!.me.tag;
    await max.msg({ t: 'friendSearch', name: 'lena', tag });
    expect(lena.last('friendRequest')!.from.name).toBe('Max');
    expect(lena.last('friends')!.incoming.map((x) => x.name)).toEqual(['Max']);
    await lena.msg({ t: 'friendRespond', id: max.accountId, accept: true });
    expect(max.last('friendAdded')!.friend.name).toBe('Lena');
  });

  it('gegenseitige Anfrage = sofort befreundet; unbekannter Tag → nicht gefunden', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await max.msg({ t: 'friendSearch', name: 'Lena', tag: lena.last('account')!.me.tag });
    await lena.msg({ t: 'friendSearch', name: 'Max', tag: max.last('account')!.me.tag });
    expect(lena.last('friendAdded')).toBeDefined();
    await max.msg({ t: 'friendSearch', name: 'Niemand', tag: 1234 });
    expect(max.last('error')!.code).toBe('not_found');
  });

  it('Online-Status: online / im Match / offline', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    expect(max.last('friends')!.friends[0]!.status).toBe('online');
    s.hub.setInMatch([lena.accountId!], true);
    expect(max.last('presence')!.status).toBe('match');
    s.hub.setInMatch([lena.accountId!], false);
    s.hub.detach(lena);
    expect(max.last('presence')!.status).toBe('offline');
  });

  it('Kopplung für Einladung: Link in Safari geöffnet, App nimmt an', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    await max.msg({ t: 'inviteInfo', token: 'x'.repeat(24) });
    await max.msg({ t: 'inviteCreate' });
    const token = max.last('invite')!.token;
    const lenaApp = await s.account('Lena', '44.4.4.4');
    const safari = new Client(s.hub, '44.4.4.4');
    await safari.msg({ t: 'pairingOffer', kind: 'invite', invite: token });
    await lenaApp.msg({ t: 'pairingCheck' });
    const offer = lenaApp.last('pairing')!.offers[0]!;
    expect(offer.from!.name).toBe('Max');
    await lenaApp.msg({ t: 'pairingAccept', id: offer.id });
    expect(lenaApp.last('friendAdded')!.friend.name).toBe('Max');
  });
});

describe('Hub: Herausforderungen', () => {
  it('online: Pop-up, Annehmen → Raum mit beiden, Autostart', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    const incoming = lena.last('challengeIncoming')!.challenge;
    expect(incoming.from.name).toBe('Max');
    expect(incoming.expiresAt - s.now()).toBe(CONFIG.social.challengeTimeoutS * 1000);
    await lena.msg({ t: 'challengeRespond', id: incoming.id, accept: true });
    expect(s.rooms).toHaveLength(1);
    expect(s.rooms[0]!.setup).toMatchObject({ mode: 'duel', auto: true, expected: [max.accountId, lena.accountId] });
    expect(max.last('roomReady')!.roomId).toBe(s.rooms[0]!.roomId);
    expect(lena.last('roomReady')!.roomId).toBe(s.rooms[0]!.roomId);
  });

  it('nicht angenommen → verfällt nach 30 s', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    s.advance(31_000);
    s.hub.alarm();
    expect(max.last('challengeClosed')!.reason).toBe('expired');
    const id = lena.last('challengeIncoming')!.challenge.id;
    await lena.msg({ t: 'challengeRespond', id, accept: true });
    expect(lena.last('error')!.code).toBe('expired');
  });

  it('offline: wartet im Posteingang und kommt beim nächsten Start an', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    const lenaToken = lena.token;
    s.hub.detach(lena);
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    s.advance(2 * 60_000);
    const back = new Client(s.hub, '2.2.2.2');
    await back.msg({ t: 'hello', v: 1, token: lenaToken });
    expect(back.last('welcome')!.challenges.map((c) => c.from.name)).toEqual(['Max']);
  });

  it('Ablehnen und Nicht-Freunde', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    expect(max.last('error')!.code).toBe('not_friends');
    await befriend(s, max, lena);
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    await lena.msg({ t: 'challengeRespond', id: lena.last('challengeIncoming')!.challenge.id, accept: false });
    expect(max.last('challengeClosed')!.reason).toBe('declined');
  });

  it('Party: erstellen, Freund einladen, Freund tritt bei', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    await max.msg({ t: 'partyCreate' });
    const roomId = max.last('roomReady')!.roomId;
    expect(s.rooms[0]!.setup.mode).toBe('classic');
    await max.msg({ t: 'partyInvite', friendId: lena.accountId, roomId });
    const inv = lena.last('partyInvite')!.invite;
    await lena.msg({ t: 'partyRespond', id: inv.id, accept: true });
    expect(lena.last('roomReady')!.roomId).toBe(roomId);
  });
});

describe('Hub: Statistik', () => {
  it('Siege, Niederlagen, Trophäen, Bilanz gegen Freunde, Rangliste', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    const players = [
      { id: max.accountId!, name: 'Max', key: '', accountId: max.accountId! },
      { id: lena.accountId!, name: 'Lena', key: '', accountId: lena.accountId! },
    ];
    s.hub.reportMatch({ mode: 'duel', players, winnerId: max.accountId!, draw: false, roundWins: {}, scores: {} });
    s.hub.reportMatch({ mode: 'duel', players, winnerId: max.accountId!, draw: false, roundWins: {}, scores: {} });
    s.hub.reportMatch({ mode: 'duel', players, winnerId: lena.accountId!, draw: false, roundWins: {}, scores: {} });
    await max.msg({ t: 'stats' });
    const st = max.last('stats')!.stats;
    expect(st.wins).toBe(2);
    expect(st.losses).toBe(1);
    expect(st.trophies).toBe(2 * CONFIG.trophies.win + CONFIG.trophies.loss);
    expect(st.headToHead).toEqual([{ friendId: lena.accountId, wins: 2, losses: 1, draws: 0 }]);
    expect(st.leaderboard.map((x) => x.name)).toEqual(['Max', 'Lena']);
  });
});

describe('Hub: Aussehen & Trophäen', () => {
  it('nur freigeschaltetes Aussehen wird gespeichert; Anmeldung für Räume liefert Trophäen', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    // 0 Trophäen: Farbe 5 und Jubel „spin“ sind gesperrt → Standard
    await max.msg({ t: 'cosmetics', skin: 5, emote: 'spin' });
    expect(max.last('profile')!.profile.cosmetics).toEqual({ skin: 0, emote: 'cheer' });
    await max.msg({ t: 'cosmetics', skin: 1, emote: 'cheer' });
    expect(max.last('profile')!.profile.cosmetics.skin).toBe(1);
    const players = [
      { id: max.accountId!, name: 'Max', key: '', accountId: max.accountId! },
      { id: lena.accountId!, name: 'Lena', key: '', accountId: lena.accountId! },
    ];
    for (let i = 0; i < 2; i++) s.hub.reportMatch({ mode: 'duel', players, winnerId: max.accountId!, draw: false, roundWins: {}, scores: {} });
    expect(max.last('profile')!.profile.trophies).toBe(2 * CONFIG.trophies.win);
    const auth = await s.hub.authenticate(max.token);
    expect(auth).toMatchObject({ name: 'Max', trophies: 2 * CONFIG.trophies.win, cosmetics: { skin: 1 } });
  });
});

describe('Hub: Push', () => {
  it('Herausforderung an einen nicht verbundenen Freund → Mitteilung; abgelaufene Abos werden gelöscht', async () => {
    const s = setup();
    const max = await s.account('Max', '1.1.1.1');
    const lena = await s.account('Lena', '2.2.2.2');
    await befriend(s, max, lena);
    await lena.msg({ t: 'pushKey' });
    expect(lena.last('pushKey')!.key).toBe('TESTKEY');
    const p256dh = 'B' + 'x'.repeat(86);
    await lena.msg({ t: 'pushSubscribe', endpoint: 'https://web.push.apple.com/abc', p256dh, auth: 'y'.repeat(22) });
    await lena.msg({ t: 'pushSubscribe', endpoint: 'https://web.push.apple.com/gone', p256dh, auth: 'y'.repeat(22) });
    expect(lena.last('pushStatus')!.subscribed).toBe(true);
    // Online → kein Push
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    expect(s.pushes).toHaveLength(0);
    // Offline → Push an beide Geräte
    s.hub.detach(lena);
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    expect(s.pushes.map((p) => p.endpoint).sort()).toEqual(['https://web.push.apple.com/abc', 'https://web.push.apple.com/gone']);
    expect(s.pushes[0]!.payload.title).toContain('Max');
    // „gone“ wurde gelöscht → beim nächsten Mal nur noch eins
    s.pushes.length = 0;
    await max.msg({ t: 'challenge', friendId: lena.accountId });
    expect(s.pushes.map((p) => p.endpoint)).toEqual(['https://web.push.apple.com/abc']);
  });
});
