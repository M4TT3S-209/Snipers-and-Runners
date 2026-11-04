import { CONFIG, sniperEye, type Track, type Vec3, type WeaponId } from '@scope-rush/shared';
import { getSettings } from '../app/settings';

/**
 * Sniper-Zielen per Touch:
 *  - Ziehen = zielen (Empfindlichkeit wird beim Zoomen feiner)
 *  - Zoom-Stufen 0–3, im Zielfernrohr leichtes Wackeln
 *  - Feuer-Modus „button“: Feuer-Button | „release“: halten, ziehen, loslassen = Schuss
 *  - optional Gyroskop
 */
const DEG = Math.PI / 180;

export class SniperControls {
  yaw = 0;
  pitch = -8 * DEG;
  zoom = 0;
  /** Zoomstufe, die im „release“-Modus beim Aufsetzen genutzt wird */
  releaseZoom = 2;
  weapon: WeaponId = 'precision';
  onFire: (() => void) | null = null;
  onZoomChange: ((zoom: number) => void) | null = null;

  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private time = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private gyroLast: { alpha: number; beta: number } | null = null;
  private readonly onOrientation = (e: DeviceOrientationEvent) => this.handleOrientation(e);

  /** Zu Beginn eines Zugs: Blick auf die Strecke richten */
  reset(track: Track): void {
    const eye = sniperEye(track);
    const targetZ = track.length * 0.45;
    this.yaw = 0;
    this.pitch = Math.atan2(1 - eye.y, eye.z - targetZ);
    this.setZoom(0);
    this.gyroLast = null;
  }

  attach(el: HTMLElement): () => void {
    const down = (e: PointerEvent) => {
      if (this.pointerId !== null) return;
      if ((e.target as Element).closest('button')) return;
      this.pointerId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
      if (getSettings().fireMode === 'release' && this.zoom === 0) this.setZoom(this.releaseZoom);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.drag(dx, dy);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      if (getSettings().fireMode === 'release') {
        this.onFire?.();
        setTimeout(() => {
          if (this.pointerId === null) this.setZoom(0);
        }, 280);
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    if (getSettings().gyro) window.addEventListener('deviceorientation', this.onOrientation);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('deviceorientation', this.onOrientation);
    };
  }

  drag(dx: number, dy: number): void {
    const fov = CONFIG.scope.fovs[this.zoom] ?? 62;
    const k = CONFIG.scope.dragDegPerPx * (fov / (CONFIG.scope.fovs[0] ?? 62)) * getSettings().sensitivity * DEG;
    // Finger nach rechts → Blick nach rechts (in der Simulation Richtung −x)
    this.yaw -= dx * k;
    this.pitch -= dy * k;
    this.clamp();
  }

  cycleZoom(): void {
    const levels = CONFIG.scope.fovs.length;
    if (getSettings().fireMode === 'release') {
      this.releaseZoom = (this.releaseZoom % (levels - 1)) + 1;
      this.onZoomChange?.(this.releaseZoom);
      return;
    }
    this.setZoom((this.zoom + 1) % levels);
  }

  setZoom(z: number): void {
    this.zoom = z;
    this.onZoomChange?.(z);
  }

  /** Jeden Frame: Wackeln berechnen. */
  update(dt: number): void {
    this.time += dt;
    const amp = (CONFIG.scope.swayDeg[this.zoom] ?? 0) * CONFIG.weapons[this.weapon].sway * DEG;
    const f = CONFIG.scope.swayHz * Math.PI * 2;
    const t = this.time;
    this.swayYaw = amp * (Math.sin(t * f) * 0.6 + Math.sin(t * f * 2.3 + 1.7) * 0.4);
    this.swayPitch = amp * (Math.sin(t * f * 1.3 + 0.5) * 0.6 + Math.sin(t * f * 3.1 + 2.1) * 0.4);
  }

  /** Aktuelle Blickrichtung inkl. Wackeln (das ist auch die Schussrichtung). */
  direction(): Vec3 {
    const yaw = this.yaw + this.swayYaw;
    const pitch = this.pitch + this.swayPitch;
    return { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }

  private clamp(): void {
    const maxYaw = CONFIG.scope.maxYawDeg * DEG;
    this.yaw = Math.max(-maxYaw, Math.min(maxYaw, this.yaw));
    this.pitch = Math.max(CONFIG.scope.minPitchDeg * DEG, Math.min(CONFIG.scope.maxPitchDeg * DEG, this.pitch));
  }

  private handleOrientation(e: DeviceOrientationEvent): void {
    if (e.alpha === null || e.beta === null) return;
    const cur = { alpha: e.alpha, beta: e.beta };
    if (!this.gyroLast) {
      this.gyroLast = cur;
      return;
    }
    let da = cur.alpha - this.gyroLast.alpha;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    const db = cur.beta - this.gyroLast.beta;
    this.gyroLast = cur;
    // Handy nach links drehen → Blick nach links (Simulation +x)
    this.yaw += da * DEG;
    this.pitch += db * DEG;
    this.clamp();
  }
}

/** Gyroskop-Berechtigung (iOS: nur nach Tippen) */
export async function requestGyroPermission(): Promise<boolean> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
  if (typeof D.requestPermission !== 'function') return 'DeviceOrientationEvent' in window;
  try {
    return (await D.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
