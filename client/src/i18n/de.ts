/**
 * Alle Texte der Spieloberfläche (Deutsch).
 * Keine Texte direkt in Komponenten schreiben – immer von hier holen.
 */
export const T = {
  appName: 'Scope Rush',
  testPage: {
    title: 'Testseite',
    milestone: 'M0',
    build: 'Version',
    fps: 'FPS',
    pixelRatio: 'Auflösung',
  },
  server: {
    label: 'Server',
    notConfigured: 'Noch kein Server eingerichtet',
    connecting: 'Verbinde …',
    reconnecting: 'Verbinde neu …',
    connected: (ms: number) => `Verbunden · ${ms} ms`,
    connectedNoPing: 'Verbunden',
    offline: 'Nicht erreichbar',
    updateRequired: 'Update nötig',
    reconnect: 'Neu verbinden',
    details: (boots: number, connections: number) => `Starts: ${boots} · Verbindungen: ${connections}`,
    lagActive: (lag: number, jitter: number) => `Testverzögerung aktiv: ${lag} ± ${jitter} ms`,
  },
  sound: {
    label: 'Ton',
    test: 'Ton testen',
    ignoreSilentSwitch: 'Trotz Stummschalter',
    on: 'an',
    off: 'aus',
  },
  gestures: {
    label: 'Wischen',
    hint: 'Hier wischen oder Finger halten',
    left: '⬅️ Spur links',
    right: '➡️ Spur rechts',
    up: '⬆️ Springen',
    down: '⬇️ Rutschen',
    holdStart: '✋ Ducken …',
    holdEnd: '✋ Ducken beendet',
    tap: '👆 Tipp',
  },
  wakeLock: {
    label: 'Wach halten',
    active: 'Bildschirm bleibt an ✔',
    inactive: 'Tippe irgendwo, um zu aktivieren',
    unsupported: 'Nicht unterstützt',
  },
  safeArea: {
    label: 'Ränder',
    show: 'Ränder zeigen',
    hide: 'Ränder aus',
    values: (top: number, bottom: number) => `oben ${top} px · unten ${bottom} px`,
  },
  homeScreen: {
    label: 'Home-Bildschirm',
    installed: 'Läuft als App ✔',
    howTo: 'Home-Bildschirm',
    notIos: 'Nur auf dem iPhone nötig',
    guideTitle: 'Zum Home-Bildschirm hinzufügen',
    guideIntro: 'So läuft Scope Rush im Vollbild – ohne Browserleisten.',
    steps: [
      'Tippe in Safari unten auf „⋯“ (oder direkt auf das Teilen-Symbol □↑).',
      'Tippe auf „Teilen“ und dann auf „Zum Home-Bildschirm“ – eventuell etwas nach unten scrollen.',
      '„Als Web-App öffnen“ eingeschaltet lassen und oben rechts auf „Hinzufügen“ tippen.',
      'Ab jetzt Scope Rush immer über das neue Symbol auf dem Home-Bildschirm starten.',
    ],
    close: 'Verstanden',
    dontShowAgain: 'Nicht mehr anzeigen',
  },
  rotate: {
    title: 'Bitte ins Hochformat drehen',
    text: 'Scope Rush wird im Hochformat gespielt.',
  },
  update: {
    available: 'Update verfügbar',
    reload: 'Neu laden',
  },
} as const;
