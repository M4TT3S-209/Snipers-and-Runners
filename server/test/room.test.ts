import { describe, expect, it } from 'vitest';
import { CONFIG, generateTrack, hitboxAt, normalize, sniperEye, type RoomServerMessage, type StateMessage } from '@scope-rush/shared';
import { RoomCore, type Conn, type MatchSummary } from '../src/room/RoomCore';

/** Test-Client: sammelt alle Nachrichten vom Raum. */
class FakeClient implements Conn {
  memberId: string | null = null;
  lastSeen = 0;
  inbox: RoomServerMessage[] = [];
  closed = false;
  constructor(
    readonly core: RoomCore,
    readonly name: string,
    readonly key: string,
  ) {
    core.attach(this);
  }
  send(data: string): void {
    this.inbox.push(JSON.parse(data) as RoomServerMessage);
  }
  close(): void {
    this.closed = true;
  }
  msg(m: object): void {
    this.core.handle(this, JSON.stringify(m));
  }
  last<T extends RoomServerMessage['t']>(t: T): Extract<RoomServerMessage, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i]!.t === t) return this.inbox[i] as Extract<RoomServerMessage, { t: T }>;
    return undefined;
  }
  all<T extends RoomServerMessage['t']>(t: T): Array<Extract<RoomServerMessage, { t: T }>> {
    return this.inbox.filter((m) => m.t === t) as Array<Extract<RoomServerMessage, { t: T }>>;
  }
}

function setup() {
  let now = 1_000_000;
  const ended: MatchSummary[] = [];
  const core = new RoomCore('testraum01', () => now, { buildId: 'test', onMatchEnd: (s) => ended.push(s) });
  const a = new FakeClient(core, 'Anna', 'keyAnna123456');
  const b = new FakeClient(core, 'Ben', 'keyBen12345678');
  a.msg({ t: 'join', name: 'Anna', key: a.key });
  b.msg({ t: 'join', name: 'Ben', key: b.key });
  /** Zeit vorspulen; Clients halten die Verbindung mit sync am Leben */
  const advance = (ms: number, clients: FakeClient[] = [a, b]) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      if (t % 1000 === 0) for (const c of clients) if (!c.closed) c.msg({ t: 'sync', c: now });
      if (core.needsLoop) core.tick();
    }
  };
  return { core, a, b, advance, ended, setNow: (v: number) => (now = v), getNow: () => now };
}

function startMatch(s: ReturnType<typeof setup>) {
  s.a.msg({ t: 'ready', ready: true });
  s.b.msg({ t: 'ready', ready: true });
}

describe('Raum: Lobby', () => {
  it('zwei Spieler treten bei, der erste ist Gastgeber', () => {
    const { core, a, b } = setup();
    const room = b.last('room')!.room;
    expect(room.members.map((m) => m.name)).toEqual(['Anna', 'Ben']);
    expect(room.members.every((m) => m.seat === 'player')).toBe(true);
    expect(room.hostId).toBe(a.memberId);
    expect(core.flow).toBeNull();
  });

  it('dritter Beitretender wird Zuschauer', () => {
    const { core } = setup();
    const c = new FakeClient(core, 'Cem', 'keyCem12345678');
    c.msg({ t: 'join', name: 'Cem', key: c.key });
    expect(c.last('room')!.room.members.find((m) => m.name === 'Cem')!.seat).toBe('spectator');
  });

  it('ungültige Namen und Nachrichten werden abgelehnt', () => {
    const { core } = setup();
    const c = new FakeClient(core, 'x', 'keyX1234567890');
    c.msg({ t: 'join', name: 'F1ck', key: c.key });
    expect(c.last('error')!.code).toBe('bad_name');
    core.handle(c, '{"t":"fire","d":[0,0,-1]}');
    expect(c.last('error')!.code).toBe('bad_message');
    core.handle(c, 'kein json');
    expect(c.last('error')!.code).toBe('bad_message');
  });

  it('Match startet erst, wenn beide bereit sind', () => {
    const s = setup();
    s.a.msg({ t: 'ready', ready: true });
    expect(s.core.flow).toBeNull();
    s.b.msg({ t: 'ready', ready: true });
    expect(s.core.flow).not.toBeNull();
    expect(s.a.last('match')!.m.phase).toBe('loadout');
    expect(s.b.last('room')!.room.stage).toBe('match');
  });
});

describe('Raum: Match', () => {
  it('Phasen laufen, Zustände kommen mit 20 Hz, Läufer bekommt seinen Bewegungszustand', () => {
    const s = setup();
    startMatch(s);
    const plan = s.a.last('match')!.m.plan;
    const runner = plan.runnerIds[0] === s.a.memberId ? s.a : s.b;
    const sniper = runner === s.a ? s.b : s.a;
    runner.msg({ t: 'loadout', ready: true });
    sniper.msg({ t: 'loadout', weapon: 'precision', ready: true });
    s.advance(4500);
    expect(s.core.flow!.phase).toBe('running');
    runner.inbox = [];
    sniper.inbox = [];
    s.advance(1000);
    const states = runner.all('s') as StateMessage[];
    expect(states.length).toBeGreaterThanOrEqual(18);
    expect(states.at(-1)!.me).toBeDefined();
    expect((sniper.all('s') as StateMessage[]).at(-1)!.me).toBeUndefined();
    expect(states.at(-1)!.k).toBeGreaterThan(states[0]!.k);
  });

  it('Eingaben des Läufers mit Tick-Stempel werden angewendet', () => {
    const s = setup();
    startMatch(s);
    s.advance(14000);
    const turn = s.core.flow!.turn!;
    const runnerId = turn.runners[0]!.id;
    const runner = runnerId === s.a.memberId ? s.a : s.b;
    runner.msg({ t: 'in', k: turn.tick + 3, a: 'left' });
    s.advance(500);
    expect(turn.runner(runnerId)!.move.lane).toBe(0);
  });

  it('Schuss des Snipers trifft den (duckenden) Läufer', () => {
    const s = setup();
    startMatch(s);
    s.advance(13000);
    const turn = s.core.flow!.turn!;
    expect(s.core.flow!.phase).toBe('running');
    const runnerId = turn.runners[0]!.id;
    const sniperId = turn.snipers[0]!.id;
    const runner = runnerId === s.a.memberId ? s.a : s.b;
    const sniper = runner === s.a ? s.b : s.a;
    runner.msg({ t: 'in', k: turn.tick, a: 'duckOn' });
    s.advance(200);
    const m = turn.runner(runnerId)!.move;
    const head = hitboxAt(m.x, m.y, m.z, 'duck').head;
    const eye = sniperEye(turn.track);
    const d = normalize({ x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z });
    sniper.msg({ t: 'fire', d: [d.x, d.y, d.z], v: turn.tick });
    s.advance(2000);
    const events = sniper.all('ev').flatMap((e) => e.e);
    expect(events.some((e) => e.t === 'shot' && e.sniperId === sniperId)).toBe(true);
    expect(events.some((e) => e.t === 'hit' && e.runnerId === runnerId)).toBe(true);
  });

  it('Verbindungsabbruch → Pause mit Schonfrist, Rückkehr → weiter nach Countdown', () => {
    const s = setup();
    startMatch(s);
    s.advance(13000);
    const flow = s.core.flow!;
    expect(flow.phase).toBe('running');
    const tickBefore = flow.matchTick;
    s.core.detach(s.b);
    expect(s.a.last('pause')!.by).toBe(s.b.memberId);
    s.advance(5000, [s.a]);
    expect(flow.matchTick).toBe(tickBefore);
    // Ben kommt mit gleichem Schlüssel zurück
    const b2 = new FakeClient(s.core, 'Ben', s.b.key);
    b2.msg({ t: 'join', name: 'Ben', key: s.b.key });
    expect(b2.memberId).toBe(s.b.memberId);
    expect(s.a.last('resume')).toBeDefined();
    expect(b2.last('match')!.m.turn).not.toBeNull();
    s.advance(2000, [s.a, b2]);
    expect(flow.matchTick).toBe(tickBefore);
    s.advance(2000, [s.a, b2]);
    expect(flow.matchTick).toBeGreaterThan(tickBefore);
  });

  it('stumme Verbindung (keine Nachrichten) wird nach kurzer Zeit als weg erkannt', () => {
    const s = setup();
    startMatch(s);
    s.advance(12000);
    s.advance(6000, [s.a]); // Ben schweigt (iOS hat die App eingefroren)
    expect(s.b.closed).toBe(true);
    expect(s.a.last('pause')).toBeDefined();
  });

  it('nach der Schonfrist kann der Wartende kampflos gewinnen', () => {
    const s = setup();
    startMatch(s);
    s.advance(12000);
    s.core.detach(s.b);
    s.a.msg({ t: 'claim' });
    expect(s.core.flow!.phase).not.toBe('matchResult');
    s.advance((CONFIG.net.graceS + 1) * 1000, [s.a]);
    s.a.msg({ t: 'claim' });
    expect(s.core.flow!.phase).toBe('matchResult');
    expect(s.core.flow!.winnerId).toBe(s.a.memberId);
    expect(s.ended).toHaveLength(1);
  });

  it('Verlassen im Match = Aufgabe', () => {
    const s = setup();
    startMatch(s);
    s.advance(12000);
    s.b.msg({ t: 'leave' });
    expect(s.core.flow!.phase).toBe('matchResult');
    expect(s.core.flow!.winnerId).toBe(s.a.memberId);
  });

  it('komplettes Match läuft durch, danach Revanche mit getauschter Reihenfolge', () => {
    const s = setup();
    startMatch(s);
    const firstRunner = s.core.flow!.plan.runnerIds[0];
    // Niemand tut etwas → jeder Zug endet spätestens nach der Maximalzeit
    for (let i = 0; i < 1500 && s.core.flow!.phase !== "matchResult"; i++) s.advance(1000);
    expect(s.core.flow!.phase).toBe('matchResult');
    expect(s.ended).toHaveLength(1);
    s.a.msg({ t: 'rematch' });
    expect(s.core.flow!.phase).toBe('matchResult');
    s.b.msg({ t: 'rematch' });
    expect(s.core.flow!.phase).toBe('loadout');
    expect(s.core.flow!.plan.runnerIds[0]).not.toBe(firstRunner);
  });
});

describe('Raum: Wiederherstellung nach Aufwachen', () => {
  it('Mitglieder überstehen ein Neuladen des Objekts', () => {
    let saved: Parameters<NonNullable<ConstructorParameters<typeof RoomCore>[2]['persist']>>[0] | null = null;
    const core = new RoomCore('r', () => 1, { buildId: 't', persist: (p) => (saved = p) });
    const a = new FakeClient(core, 'Anna', 'keyAnna123456');
    a.msg({ t: 'join', name: 'Anna', key: a.key });
    expect(saved).not.toBeNull();
    const core2 = new RoomCore('r', () => 2, { buildId: 't' });
    core2.restore(saved!);
    const a2 = new FakeClient(core2, 'Anna', a.key);
    a2.msg({ t: 'join', name: 'Anna', key: a.key });
    expect(a2.memberId).toBe(a.memberId);
  });

  it('Strecke ist für Client und Server gleich (gleicher Seed)', () => {
    const s = setup();
    startMatch(s);
    const plan = s.a.last('match')!.m.plan;
    expect(JSON.stringify(generateTrack({ seed: plan.seed, theme: plan.theme }))).toBe(JSON.stringify(s.core.flow!.track));
  });
});

describe('Raum: Party', () => {
  it('Klassik mit 4 Spielern: jeder einmal Sniper, Punkte, Revanche', () => {
    let now = 5_000_000;
    const ended: MatchSummary[] = [];
    const core = new RoomCore('party01', () => now, { buildId: 't', onMatchEnd: (x) => ended.push(x) });
    const cs = ['Anna', 'Ben', 'Cem', 'Dana'].map((n, i) => {
      const c = new FakeClient(core, n, `key${n}xxxxxxxxx${i}`);
      c.msg({ t: 'join', name: n, key: c.key });
      return c;
    });
    cs[0]!.msg({ t: 'mode', mode: 'classic' });
    expect(cs[3]!.last('room')!.room.members.every((m) => m.seat === 'player')).toBe(true);
    for (const c of cs) c.msg({ t: 'ready', ready: true });
    expect(core.flow!.mode).toBe('classic');
    for (let i = 0; i < 400 && core.flow!.phase !== 'matchResult'; i++) {
      for (let t = 0; t < 1000; t += 50) {
        now += 50;
        if (t === 0) for (const c of cs) c.msg({ t: 'sync', c: now });
        core.tick();
      }
    }
    expect(core.flow!.phase).toBe('matchResult');
    const snipers = core.flow!.records.flatMap((r) => r.plan.sniperIds).sort();
    expect(snipers).toEqual(cs.map((c) => c.memberId!).sort());
    expect(ended).toHaveLength(1);
    for (const c of cs) c.msg({ t: 'rematch' });
    expect(core.flow!.phase).toBe('loadout');
  });

  it('1v1 mit Zuschauern: Sieger bleibt, nächster Zuschauer ist dran', () => {
    const s = setup();
    const c = new FakeClient(s.core, 'Cem', 'keyCem12345678');
    c.msg({ t: 'join', name: 'Cem', key: c.key });
    expect(s.core.roomInfo().members.find((m) => m.name === 'Cem')!.seat).toBe('spectator');
    startMatch(s);
    s.advance(12000, [s.a, s.b, c]);
    s.b.msg({ t: 'leave' }); // Ben gibt auf → Anna gewinnt
    expect(s.core.flow!.winnerId).toBe(s.a.memberId);
    const b2 = new FakeClient(s.core, 'Ben', s.b.key);
    b2.msg({ t: 'join', name: 'Ben', key: s.b.key });
    s.a.msg({ t: 'rematch' });
    expect(s.core.flow!.phase).toBe('loadout');
    expect(s.core.flow!.players.map((p) => p.name).sort()).toEqual(['Anna', 'Cem']);
  });
});
