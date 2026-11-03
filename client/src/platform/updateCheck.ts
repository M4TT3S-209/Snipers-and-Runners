/**
 * Update-Erkennung:
 *  1. version.json auf GitHub Pages hat eine andere Build-ID als diese Seite
 *  2. der Server meldet eine andere Protokollversion (WebSocket-Code 4001)
 * In beiden Fällen erscheint „Update verfügbar – neu laden“.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let available = false;

export function onUpdateAvailable(listener: Listener): () => void {
  listeners.add(listener);
  if (available) listener();
  return () => listeners.delete(listener);
}

export function markUpdateAvailable(): void {
  if (available) return;
  available = true;
  for (const l of listeners) l();
}

export async function checkForUpdate(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { build?: string };
    if (data.build && data.build !== __BUILD_ID__) markUpdateAvailable();
  } catch {
    // offline – später nochmal
  }
}

/** Beim Start und bei jeder Rückkehr in die App prüfen. */
export function startUpdateChecks(): void {
  setTimeout(() => void checkForUpdate(), 3000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
}

/** Neu laden – vorher den alten Service Worker ablösen. */
export async function reloadForUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // egal
  }
  location.reload();
}
