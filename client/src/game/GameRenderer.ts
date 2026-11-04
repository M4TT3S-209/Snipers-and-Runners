import * as THREE from 'three';
import { CONFIG, sniperEye, type Track, type TurnEvent, type Vec3 } from '@scope-rush/shared';
import { Effects, toThree } from './effects';
import { createRunnerModel, type RunnerAnim, type RunnerModel } from './runnerModel';
import { createTowerModel, type TowerModel } from './towerModel';
import { buildTrack, type TrackView } from './trackBuilder';
import { RUNNER_PALETTES, THEME_STYLES } from './themes';
import { skyTexture } from './toon';
import type { GameView, RunnerView } from './view';

/**
 * Zeichnet das Spiel. Wird jeden Frame mit dem aktuellen Zustand gefüttert.
 */
export type CameraMode =
  | { kind: 'runner'; followId: string }
  | { kind: 'sniper'; dir: Vec3; zoom: number }
  | { kind: 'scopeOf'; sniperId: string }
  | { kind: 'orbit'; focus: 'start' | 'finish' | 'tower' };

export interface RenderStats {
  fps: number;
  pixelRatio: number;
  drawCalls: number;
}

interface RunnerEntry {
  model: RunnerModel;
  decoy: RunnerModel;
  shield: THREE.Mesh;
  lastSmoke: number;
  outFade: number;
}

const SHIELD_GEO = new THREE.SphereGeometry(1.05, 16, 12);

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(66, 1, 0.1, 600);
  readonly effects = new Effects();
  private trackView: TrackView | null = null;
  private trackKey = '';
  private track: Track | null = null;
  private tower: TowerModel | null = null;
  private readonly runners = new Map<string, RunnerEntry>();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private pixelRatio: number;
  private frames = 0;
  private fpsStart = performance.now();
  private lowFpsSeconds = 0;
  private stats: RenderStats = { fps: 0, pixelRatio: 1, drawCalls: 0 };
  private readonly camPos = new THREE.Vector3(0, 3, 6);
  private readonly camLook = new THREE.Vector3(0, 0, -20);
  private camInit = false;
  private time = 0;
  private readonly shieldMat = new THREE.MeshBasicMaterial({ color: 0x5ad7ff, transparent: true, opacity: 0.28, depthWrite: false });
  private readonly resizeObserver: ResizeObserver;
  private viewportH = 800;
  private fog: THREE.Fog | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.hemi = new THREE.HemisphereLight(0xdde8ff, 0x5a7d3a, 1.7);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sun.position.set(-20, 40, 15);
    this.scene.add(this.hemi, this.sun, this.effects.group);
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? document.body);
  }

  getStats(): RenderStats {
    return this.stats;
  }

  /** Strecke wechseln (nur wenn neu) */
  setTrack(track: Track): void {
    const key = `${track.seed}:${track.theme}`;
    if (key === this.trackKey) return;
    this.trackKey = key;
    this.track = track;
    if (this.trackView) {
      this.scene.remove(this.trackView.group);
      this.trackView.dispose();
    }
    if (this.tower) this.scene.remove(this.tower.root);
    const style = THEME_STYLES[track.theme];
    this.trackView = buildTrack(track, style);
    this.scene.add(this.trackView.group);
    this.tower = createTowerModel(CONFIG.track.towerHeightM);
    this.tower.root.position.set(0, 0, -track.towerZ);
    this.scene.add(this.tower.root);
    this.scene.background = skyTexture(style.sky);
    this.fog = new THREE.Fog(style.fog, 70, 260);
    this.scene.fog = this.fog;
    this.hemi.groundColor.set(style.ground);
    this.effects.clear();
    for (const r of this.runners.values()) this.disposeRunner(r);
    this.runners.clear();
    this.camInit = false;
  }

  /** Ein Frame. */
  frame(view: GameView, dt: number, cam: CameraMode): void {
    this.time += dt;
    this.setTrack(view.track);
    this.trackView?.update(view.turnTime, view.coverHp, view.coverDestroyed, dt);

    // Läufer
    const seen = new Set<string>();
    for (const r of view.runners) {
      seen.add(r.id);
      this.updateRunner(r, view, dt);
    }
    for (const [id, entry] of this.runners) {
      if (!seen.has(id)) {
        this.disposeRunner(entry);
        this.runners.delete(id);
      }
    }

    // Geschosse
    this.effects.syncProjectiles(view.projectiles, view.turnTime);

    // Glitzern am Turm (für Läufer-Ansicht)
    let glint = 0;
    if (cam.kind === 'runner' && this.track) {
      const me = view.runners.find((r) => r.id === cam.followId);
      const eye = sniperEye(this.track);
      for (const s of view.snipers) {
        if (s.zoom < CONFIG.scope.glintFromLevel || !me) continue;
        const to = new THREE.Vector3(me.x - eye.x, me.y + 1 - eye.y, me.z - eye.z).normalize();
        const dot = to.x * s.aim.x + to.y * s.aim.y + to.z * s.aim.z;
        const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
        const aligned = Math.max(0, 1 - angle / 8);
        glint = Math.max(glint, 0.35 + 0.65 * aligned);
      }
      glint *= 0.85 + Math.sin(this.time * 23) * 0.15;
    }
    this.tower?.setGlint(glint);

    this.updateCamera(view, cam, dt);
    this.effects.setViewport(this.viewportH * this.pixelRatio, this.camera.fov);
    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.measure();
  }

  /** Effekte zu Spielereignissen */
  onTurnEvent(ev: TurnEvent, view: GameView | null): void {
    const fx = this.effects;
    switch (ev.t) {
      case 'shot':
        if (this.track) fx.muzzle(toThree(sniperEye(this.track)));
        break;
      case 'impact': {
        const p = toThree(ev.point);
        if (ev.on === 'ground') fx.dust(p);
        else if (ev.on === 'decoy') fx.confetti(p, 30);
        else if (ev.on === 'runner') fx.sparkle(p, 0xfff1a0);
        break;
      }
      case 'cover': {
        const def = this.track?.covers.find((c) => c.id === ev.coverId);
        const style = this.track ? THEME_STYLES[this.track.theme] : null;
        const color = def && style ? (def.kind === 'crate' ? style.crate : def.kind === 'wall' ? style.wall : style.barrel) : 0xaaaaaa;
        fx.debris(toThree(ev.point), color, ev.hpLeft === 0 ? 26 : 10);
        if (ev.hpLeft === 0 && def) fx.dust(new THREE.Vector3(def.x, 0.4, -(def.z0 + def.z1) / 2), 0xbbbbbb);
        break;
      }
      case 'explosion':
        if (ev.kind === 'rocket') fx.explosion(toThree(ev.point), ev.radius);
        else fx.confetti(toThree(ev.point), 50);
        break;
      case 'hit': {
        const entry = this.runners.get(ev.runnerId);
        entry?.model.flash();
        const p = toThree(ev.point).add(new THREE.Vector3(0, 0.8, 0));
        if (ev.shielded) fx.label('BLOCK!', '#5ad7ff', p);
        else if (ev.part === 'head') fx.label('BONK!', '#ffd23f', p, 1.9);
        else fx.label('POW!', '#ff7a1a', p);
        break;
      }
      case 'out': {
        const r = view?.runners.find((x) => x.id === ev.runnerId);
        if (r) {
          const p = new THREE.Vector3(r.x, r.y + 1.2, -r.z);
          fx.confetti(p, 40);
          fx.label('RAUS!', '#ff5d8f', p.clone().add(new THREE.Vector3(0, 1, 0)), 2);
        }
        break;
      }
      case 'finish':
        if (this.track) fx.confetti(new THREE.Vector3(0, 3, -this.track.length), 80);
        break;
      case 'decoy':
        break;
      case 'move': {
        const r = view?.runners.find((x) => x.id === ev.runnerId);
        if (!r) break;
        const p = new THREE.Vector3(r.x, r.y + 0.1, -r.z);
        if (ev.ev === 'land' || ev.ev === 'jump') fx.dust(p, 0xe8dcc4);
        else if (ev.ev === 'trip') fx.label('Hoppla!', '#ffffff', p.clone().add(new THREE.Vector3(0, 2, 0)), 1.2);
        else if (ev.ev === 'pad') fx.sparkle(p, 0x39d0ff);
        else if (ev.ev === 'respawn') fx.sparkle(p.clone().add(new THREE.Vector3(0, 1, 0)), 0xffffff);
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    for (const r of this.runners.values()) this.disposeRunner(r);
    this.trackView?.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------

  private updateRunner(r: RunnerView, view: GameView, dt: number): void {
    let entry = this.runners.get(r.id);
    if (!entry) {
      const palette = RUNNER_PALETTES[r.colorIndex % RUNNER_PALETTES.length]!;
      const model = createRunnerModel(palette);
      const decoy = createRunnerModel(palette);
      const shield = new THREE.Mesh(SHIELD_GEO, this.shieldMat);
      model.root.add(shield);
      shield.position.y = 1;
      this.scene.add(model.root, decoy.root);
      entry = { model, decoy, shield, lastSmoke: 0, outFade: 1 };
      this.runners.set(r.id, entry);
    }
    const { model, decoy, shield } = entry;
    model.root.visible = !r.respawning;
    model.root.position.set(r.x, r.y, -r.z);
    let anim: RunnerAnim = r.pose;
    if (r.finished) anim = 'cheer';
    else if (r.blocked && r.pose === 'run') anim = 'blocked';
    if (view.phase === 'countdown' || view.phase === 'loadout') anim = 'idle';
    const speed = anim === 'run' ? r.speed : 0;
    model.animate(dt, anim, speed);

    // Ausgeschieden → langsam durchsichtig. In der Läufer-Sicht sind Mitläufer
    // (Klassik) halb durchsichtig, damit man die eigene Figur sofort erkennt.
    const ghostOther = view.myRole === 'runner' && r.id !== view.myId;
    const targetAlpha = r.out ? 0.3 : ghostOther ? 0.55 : 1;
    entry.outFade += (targetAlpha - entry.outFade) * Math.min(1, dt * 4);
    model.setOpacity(entry.outFade > 0.98 ? 1 : entry.outFade);

    shield.visible = r.shield;
    if (r.shield) shield.scale.setScalar(1 + Math.sin(this.time * 6) * 0.04);

    // Köder
    decoy.root.visible = r.decoyX !== null && !r.out;
    if (r.decoyX !== null) {
      decoy.root.position.set(r.decoyX, r.y, -r.z);
      decoy.animate(dt, anim, speed);
      decoy.setOpacity(r.id === view.myId ? 0.55 : 1);
    }

    // Rauch
    if (r.smoke && this.time - entry.lastSmoke > 0.03) {
      entry.lastSmoke = this.time;
      this.effects.smokePuff(new THREE.Vector3(r.x, r.y, -r.z), CONFIG.gadgets.smoke.radius);
    }
    if (r.sprint && Math.random() < 0.5) this.effects.trail(new THREE.Vector3(r.x, r.y + 0.6, -r.z + 0.4));
  }

  private disposeRunner(r: RunnerEntry): void {
    this.scene.remove(r.model.root, r.decoy.root);
    r.model.dispose();
    r.decoy.dispose();
  }

  private updateCamera(view: GameView, cam: CameraMode, dt: number): void {
    const track = view.track;
    const k = this.camInit ? 1 - Math.exp(-dt * 9) : 1;
    this.camInit = true;
    let targetFov = 66;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();

    if (cam.kind === 'runner') {
      const r = view.runners.find((x) => x.id === cam.followId) ?? view.runners[0];
      const rx = r ? r.x : 0;
      const ry = r ? Math.max(0, r.y) : 0;
      const rz = r ? r.z : 0;
      pos.set(rx * 0.65, ry * 0.5 + 2.5, -(rz - 5.6));
      look.set(rx * 0.35, ry * 0.4 - 1.0, -(rz + 12));
    } else if (cam.kind === 'sniper' || cam.kind === 'scopeOf') {
      let dir = cam.kind === 'sniper' ? cam.dir : undefined;
      let zoom = cam.kind === 'sniper' ? cam.zoom : 0;
      if (cam.kind === 'scopeOf') {
        const s = view.snipers.find((x) => x.id === cam.sniperId) ?? view.snipers[0];
        dir = s?.aim;
        zoom = s?.zoom ?? 0;
      }
      const eye = sniperEye(track);
      const d = dir ?? { x: 0, y: -0.25, z: -1 };
      pos.set(eye.x, eye.y, -eye.z);
      look.set(eye.x + d.x * 50, eye.y + d.y * 50, -(eye.z + d.z * 50));
      targetFov = CONFIG.scope.fovs[zoom] ?? 62;
      // Vom Turm (mit Optik) sieht man weiter: kaum Nebel
      if (this.fog) {
        this.fog.near = 180;
        this.fog.far = 700;
      }
      // Zielfernrohr: Kamera springt direkt (kein Nachziehen)
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.camera.fov = targetFov;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.camera.updateProjectionMatrix();
      return;
    } else {
      const zc = cam.focus === 'start' ? 6 : cam.focus === 'finish' ? track.length : track.towerZ;
      const a = this.time * 0.15;
      pos.set(Math.sin(a) * 16, cam.focus === 'tower' ? 14 : 6, -(zc + Math.cos(a) * 16));
      look.set(0, cam.focus === 'tower' ? 12 : 1.5, -zc);
    }

    if (this.fog) {
      this.fog.near = 70;
      this.fog.far = 260;
    }
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? document.body;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.viewportH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private measure(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.fpsStart < 1000) return;
    const fps = Math.round((this.frames * 1000) / (now - this.fpsStart));
    this.frames = 0;
    this.fpsStart = now;
    this.lowFpsSeconds = fps < CONFIG.render.lowFpsThreshold ? this.lowFpsSeconds + 1 : 0;
    if (this.lowFpsSeconds >= 3 && this.pixelRatio > CONFIG.render.lowPixelRatio) {
      this.pixelRatio = CONFIG.render.lowPixelRatio;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.lowFpsSeconds = 0;
    }
    this.stats = { fps, pixelRatio: this.pixelRatio, drawCalls: this.renderer.info.render.calls };
  }
}
