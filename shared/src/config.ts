/**
 * ZENTRALE BALANCING-DATEI
 *
 * Alle Spielwerte (Zeiten, Schaden, Leben, Nachladezeiten, Geschwindigkeiten …)
 * stehen hier und nirgendwo sonst. Wenn sich etwas beim Testen nicht spaßig
 * anfühlt, wird es hier geändert.
 *
 * Einheiten: Meter, Sekunden, Grad – außer wenn der Name etwas anderes sagt
 * (z. B. `…Ms` = Millisekunden, `…Px` = Bildschirmpunkte).
 *
 * In M0 sind nur die Werte gefüllt, die die Testseite braucht. Der Rest
 * kommt mit M1 (siehe PLAN.md, Abschnitt 5).
 */
export const CONFIG = {
  sim: {
    /** Simulationsschritte pro Sekunde (fester Zeitschritt). */
    hz: 60,
    /** Zustandsupdates vom Server pro Sekunde. */
    netSendHz: 20,
    /** Wie weit Gegner hinter der Server-Zeit gezeichnet werden. */
    interpDelayMs: 100,
  },

  track: {
    lanes: 3,
    laneWidth: 2.4,
    targetLengthM: 210,
    towerHeightM: 18,
    towerBehindFinishM: 12,
  },

  /** Touch-Gesten (Läufer). */
  input: {
    /** Mindestweg für einen Wisch. */
    swipeMinPx: 28,
    /** Maximale Dauer eines Wischs – länger ist kein Wisch mehr. */
    swipeMaxMs: 450,
    /** So lange muss der Finger still liegen, damit es „halten“ (ducken) ist. */
    holdMs: 180,
    /** Bis zu diesem Weg gilt der Finger als „still“. */
    holdMaxMovePx: 14,
  },

  render: {
    /** Pixel-Ratio höchstens 2 (iPhone hat 3) – spart viel Grafikleistung. */
    maxPixelRatio: 2,
    /** Fällt die Bildrate darunter, wird die Auflösung gesenkt. */
    lowFpsThreshold: 55,
    lowPixelRatio: 1.5,
  },

  net: {
    /** Abstand der Uhr-Abgleich-Pings. */
    syncIntervalMs: 2000,
    /** Erste Wartezeit vor einem Neuverbindungsversuch, danach verdoppelt. */
    reconnectBaseMs: 500,
    reconnectMaxMs: 8000,
    /** Heartbeat zum Server, damit tote Verbindungen auffallen. */
    heartbeatMs: 10000,
  },
} as const;

export type Config = typeof CONFIG;
