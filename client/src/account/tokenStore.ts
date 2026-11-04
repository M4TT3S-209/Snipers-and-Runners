/**
 * Konto-Token auf dem Gerät.
 *
 * iOS-Besonderheit: Safari und die Home-Bildschirm-App haben getrennten
 * Speicher. Beim „Zum Home-Bildschirm“ kopiert iOS (ab 17.2) aber einmalig die
 * Cookies. Deshalb liegt das Token in localStorage UND in einem Cookie.
 */
const LS_KEY = 'rvs.token';
const COOKIE = 'rvs_t';

export function loadToken(): string | null {
  try {
    const t = localStorage.getItem(LS_KEY);
    if (t) return t;
  } catch {
    // privater Modus
  }
  const fromCookie = readCookie();
  if (fromCookie) {
    try {
      localStorage.setItem(LS_KEY, fromCookie);
    } catch {
      // ignorieren
    }
  }
  return fromCookie;
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(LS_KEY, token);
  } catch {
    // ignorieren
  }
  writeCookie(token);
}

export function clearToken(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignorieren
  }
  document.cookie = `${COOKIE}=; Max-Age=0; Path=${cookiePath()}; SameSite=Lax`;
}

/** Cookie erneuern (Safari kürzt per Skript gesetzte Cookies auf 7 Tage) */
export function refreshCookie(): void {
  const t = loadToken();
  if (t) writeCookie(t);
}

function cookiePath(): string {
  return import.meta.env.BASE_URL || '/';
}

function writeCookie(token: string): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${400 * 24 * 3600}; Path=${cookiePath()}; SameSite=Lax${secure}`;
}

function readCookie(): string | null {
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`));
  if (!m) return null;
  const v = decodeURIComponent(m.slice(COOKIE.length + 1));
  return /^[A-Za-z0-9_-]{20,80}$/.test(v) ? v : null;
}
