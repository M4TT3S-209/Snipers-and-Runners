/**
 * Deterministischer Zufall (mulberry32).
 *
 * Gleicher Seed ⇒ gleiche Zahlenfolge, auf jedem Gerät und auf dem Server.
 * In der Simulation NIE Math.random benutzen, sondern immer das hier.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Ganzzahl 0 … 2^32-1 */
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Kommazahl im Bereich [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Ganzzahl im Bereich [min, max] (beide inklusive) */
  int(min: number, max: number): number {
    return min + (this.nextU32() % (max - min + 1));
  }

  /** Zufälliges Element einer nicht-leeren Liste */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() auf leerer Liste');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Aktueller Zustand – zum Speichern/Wiederherstellen. */
  getState(): number {
    return this.state;
  }
}

/** Macht aus einem Text (z. B. Raum-ID) einen Seed. FNV-1a, 32 Bit. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
