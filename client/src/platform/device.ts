/** Erkennung von Gerät und Startart. */

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS meldet sich als Mac – aber mit Touch.
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
}

/** Läuft die Seite als Home-Bildschirm-App (ohne Browserleisten)? */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

/** Touch-Gerät (Handy/Tablet) – im Gegensatz zum Desktop-Browser zum Testen. */
export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}
