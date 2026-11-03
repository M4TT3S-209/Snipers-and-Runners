import { CONFIG } from '@scope-rush/shared';

/**
 * Erkennt Läufer-Gesten aus Fingerbewegungen – ohne DOM, damit es testbar ist.
 *
 *  Wischen links/rechts → Spur wechseln
 *  Wischen hoch         → springen
 *  Wischen runter       → rutschen
 *  Finger halten        → ducken (holdStart … holdEnd)
 *  Kurzer Tipp          → tap
 *
 * Pro Berührung gibt es höchstens einen Wisch. Ein Halten endet mit holdEnd.
 */
export type Gesture = 'left' | 'right' | 'up' | 'down' | 'holdStart' | 'holdEnd' | 'tap';

export interface GestureThresholds {
  swipeMinPx: number;
  swipeMaxMs: number;
  holdMs: number;
  holdMaxMovePx: number;
}

const TAP_MAX_MS = 250;

export class GestureRecognizer {
  private active = false;
  private startX = 0;
  private startY = 0;
  private startT = 0;
  private swiped = false;
  private holding = false;
  private moved = false;

  constructor(private readonly th: GestureThresholds = CONFIG.input) {}

  down(x: number, y: number, t: number): void {
    this.active = true;
    this.startX = x;
    this.startY = y;
    this.startT = t;
    this.swiped = false;
    this.holding = false;
    this.moved = false;
  }

  move(x: number, y: number, t: number): Gesture | null {
    if (!this.active || this.swiped || this.holding) return null;
    const dx = x - this.startX;
    const dy = y - this.startY;
    const dist = Math.hypot(dx, dy);
    if (dist > this.th.holdMaxMovePx) this.moved = true;
    if (dist >= this.th.swipeMinPx && t - this.startT <= this.th.swipeMaxMs) {
      this.swiped = true;
      return directionOf(dx, dy);
    }
    return null;
  }

  /** Regelmäßig aufrufen (z. B. pro Frame), damit „halten“ erkannt wird. */
  tick(t: number): Gesture | null {
    if (!this.active || this.swiped || this.holding || this.moved) return null;
    if (t - this.startT >= this.th.holdMs) {
      this.holding = true;
      return 'holdStart';
    }
    return null;
  }

  up(x: number, y: number, t: number): Gesture | null {
    if (!this.active) return null;
    this.active = false;
    if (this.holding) return 'holdEnd';
    if (this.swiped) return null;
    // Schneller Wisch, bei dem kein move-Event kam (kommt auf iOS vor)
    const dx = x - this.startX;
    const dy = y - this.startY;
    const dt = t - this.startT;
    if (Math.hypot(dx, dy) >= this.th.swipeMinPx && dt <= this.th.swipeMaxMs) return directionOf(dx, dy);
    if (!this.moved && dt <= TAP_MAX_MS) return 'tap';
    return null;
  }

  cancel(): Gesture | null {
    const wasHolding = this.active && this.holding;
    this.active = false;
    return wasHolding ? 'holdEnd' : null;
  }

  get isHolding(): boolean {
    return this.active && this.holding;
  }
}

function directionOf(dx: number, dy: number): Gesture {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
