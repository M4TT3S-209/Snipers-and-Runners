/**
 * Ermittelt die Server-Adresse.
 * Reihenfolge:
 *  1. URL-Parameter ?server=… (zum Testen)
 *  2. VITE_SERVER_URL (setzt die GitHub Action beim Build)
 *  3. lokale Entwicklung: gleicher Rechner, Port 8787
 *  4. sonst: kein Server (Offline-Modus)
 */
export function resolveServerUrl(
  search: string,
  envUrl: string | undefined,
  location: { protocol: string; hostname: string },
): string | null {
  const param = new URLSearchParams(search).get('server');
  if (param && /^https?:\/\//.test(param)) return trimSlash(param);
  if (envUrl && /^https?:\/\//.test(envUrl)) return trimSlash(envUrl);
  if (isLocalHost(location.hostname)) return `${location.protocol}//${location.hostname}:8787`;
  return null;
}

/** http(s)://… → ws(s)://… */
export function toWebSocketUrl(httpUrl: string, path: string): string {
  return httpUrl.replace(/^http/, 'ws') + path;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}
