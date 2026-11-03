/**
 * Künstliche Netzverzögerung für lokale Tests: ?lag=150&jitter=40&spike=5
 *  lag    – feste Verzögerung pro Richtung (ms)
 *  jitter – zufällige Schwankung ± (ms)
 *  spike  – Prozent der Nachrichten mit zusätzlicher Verzögerung (200 ms),
 *           so wie bei echtem Paketverlust über TCP
 *
 * WebSockets liefern Nachrichten immer in Reihenfolge – der Simulator auch.
 */
export interface LagSettings {
  lag: number;
  jitter: number;
  spikePercent: number;
}

export function parseLagSettings(search: string): LagSettings | null {
  const p = new URLSearchParams(search);
  const lag = Number(p.get('lag') ?? 0);
  const jitter = Number(p.get('jitter') ?? 0);
  const spikePercent = Number(p.get('spike') ?? 0);
  if (!(lag > 0 || jitter > 0 || spikePercent > 0)) return null;
  return {
    lag: Math.max(0, lag || 0),
    jitter: Math.max(0, jitter || 0),
    spikePercent: Math.min(100, Math.max(0, spikePercent || 0)),
  };
}

const SPIKE_MS = 200;

export class LagQueue {
  private lastDelivery = 0;

  constructor(
    private readonly settings: LagSettings,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
      setTimeout(fn, ms);
    },
  ) {}

  /** Wann (absolut) würde die nächste Nachricht ankommen? */
  nextDeliveryTime(): number {
    const { lag, jitter, spikePercent } = this.settings;
    let delay = lag + (this.random() * 2 - 1) * jitter;
    if (this.random() * 100 < spikePercent) delay += SPIKE_MS;
    const target = Math.max(this.now() + Math.max(0, delay), this.lastDelivery);
    this.lastDelivery = target;
    return target;
  }

  push(fn: () => void): void {
    const at = this.nextDeliveryTime();
    this.schedule(fn, Math.max(0, at - this.now()));
  }
}
