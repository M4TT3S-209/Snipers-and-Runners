import { CONFIG, type MatchEvent } from '@scope-rush/shared';
import { SfxPlayer } from '../audio/sfx';
import { unlockAudio } from '../audio/synth';
import { attachGestures } from '../input/gestures';
import type { Gesture } from '../input/gestureRecognizer';
import { SniperControls } from '../input/sniperControls';
import { requestWakeLock } from '../platform/wakeLock';
import { GameRenderer, type CameraMode, type RenderStats } from './GameRenderer';
import type { GameSession, GameView, MatchMeta, SessionEvent } from './view';

/**
 * Hält Renderer, Spielschleife, Kamera, Eingaben und Sounds zusammen.
 * Es gibt genau einen GameHost pro Seite (ein WebGL-Kontext).
 */
export interface HudSnapshot {
  view: GameView | null;
  meta: MatchMeta | null;
  stats: RenderStats;
  zoom: number;
  releaseZoom: number;
}

export class GameHost {
  readonly renderer: GameRenderer;
  readonly sniper = new SniperControls();
  private readonly sfx = new SfxPlayer();
  private session: GameSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private raf = 0;
  private last = 0;
  private hudListeners = new Set<(s: HudSnapshot) => void>();
  private eventListeners = new Set<(e: SessionEvent) => void>();
  private lastHud = 0;
  private lastView: GameView | null = null;
  private lastTrackKey = '';
  private lastRoleKey = '';
  private detachInput: (() => void) | null = null;
  private inputEl: HTMLElement | null = null;
  private inputRole = '';
  private lastAimSent = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new GameRenderer(canvas);
    this.sniper.onFire = () => this.fire();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setSession(session: GameSession | null): void {
    if (session === this.session) return;
    this.unsubscribe?.();
    this.session?.leave();
    this.session = session;
    this.lastView = null;
    this.lastRoleKey = '';
    this.renderer.effects.clear();
    this.unsubscribe = session ? session.onEvent((e) => this.onSessionEvent(e)) : null;
  }

  getSession(): GameSession | null {
    return this.session;
  }

  onHud(cb: (s: HudSnapshot) => void): () => void {
    this.hudListeners.add(cb);
    return () => this.hudListeners.delete(cb);
  }

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  /** Eingabefläche (Vollbild unter den Knöpfen) */
  setInputElement(el: HTMLElement | null): void {
    this.inputEl = el;
    this.inputRole = '';
  }

  fire(): void {
    if (!this.session || !this.lastView || this.lastView.myRole !== 'sniper') return;
    this.session.sniperFire(this.sniper.direction());
  }

  // ------------------------------------------------------------------

  private onSessionEvent(e: SessionEvent): void {
    if (e.t === 'turn') this.renderer.onTurnEvent(e.ev, this.lastView);
    if (e.t !== 'status' && e.t !== 'left') this.sfx.onMatchEvent(e as MatchEvent, this.lastView);
    for (const l of this.eventListeners) l(e);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const s = this.session;
    if (!s) return;
    s.update(now);
    const view = s.view();
    if (!view) return;
    this.lastView = view;

    // Neuer Zug / neue Rolle → Sniper-Blick auf die Strecke setzen
    const roleKey = `${view.track.seed}:${view.myRole}:${s.meta()?.plan.index ?? 0}`;
    if (roleKey !== this.lastRoleKey) {
      this.lastRoleKey = roleKey;
      if (view.myRole === 'sniper') {
        this.sniper.reset(view.track);
        const me = view.snipers.find((x) => x.id === view.myId);
        if (me) this.sniper.weapon = me.weapon;
      }
    }
    if (view.myRole === 'sniper') {
      const me = view.snipers.find((x) => x.id === view.myId);
      if (me) this.sniper.weapon = me.weapon;
    }
    this.syncInput(view);

    this.sniper.update(dt);
    if (view.myRole === 'sniper' && now - this.lastAimSent > 1000 / CONFIG.net.aimSendHz) {
      this.lastAimSent = now;
      s.sniperAim(this.sniper.direction(), this.sniper.zoom);
    }

    this.renderer.frame(view, dt, this.cameraFor(view));
    this.sfx.frame(view);

    const trackKey = `${view.track.seed}`;
    if (trackKey !== this.lastTrackKey) this.lastTrackKey = trackKey;

    if (now - this.lastHud > 90) {
      this.lastHud = now;
      const snap: HudSnapshot = {
        view,
        meta: s.meta(),
        stats: this.renderer.getStats(),
        zoom: this.sniper.zoom,
        releaseZoom: this.sniper.releaseZoom,
      };
      for (const l of this.hudListeners) l(snap);
    }
  }

  private cameraFor(view: GameView): CameraMode {
    const phase = view.phase;
    if (phase === 'roundResult' || phase === 'matchResult') return { kind: 'orbit', focus: 'finish' };
    if (view.myRole === 'sniper') return { kind: 'sniper', dir: this.sniper.direction(), zoom: this.sniper.zoom };
    if (view.myRole === 'runner') {
      const me = view.runners.find((r) => r.id === view.myId);
      if (me?.out && view.snipers[0] && phase === 'running') return { kind: 'scopeOf', sniperId: view.snipers[0].id };
      return { kind: 'runner', followId: view.myId };
    }
    // Zuschauer: dem vordersten aktiven Läufer folgen
    const active = view.runners.filter((r) => !r.out && !r.finished).sort((a, b) => b.z - a.z)[0] ?? view.runners[0];
    return { kind: 'runner', followId: active?.id ?? '' };
  }

  private syncInput(view: GameView): void {
    const el = this.inputEl;
    const role = el ? view.myRole : '';
    if (role === this.inputRole) return;
    this.inputRole = role;
    this.detachInput?.();
    this.detachInput = null;
    if (!el) return;
    const unlock = () => {
      unlockAudio();
      void requestWakeLock();
    };
    el.addEventListener('pointerup', unlock);
    let detachRole: () => void = () => {};
    if (role === 'runner') {
      detachRole = attachGestures(el, (g) => this.onGesture(g));
    } else if (role === 'sniper') {
      detachRole = this.sniper.attach(el);
    }
    this.detachInput = () => {
      el.removeEventListener('pointerup', unlock);
      detachRole();
    };
  }

  private onGesture(g: Gesture): void {
    const s = this.session;
    if (!s) return;
    switch (g) {
      case 'left':
        s.runnerAction('left');
        break;
      case 'right':
        s.runnerAction('right');
        break;
      case 'up':
        s.runnerAction('jump');
        break;
      case 'down':
        s.runnerAction('slide');
        break;
      case 'holdStart':
        s.runnerAction('duckOn');
        break;
      case 'holdEnd':
        s.runnerAction('duckOff');
        break;
      case 'tap':
        break;
    }
  }
}
