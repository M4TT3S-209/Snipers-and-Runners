/**
 * Origin-Check: Nur unsere Spielseite darf mit dem Server sprechen.
 *
 * Hinweis: Das schützt vor fremden Webseiten im Browser. Programme außerhalb
 * des Browsers können den Header fälschen – deshalb prüft der Server
 * zusätzlich jede Nachricht (zod) und begrenzt die Rate.
 */
export function isOriginAllowed(origin: string | null, allowedList: string, environment: string): boolean {
  if (!origin) return false;
  const allowed = allowedList
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  const normalized = origin.trim().toLowerCase();
  if (allowed.includes(normalized)) return true;

  if (environment === 'dev') {
    // Lokale Entwicklung: localhost und Geräte im Heimnetz (iPhone-Test im WLAN).
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      return false;
    }
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  }
  return false;
}

/** CORS-Header für erlaubte Herkunft (nur für einfache GET-Anfragen nötig). */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
