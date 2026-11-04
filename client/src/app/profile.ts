import { CONFIG, DEFAULT_COSMETICS, newlyUnlocked, sanitizeCosmetics, type Cosmetics, type Unlockable } from '@scope-rush/shared';
import type { HubClient } from '../account/HubClient';
import { getSettings, updateSettings } from './settings';

/**
 * Trophäen und Aussehen des Spielers.
 * Mit Konto: vom Server. Ohne Server: lokal (Bot-Duelle geben Trophäen).
 */
let hub: HubClient | null = null;
const newsListeners = new Set<(items: Unlockable[]) => void>();

export function bindProfileHub(h: HubClient | null): void {
  hub = h;
  let last = myTrophies();
  h?.on((e) => {
    if (e.t !== 'state') return;
    const now = myTrophies();
    if (now > last) announce(newlyUnlocked(last, now));
    last = now;
  });
}

export function myTrophies(): number {
  const p = hub?.state.profile;
  if (hub && typeof hub.state.account === 'object' && p) return p.trophies;
  return getSettings().localTrophies;
}

export function myCosmetics(): Cosmetics {
  const p = hub?.state.profile;
  if (hub && typeof hub.state.account === 'object' && p) return p.cosmetics;
  return sanitizeCosmetics({ skin: getSettings().skin, emote: getSettings().emote }, myTrophies()) ?? DEFAULT_COSMETICS;
}

export function setMyCosmetics(c: Cosmetics): void {
  updateSettings({ skin: c.skin, emote: c.emote });
  if (hub && typeof hub.state.account === 'object') hub.setCosmetics(c);
}

/** Offline-Trophäen (nur ohne Server-Konto) */
export function awardLocalTrophies(result: 'win' | 'loss' | 'draw'): void {
  if (hub && typeof hub.state.account === 'object') return;
  const before = getSettings().localTrophies;
  const gain = result === 'win' ? CONFIG.trophies.win / 2 : result === 'draw' ? CONFIG.trophies.draw / 2 : CONFIG.trophies.loss / 2;
  const after = before + Math.round(gain);
  updateSettings({ localTrophies: after });
  announce(newlyUnlocked(before, after));
}

export function onUnlockNews(cb: (items: Unlockable[]) => void): () => void {
  newsListeners.add(cb);
  return () => newsListeners.delete(cb);
}

function announce(items: Unlockable[]): void {
  if (items.length === 0) return;
  for (const l of newsListeners) l(items);
}
