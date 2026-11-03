/**
 * Deterministische Wellen- und Hilfsfunktionen.
 *
 * Math.sin/cos sind nicht auf allen JavaScript-Engines bitgenau gleich.
 * Für die Simulation (Server + Client-Vorhersage) nutzen wir deshalb nur
 * Grundrechenarten. Für reine Grafik darf Math.sin weiter benutzt werden.
 */

/** Dreieckswelle: t=0 → 0, t=0.25 → 1, t=0.5 → 0, t=0.75 → -1, Periode 1. */
export function triangleWave(t: number): number {
  const p = t - Math.floor(t); // 0 … <1
  if (p < 0.25) return p * 4;
  if (p < 0.75) return 2 - p * 4;
  return p * 4 - 4;
}

/**
 * Weiche, sinusähnliche Welle (Periode 1, Werte -1 … 1) aus einem
 * Polynom (Bhaskara-ähnliche Näherung). Für bewegliche Plattformen.
 */
export function smoothWave(t: number): number {
  const p = t - Math.floor(t);
  // Halbwelle als Parabel: 0…0.5 positiv, 0.5…1 negativ
  if (p < 0.5) {
    const x = p * 2; // 0 … 1
    return 4 * x * (1 - x);
  }
  const x = (p - 0.5) * 2;
  return -4 * x * (1 - x);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
