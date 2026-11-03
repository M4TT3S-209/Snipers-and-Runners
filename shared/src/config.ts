/**
 * ZENTRALE BALANCING-DATEI
 *
 * Alle Spielwerte (Zeiten, Schaden, Leben, Nachladezeiten, Geschwindigkeiten …)
 * stehen hier und nirgendwo sonst. Wenn sich etwas beim Testen nicht spaßig
 * anfühlt, wird es hier geändert – oder live im Spiel mit ?debug=1.
 *
 * Einheiten: Meter, Sekunden, Grad – außer der Name sagt etwas anderes
 * (…Ms = Millisekunden, …Px = Bildschirmpunkte).
 *
 * Achtung: Werte, die Server und Client gleich haben müssen (Bewegung,
 * Ballistik), dürfen nur hier geändert werden – sonst passen Vorhersage und
 * Server nicht mehr zusammen.
 */

export type WeaponId = 'precision' | 'semi' | 'rocket';
export type GadgetId = 'smoke' | 'shield' | 'sprint' | 'decoy';
export type BotLevel = 'easy' | 'medium' | 'hard';

export interface WeaponConfig {
  /** Geschossgeschwindigkeit (m/s) */
  speed: number;
  /** Fallbeschleunigung des Geschosses (m/s², 0 = gerade Flugbahn) */
  gravity: number;
  /** Schaden in Halbherzen (6 = alle 3 Herzen) */
  dmgBody: number;
  dmgHead: number;
  /** Schüsse pro Magazin */
  magSize: number;
  /** Mindestabstand zwischen zwei Schüssen */
  fireIntervalS: number;
  /** Nachladezeit, wenn das Magazin leer ist */
  reloadS: number;
  /** Munition pro Zug insgesamt (0 = unbegrenzt) */
  totalAmmo: number;
  /** Schaden an Deckung pro Treffer */
  coverDmg: number;
  /** Explosionsradius (0 = keine Explosion) */
  splashR: number;
  splashDmg: number;
  /** Faktor für das Wackeln im Zielfernrohr */
  sway: number;
  /** Treffer-Radius des Geschosses (macht das Treffen etwas leichter) */
  radius: number;
}

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
    /** Ziel-Länge der Strecke – ein sauberer Lauf dauert dann ca. 30 s. */
    targetLengthM: 205,
    towerHeightM: 18,
    /** Abstand Ziellinie → Turm */
    towerBehindFinishM: 12,
    /** Augenhöhe des Snipers über dem Turmboden */
    sniperEyeAboveTowerM: 2.1,
    startAreaM: 14,
    finishAreaM: 12,
  },

  runner: {
    speed: 7.0,
    maxRunS: 45,
    /** Leben in Halbherzen (6 = 3 Herzen) */
    hp: 6,
    jumpHeight: 1.45,
    jumpAirS: 0.62,
    padJumpHeight: 6,
    slideS: 0.65,
    laneChangeS: 0.16,
    stumbleS: 0.6,
    stumbleSpeedFactor: 0.35,
    fallRespawnS: 1.6,
    /** Kleine Kanten (bis zu dieser Höhe) läuft man einfach hoch. */
    stepUpM: 0.3,
    /** Halbe Tiefe des Läufers (für Kollisionen nach vorn) */
    radius: 0.3,
    /** Rutschen in der Luft = schnell nach unten */
    airSlideVy: -14,
    /** Sprung kurz vor der Landung wird gemerkt */
    jumpBufferS: 0.12,
    /** Sprung kurz nach Verlassen einer Kante geht noch */
    coyoteS: 0.08,
  },

  hitbox: {
    width: 0.62,
    depth: 0.5,
    standH: 1.35,
    duckH: 0.8,
    slideH: 0.5,
    headR: 0.24,
    headY: 1.6,
    duckHeadY: 1.0,
    slideHeadY: 0.42,
  },

  weapons: {
    precision: {
      speed: 180,
      gravity: 0,
      dmgBody: 2,
      dmgHead: 6,
      magSize: 1,
      fireIntervalS: 0.25,
      reloadS: 1.8,
      totalAmmo: 0,
      coverDmg: 1,
      splashR: 0,
      splashDmg: 0,
      sway: 1,
      radius: 0.06,
    },
    semi: {
      speed: 150,
      gravity: 0,
      dmgBody: 1,
      dmgHead: 3,
      magSize: 4,
      fireIntervalS: 0.35,
      reloadS: 2.4,
      totalAmmo: 0,
      coverDmg: 1,
      splashR: 0,
      splashDmg: 0,
      sway: 1.4,
      radius: 0.06,
    },
    rocket: {
      speed: 45,
      gravity: 0,
      dmgBody: 3,
      dmgHead: 3,
      magSize: 1,
      fireIntervalS: 0.25,
      reloadS: 2.5,
      totalAmmo: 3,
      coverDmg: 99,
      splashR: 3,
      splashDmg: 1,
      sway: 1.2,
      radius: 0.18,
    },
  } satisfies Record<WeaponId, WeaponConfig>,

  cover: {
    crate: { hp: 2, w: 1.5, h: 1.25, d: 1.5 },
    wall: { hp: 4, w: 2.2, h: 2.1, d: 0.6 },
    barrel: { hp: 1, w: 1.1, h: 1.3, d: 1.1 },
    /** Explodierende Fässer beschädigen Deckung in diesem Umkreis (nicht Läufer). */
    barrelSplashR: 2.6,
  },

  obstacles: {
    hurdleH: 0.9,
    barY0: 1.05,
    barY1: 1.5,
    /** Versinkende Plattformen: Zyklus und Anteil „oben“ */
    sinkerPeriodS: 3.0,
    sinkerUpFraction: 0.55,
  },

  scope: {
    /** Sichtfeld (vertikal, Grad) je Zoomstufe: 0 = ohne Zielfernrohr */
    fovs: [62, 24, 12, 6],
    /** Wackeln je Zoomstufe (Grad) */
    swayDeg: [0, 0.1, 0.18, 0.28],
    swayHz: 0.33,
    /** Ab dieser Zoomstufe glitzert das Zielfernrohr für den Läufer */
    glintFromLevel: 1,
    /** Grundempfindlichkeit beim Zielen (Grad pro Bildschirmpunkt bei Stufe 0) */
    dragDegPerPx: 0.12,
    /** Grenzen der Blickrichtung des Snipers (Grad) */
    maxYawDeg: 28,
    minPitchDeg: -40,
    maxPitchDeg: 2,
  },

  gadgets: {
    smoke: { durationS: 3.5, radius: 3 },
    shield: { durationS: 8 },
    sprint: { durationS: 2.5, factor: 1.5 },
    decoy: { durationS: 6 },
    usesPerRun: 1,
  },

  match: {
    loadoutS: 8,
    countdownS: 3,
    turnResultS: 3.5,
    roundResultS: 2.5,
    roundsToWin: 2,
    maxRounds: 5,
  },

  party: {
    minPlayers: 3,
    maxPlayers: 8,
    twoSnipersFrom: 6,
    /** Punkte für Läufer im Ziel nach Platzierung (danach immer der letzte Wert) */
    finishPoints: [5, 4, 3, 2],
    hitPoints: 1,
    eliminationPoints: 2,
  },

  trophies: {
    win: 10,
    loss: 3,
    draw: 5,
    /** Party: Trophäen nach Platzierung */
    partyPlacement: [10, 7, 5, 3],
  },

  bots: {
    sniper: {
      easy: { reactionS: 1.1, aimS: 1.6, aimErrorDeg: 1.1, leadSkill: 0.55, headshotChance: 0.05 },
      medium: { reactionS: 0.7, aimS: 1.1, aimErrorDeg: 0.6, leadSkill: 0.8, headshotChance: 0.15 },
      hard: { reactionS: 0.4, aimS: 0.7, aimErrorDeg: 0.3, leadSkill: 0.95, headshotChance: 0.3 },
    },
    runner: {
      easy: { reactionS: 0.3, mistakeChance: 0.18, duckChance: 0.2, dodgeChance: 0.15 },
      medium: { reactionS: 0.18, mistakeChance: 0.07, duckChance: 0.45, dodgeChance: 0.35 },
      hard: { reactionS: 0.1, mistakeChance: 0.02, duckChance: 0.7, dodgeChance: 0.55 },
    },
  } satisfies Record<'sniper' | 'runner', Record<BotLevel, Record<string, number>>>,

  /** Touch-Gesten (Läufer). */
  input: {
    swipeMinPx: 26,
    swipeMaxMs: 450,
    holdMs: 170,
    holdMaxMovePx: 14,
  },

  render: {
    /** Pixel-Ratio höchstens 2 (iPhone hat 3) – spart viel Grafikleistung. */
    maxPixelRatio: 2,
    lowFpsThreshold: 55,
    lowPixelRatio: 1.5,
  },

  net: {
    syncIntervalMs: 2000,
    reconnectBaseMs: 500,
    reconnectMaxMs: 8000,
    heartbeatMs: 10000,
    /** Höchstens so weit spult der Server für einen Schuss zurück. */
    maxRewindMs: 250,
    /** Bis zu dieser Verspätung werden Läufer-Eingaben rückwirkend eingerechnet. */
    lateInputToleranceMs: 120,
    /** Puffer, den der Läufer-Client vor dem Server herläuft. */
    inputLeadBufferMs: 30,
    /** Schonfrist nach Verbindungsabbruch im Match */
    graceS: 45,
    /** Aim-Updates des Snipers pro Sekunde */
    aimSendHz: 12,
  },

  social: {
    challengeTimeoutS: 30,
    inboxTtlMin: 5,
    inviteLinkTtlDays: 7,
    transferCodeTtlMin: 15,
    pairingTtlMin: 10,
  },
};

export type Config = typeof CONFIG;

/** Sekunden → Ticks (gerundet) */
export function secondsToTicks(s: number): number {
  return Math.round(s * CONFIG.sim.hz);
}
