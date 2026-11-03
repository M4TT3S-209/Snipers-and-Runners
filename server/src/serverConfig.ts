/**
 * Technische Server-Grenzen (kein Spiel-Balancing – das steht in
 * shared/src/config.ts).
 */
export const CONFIG_SERVER = {
  /** Hub: so viele Nachrichten dürfen auf einmal kommen … */
  hubRateBurst: 20,
  /** … und so viele kommen pro Sekunde wieder dazu. */
  hubRatePerSecond: 5,
  /** Erlaubte Zeichen in Raum-IDs. */
  roomIdPattern: /^[a-z0-9]{6,16}$/,
} as const;
