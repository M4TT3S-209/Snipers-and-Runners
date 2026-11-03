/**
 * Bildschirm wach halten (Screen Wake Lock API).
 * iOS: ab 16.4 in Safari, in der Home-Bildschirm-App zuverlässig ab 18.4.
 * Muss nach einer Nutzer-Geste angefordert und nach App-Wechsel erneuert werden.
 */
type Listener = (active: boolean) => void;

let sentinel: WakeLockSentinel | null = null;
let wanted = false;
const listeners = new Set<Listener>();

export function wakeLockSupported(): boolean {
  return 'wakeLock' in navigator;
}

export function onWakeLockChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(sentinel !== null && !sentinel.released);
  return () => listeners.delete(listener);
}

function notify(): void {
  const active = sentinel !== null && !sentinel.released;
  for (const l of listeners) l(active);
}

export async function requestWakeLock(): Promise<void> {
  wanted = true;
  if (!wakeLockSupported() || document.visibilityState !== 'visible') return;
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', notify);
  } catch {
    sentinel = null;
  }
  notify();
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false;
  await sentinel?.release();
  sentinel = null;
  notify();
}

// Nach Rückkehr in die App automatisch erneuern.
document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') void requestWakeLock();
});
