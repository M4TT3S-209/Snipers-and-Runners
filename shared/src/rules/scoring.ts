import { CONFIG } from '../config';
import type { RunResult, TurnResult } from '../sim/turn';

/**
 * Vergleicht zwei Läufe. > 0: a ist besser, < 0: b ist besser, 0: gleich.
 *
 * Regeln (PLAN.md 4.2):
 *  1. Beide im Ziel → schnellere Zeit
 *  2. Nur einer im Ziel → der
 *  3. Keiner im Ziel → weitere Strecke
 *  Gleichstand → mehr Leben übrig → späteres Ausscheiden (nicht ausgeschieden ist am besten)
 */
export function compareRuns(a: RunResult, b: RunResult): number {
  if (a.finished && b.finished) {
    const dt = (b.timeTicks ?? 0) - (a.timeTicks ?? 0);
    if (dt !== 0) return dt;
  } else if (a.finished !== b.finished) {
    return a.finished ? 1 : -1;
  } else {
    const dd = a.distance - b.distance;
    if (Math.abs(dd) > 0.01) return dd;
  }
  if (a.hp !== b.hp) return a.hp - b.hp;
  const ao = a.outTick ?? Number.MAX_SAFE_INTEGER;
  const bo = b.outTick ?? Number.MAX_SAFE_INTEGER;
  return ao === bo ? 0 : ao > bo ? 1 : -1;
}

/** Rundensieger im Duell: Index 0/1 oder null bei Gleichstand. */
export function roundWinner(runA: RunResult, runB: RunResult): 0 | 1 | null {
  const c = compareRuns(runA, runB);
  return c > 0 ? 0 : c < 0 ? 1 : null;
}

/** Punkte im Party-Modus „Klassik“ für einen Zug. */
export function classicPoints(result: TurnResult): Map<string, number> {
  const points = new Map<string, number>();
  const finishers = result.runs
    .filter((r) => r.finished)
    .sort((a, b) => (a.timeTicks ?? 0) - (b.timeTicks ?? 0));
  const table = CONFIG.party.finishPoints;
  finishers.forEach((r, place) => {
    points.set(r.runnerId, table[Math.min(place, table.length - 1)] ?? 0);
  });
  for (const r of result.runs) if (!points.has(r.runnerId)) points.set(r.runnerId, 0);
  for (const s of result.snipers) {
    points.set(
      s.sniperId,
      (points.get(s.sniperId) ?? 0) + s.hits * CONFIG.party.hitPoints + s.eliminations * CONFIG.party.eliminationPoints,
    );
  }
  return points;
}

/** Wie viele Sniper bei dieser Spielerzahl? */
export function sniperCount(players: number): number {
  return players >= CONFIG.party.twoSnipersFrom ? 2 : 1;
}

/** Format für Zeiten: 28,41 s */
export function formatTime(ticks: number): string {
  return (ticks / CONFIG.sim.hz).toFixed(2).replace('.', ',') + ' s';
}

export function formatDistance(m: number): string {
  return `${Math.round(m)} m`;
}
