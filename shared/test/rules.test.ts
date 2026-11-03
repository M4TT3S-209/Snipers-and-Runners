import { describe, expect, it } from 'vitest';
import { BotDriver, CONFIG, MatchFlow, classicPoints, compareRuns, roundWinner, sniperCount, type RunResult } from '../src/index';

function run(p: Partial<RunResult>): RunResult {
  return { runnerId: 'x', finished: false, timeTicks: null, distance: 0, hp: 6, out: false, outTick: null, hitsTaken: 0, ...p };
}

describe('Rundenwertung (Duell)', () => {
  it('beide im Ziel → schnellere Zeit gewinnt', () => {
    expect(roundWinner(run({ finished: true, timeTicks: 1800 }), run({ finished: true, timeTicks: 1700 }))).toBe(1);
  });
  it('nur einer im Ziel → der gewinnt, egal wie weit der andere kam', () => {
    expect(roundWinner(run({ finished: true, timeTicks: 2600, distance: 200 }), run({ distance: 199 }))).toBe(0);
  });
  it('keiner im Ziel → weitere Strecke gewinnt', () => {
    expect(roundWinner(run({ distance: 80, out: true, outTick: 500 }), run({ distance: 120, out: true, outTick: 300 }))).toBe(1);
  });
  it('Gleichstand → mehr Leben, dann späteres Ausscheiden', () => {
    expect(compareRuns(run({ finished: true, timeTicks: 1800, hp: 6 }), run({ finished: true, timeTicks: 1800, hp: 4 }))).toBeGreaterThan(0);
    expect(compareRuns(run({ distance: 50, hp: 0, outTick: 900 }), run({ distance: 50, hp: 0, outTick: 400 }))).toBeGreaterThan(0);
    expect(roundWinner(run({ distance: 50 }), run({ distance: 50 }))).toBeNull();
  });
});

describe('Party-Punkte (Klassik)', () => {
  it('Platzierung im Ziel + Treffer für den Sniper', () => {
    const pts = classicPoints({
      ticks: 2000,
      runs: [
        run({ runnerId: 'a', finished: true, timeTicks: 1900 }),
        run({ runnerId: 'b', finished: true, timeTicks: 1800 }),
        run({ runnerId: 'c', out: true, outTick: 500 }),
      ],
      snipers: [{ sniperId: 's', shots: 6, hits: 3, eliminations: 1 }],
    });
    expect(pts.get('b')).toBe(CONFIG.party.finishPoints[0]);
    expect(pts.get('a')).toBe(CONFIG.party.finishPoints[1]);
    expect(pts.get('c')).toBe(0);
    expect(pts.get('s')).toBe(3 * CONFIG.party.hitPoints + CONFIG.party.eliminationPoints);
  });
  it('ab 6 Spielern zwei Sniper', () => {
    expect(sniperCount(5)).toBe(1);
    expect(sniperCount(6)).toBe(2);
  });
});

function playOut(flow: MatchFlow, driver: BotDriver, maxTicks = 60 * 60 * 15): void {
  for (let i = 0; i < maxTicks && flow.phase !== 'matchResult'; i++) {
    driver.beforeStep();
    flow.step();
    flow.drainEvents();
  }
}

describe('Match-Ablauf', () => {
  it('Duell: Rollentausch je Runde, gleiche Strecke pro Runde, Best of 3', () => {
    const flow = new MatchFlow({ mode: 'duel', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 42 });
    const driver = new BotDriver(flow, [{ id: 'a', level: 'medium' }, { id: 'b', level: 'medium' }], 1);
    playOut(flow, driver);
    expect(flow.phase).toBe('matchResult');
    const recs = flow.records;
    expect(recs.length % 2).toBe(0);
    expect(recs.length).toBeGreaterThanOrEqual(4);
    // Runde 1: a läuft zuerst, Runde 2: b läuft zuerst
    expect(recs[0]!.plan.runnerIds).toEqual(['a']);
    expect(recs[1]!.plan.runnerIds).toEqual(['b']);
    expect(recs[2]!.plan.runnerIds).toEqual(['b']);
    // gleiche Strecke innerhalb einer Runde
    expect(recs[0]!.plan.seed).toBe(recs[1]!.plan.seed);
    expect(recs[0]!.plan.seed).not.toBe(recs[2]!.plan.seed);
    const wins = [...flow.roundWins.values()];
    if (!flow.draw) expect(Math.max(...wins)).toBe(CONFIG.match.roundsToWin);
  });

  it('Klassik: jeder ist genau einmal Sniper', () => {
    const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
    const flow = new MatchFlow({ mode: 'classic', players, seed: 7 });
    const driver = new BotDriver(flow, players.map((p) => ({ id: p.id, level: 'easy' as const })), 2);
    playOut(flow, driver);
    expect(flow.phase).toBe('matchResult');
    const snipers = flow.records.flatMap((r) => r.plan.sniperIds).sort();
    expect(snipers).toEqual(['a', 'b', 'c', 'd']);
    for (const r of flow.records) expect(r.plan.runnerIds.length).toBe(3);
  });

  it('Ausrüstungswahl wird übernommen', () => {
    const flow = new MatchFlow({ mode: 'duel', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 1 });
    flow.setLoadout('b', { weapon: 'rocket' });
    flow.setLoadout('a', { gadget: 'shield' });
    for (let i = 0; i < 60 && flow.phase === 'loadout'; i++) flow.step();
    expect(flow.phase).toBe('countdown');
    expect(flow.turn!.sniper('b')!.weapon).toBe('rocket');
    expect(flow.turn!.runner('a')!.gadget).toBe('shield');
  });
});
