import type { GadgetId, WeaponId } from './config';
import type { ThemeId } from './track/types';

/**
 * Freischaltungen über Trophäen.
 *
 * Grundsatz: Freischaltungen beeinflussen das Spiel kaum. Waffen und Gadgets
 * sind gleichwertige Alternativen und nach wenigen Matches alle frei;
 * Themen, Skins und Emotes sind reine Optik.
 */
export type EmoteId = 'cheer' | 'dance' | 'spin' | 'flex';

export type Unlockable =
  | { kind: 'theme'; id: ThemeId; trophies: number }
  | { kind: 'weapon'; id: WeaponId; trophies: number }
  | { kind: 'gadget'; id: GadgetId; trophies: number }
  | { kind: 'skin'; id: number; trophies: number }
  | { kind: 'emote'; id: EmoteId; trophies: number };

export const UNLOCKS: readonly Unlockable[] = [
  { kind: 'weapon', id: 'precision', trophies: 0 },
  { kind: 'gadget', id: 'shield', trophies: 0 },
  { kind: 'gadget', id: 'sprint', trophies: 0 },
  { kind: 'theme', id: 'meadow', trophies: 0 },
  { kind: 'skin', id: 0, trophies: 0 },
  { kind: 'skin', id: 1, trophies: 0 },
  { kind: 'emote', id: 'cheer', trophies: 0 },
  { kind: 'weapon', id: 'semi', trophies: 10 },
  { kind: 'skin', id: 2, trophies: 15 },
  { kind: 'gadget', id: 'smoke', trophies: 20 },
  { kind: 'theme', id: 'desert', trophies: 25 },
  { kind: 'weapon', id: 'rocket', trophies: 30 },
  { kind: 'skin', id: 3, trophies: 35 },
  { kind: 'gadget', id: 'decoy', trophies: 40 },
  { kind: 'emote', id: 'dance', trophies: 45 },
  { kind: 'skin', id: 4, trophies: 55 },
  { kind: 'theme', id: 'ice', trophies: 60 },
  { kind: 'skin', id: 5, trophies: 80 },
  { kind: 'emote', id: 'spin', trophies: 90 },
  { kind: 'theme', id: 'neon', trophies: 100 },
  { kind: 'skin', id: 6, trophies: 115 },
  { kind: 'emote', id: 'flex', trophies: 130 },
  { kind: 'theme', id: 'candy', trophies: 150 },
  { kind: 'skin', id: 7, trophies: 180 },
];

export function isUnlocked(kind: Unlockable['kind'], id: string | number, trophies: number): boolean {
  const u = UNLOCKS.find((x) => x.kind === kind && x.id === id);
  return u !== undefined && trophies >= u.trophies;
}

export function trophiesFor(kind: Unlockable['kind'], id: string | number): number {
  return UNLOCKS.find((x) => x.kind === kind && x.id === id)?.trophies ?? 0;
}

/** Themen, die mindestens einer der Spieler freigeschaltet hat (für gemeinsame Matches) */
export function themesFor(trophiesOfPlayers: readonly number[]): ThemeId[] {
  const best = Math.max(0, ...trophiesOfPlayers);
  return UNLOCKS.filter((u): u is Extract<Unlockable, { kind: 'theme' }> => u.kind === 'theme' && best >= u.trophies).map((u) => u.id);
}

/** Was wird zwischen zwei Trophäen-Ständen neu frei? (für „Neu freigeschaltet!“) */
export function newlyUnlocked(before: number, after: number): Unlockable[] {
  return UNLOCKS.filter((u) => u.trophies > before && u.trophies <= after);
}

export interface Cosmetics {
  skin: number;
  emote: EmoteId;
}

export const DEFAULT_COSMETICS: Cosmetics = { skin: 0, emote: 'cheer' };

export function sanitizeCosmetics(raw: unknown, trophies: number): Cosmetics {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Cosmetics>;
  const skin = typeof c.skin === 'number' && isUnlocked('skin', c.skin, trophies) ? c.skin : 0;
  const emote = typeof c.emote === 'string' && isUnlocked('emote', c.emote, trophies) ? c.emote : 'cheer';
  return { skin, emote };
}
