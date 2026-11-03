import { describe, expect, it } from 'vitest';
import { CONFIG, RunnerBot, TurnSim, generateTrack, type SegmentKind } from '../src/index';

describe('Streckengenerator', () => {
  it('gleicher Seed → gleiche Strecke', () => {
    expect(JSON.stringify(generateTrack({ seed: 1234 }))).toBe(JSON.stringify(generateTrack({ seed: 1234 })));
    expect(JSON.stringify(generateTrack({ seed: 1234 }))).not.toBe(JSON.stringify(generateTrack({ seed: 1235 })));
  });

  it('beginnt mit Start, endet mit Ziel, Länge passt', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = generateTrack({ seed });
      expect(t.segments[0]!.kind).toBe('start');
      expect(t.segments.at(-1)!.kind).toBe('finish');
      expect(t.length).toBeGreaterThan(CONFIG.track.targetLengthM - 40);
      expect(t.length).toBeLessThan(CONFIG.track.targetLengthM + 40);
      expect(t.towerZ).toBe(t.length + CONFIG.track.towerBehindFinishM);
      // Keine zwei gleichen Segmente hintereinander
      for (let i = 1; i < t.segments.length; i++) expect(t.segments[i]!.kind).not.toBe(t.segments[i - 1]!.kind);
    }
  });

  it('Elemente sind nach z sortiert und in gültigen Spuren', () => {
    const t = generateTrack({ seed: 77 });
    for (const list of [t.covers, t.trips, t.holes, t.sinkers, t.pads]) {
      for (let i = 1; i < list.length; i++) expect(list[i]!.z0).toBeGreaterThanOrEqual(list[i - 1]!.z0);
      for (const e of list) {
        expect(e.lane).toBeGreaterThanOrEqual(0);
        expect(e.lane).toBeLessThanOrEqual(2);
      }
    }
  });

  it('erlaubte Segmente werden eingehalten', () => {
    const allowed: SegmentKind[] = ['hurdles', 'crates'];
    const t = generateTrack({ seed: 5, allowed });
    for (const s of t.segments) expect(['start', 'finish', ...allowed]).toContain(s.kind);
  });
});

describe('Lösbarkeit (Bot läuft ohne Sniper)', () => {
  it('jede Strecke ist schaffbar und ein sauberer Lauf dauert etwa 30 s', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const track = generateTrack({ seed });
      const sim = new TurnSim({ track, runners: [{ id: 'bot', gadget: null }], snipers: [] });
      // „hard“ = kaum Fehler – prüft die Strecke, nicht den Bot
      const bot = new RunnerBot('bot', 'hard', seed);
      while (!sim.over) {
        for (const a of bot.think(sim)) sim.queueRunnerAction('bot', a);
        sim.step();
      }
      const run = sim.results().runs[0]!;
      if (!run.finished) throw new Error(`Seed ${seed}: nicht im Ziel (z=${run.distance.toFixed(1)}, Segmente: ${track.segments.map((s) => s.kind).join(',')})`);
      times.push(run.timeTicks! / CONFIG.sim.hz);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeGreaterThan(26);
    expect(avg).toBeLessThan(36);
    expect(Math.max(...times)).toBeLessThan(CONFIG.runner.maxRunS);
  });
});
