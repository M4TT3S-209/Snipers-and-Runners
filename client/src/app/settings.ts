/**
 * Einstellungen – auf dem Gerät gespeichert (localStorage).
 * Alles robust gegen fehlenden Speicher (privater Modus).
 */
export type FireMode = 'button' | 'release';
export type BotLevelSetting = 'easy' | 'medium' | 'hard';

export interface Settings {
  name: string;
  sensitivity: number;
  fireMode: FireMode;
  gyro: boolean;
  volume: number;
  ignoreSilentSwitch: boolean;
  botLevel: BotLevelSetting;
  showFps: boolean;
  /** Hinweise schon gesehen */
  seenRunnerTips: boolean;
  seenSniperTips: boolean;
  seenTutorial: boolean;
  /** Offline-Trophäen (ohne Server) */
  localTrophies: number;
  skin: number;
  emote: 'cheer' | 'dance' | 'spin' | 'flex';
}

const KEY = 'rvs.settings.v1';

const DEFAULTS: Settings = {
  name: '',
  sensitivity: 1,
  fireMode: 'button',
  gyro: false,
  volume: 0.8,
  ignoreSilentSwitch: false,
  botLevel: 'medium',
  showFps: false,
  seenRunnerTips: false,
  seenSniperTips: false,
  seenTutorial: false,
  localTrophies: 0,
  skin: 0,
  emote: 'cheer',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignorieren
  }
  return { ...DEFAULTS };
}

let current = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // ignorieren
  }
  for (const l of listeners) l(current);
}

export function onSettings(cb: (s: Settings) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
