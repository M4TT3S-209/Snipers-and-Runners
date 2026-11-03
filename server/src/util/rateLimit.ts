/**
 * Einfacher Token-Bucket: `capacity` Nachrichten auf einmal, danach
 * `refillPerSecond` neue pro Sekunde. Pro Verbindung eine Instanz.
 *
 * Der Zustand ist klein und lässt sich serialisieren (für Hibernation).
 */
export interface BucketState {
  tokens: number;
  last: number;
}

export function takeToken(
  state: BucketState,
  now: number,
  capacity: number,
  refillPerSecond: number,
): { allowed: boolean; state: BucketState } {
  const elapsed = Math.max(0, now - state.last) / 1000;
  const tokens = Math.min(capacity, state.tokens + elapsed * refillPerSecond);
  if (tokens < 1) return { allowed: false, state: { tokens, last: now } };
  return { allowed: true, state: { tokens: tokens - 1, last: now } };
}
