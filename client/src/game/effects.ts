import * as THREE from 'three';
import { projectilePosAt, type ProjectileInfo, type Vec3 } from '@scope-rush/shared';
import { simToThree } from './meshUtil';
import { softDotTexture, toon } from './toon';

/**
 * Effekte: Partikel (ein Draw-Call), Kugeln/Raketen, Mündungsfeuer,
 * Comic-Schriftzüge („POW!“). Alles in Three-Koordinaten.
 */

const MAX_PARTICLES = 700;

interface Particle {
  life: number;
  maxLife: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  gravity: number;
  drag: number;
}

const VERT = /* glsl */ `
attribute float size;
attribute vec4 pcolor;
uniform float scale;
varying vec4 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec4 vColor;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vColor.a;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

export class Effects {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 4);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly material: THREE.ShaderMaterial;
  private readonly bullets = new Map<number, THREE.Object3D>();
  private readonly bulletGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5);
  private readonly bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0 });
  private readonly rocketGeo = new THREE.ConeGeometry(0.2, 0.9, 7);
  private readonly rocketMat = toon(0xe63946);
  private readonly flash: THREE.Sprite;
  private flashT = 0;
  private readonly labels: Array<{ sprite: THREE.Sprite; t: number }> = [];
  private readonly labelTextures = new Map<string, THREE.CanvasTexture>();
  private readonly tmp = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.colors, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { map: { value: softDotTexture() }, scale: { value: 400 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xfff1a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.flash.visible = false;
    this.group.add(this.flash);
  }

  /** Für die richtige Partikelgröße bei Zoom (Bildschirmhöhe in Pixeln, Sichtfeld) */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.scale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  // ------------------------------------------------------------ Partikel

  private spawn(p: Partial<Particle> & { px: number; py: number; pz: number }): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      life: 0,
      maxLife: 0.6,
      vx: 0,
      vy: 0,
      vz: 0,
      size0: 0.4,
      size1: 0.1,
      r: 1,
      g: 1,
      b: 1,
      alpha: 1,
      gravity: 0,
      drag: 1,
      ...p,
    });
  }

  burst(pos: THREE.Vector3, color: number, count: number, speed: number, opts: Partial<Particle> = {}): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn({
        px: pos.x,
        py: pos.y,
        pz: pos.z,
        vx: Math.cos(th) * Math.sin(ph) * s,
        vy: Math.abs(Math.cos(ph)) * s * 0.8 + speed * 0.2,
        vz: Math.sin(th) * Math.sin(ph) * s,
        r: c.r,
        g: c.g,
        b: c.b,
        ...opts,
      });
    }
  }

  dust(pos: THREE.Vector3, color = 0xd9c9a8): void {
    this.burst(pos, color, 10, 2.5, { maxLife: 0.7, size0: 0.5, size1: 1.0, alpha: 0.7, gravity: -1, drag: 0.92 });
  }

  debris(pos: THREE.Vector3, color: number, count = 14): void {
    this.burst(pos, color, count, 6, { maxLife: 0.9, size0: 0.35, size1: 0.2, gravity: 14, drag: 0.98 });
  }

  confetti(pos: THREE.Vector3, count = 40): void {
    const palette = [0xff5d8f, 0x5dd3ff, 0xffd23f, 0x80ed99, 0x9b5de5, 0xff7a1a];
    for (let i = 0; i < count; i++) {
      this.burst(pos, palette[i % palette.length]!, 1, 7, { maxLife: 1.6, size0: 0.3, size1: 0.25, gravity: 5, drag: 0.94 });
    }
  }

  explosion(pos: THREE.Vector3, radius: number): void {
    this.burst(pos, 0xfff1a0, 18, radius * 2.5, { maxLife: 0.35, size0: radius * 0.9, size1: radius * 1.4, drag: 0.85 });
    this.burst(pos, 0xff7a1a, 22, radius * 2, { maxLife: 0.6, size0: radius * 0.7, size1: radius * 1.2, drag: 0.88 });
    this.burst(pos, 0x777777, 14, radius * 1.2, { maxLife: 1.4, size0: radius * 0.8, size1: radius * 1.8, alpha: 0.7, gravity: -2, drag: 0.93 });
  }

  /** Dichte Rauchwolke (Gadget) – blockiert die Sicht wirklich. */
  smokePuff(pos: THREE.Vector3, radius: number): void {
    for (let i = 0; i < 2; i++) {
      this.spawn({
        px: pos.x + (Math.random() - 0.5) * radius * 1.5,
        py: pos.y + Math.random() * radius * 0.9,
        pz: pos.z + (Math.random() - 0.5) * radius * 1.5,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 0.3 + Math.random() * 0.4,
        vz: (Math.random() - 0.5) * 0.6,
        maxLife: 1.6,
        size0: radius * 1.1,
        size1: radius * 1.8,
        r: 0.82,
        g: 0.84,
        b: 0.9,
        alpha: 0.92,
        drag: 0.97,
      });
    }
  }

  trail(pos: THREE.Vector3): void {
    this.spawn({ px: pos.x, py: pos.y, pz: pos.z, maxLife: 0.8, size0: 0.4, size1: 1.1, r: 0.75, g: 0.75, b: 0.78, alpha: 0.6, gravity: -0.5 });
  }

  sparkle(pos: THREE.Vector3, color: number): void {
    this.burst(pos, color, 6, 1.5, { maxLife: 0.5, size0: 0.25, size1: 0.05, drag: 0.9 });
  }

  // ------------------------------------------------------------ Mündungsfeuer & Schrift

  muzzle(posThree: THREE.Vector3): void {
    this.flash.position.copy(posThree);
    this.flash.scale.setScalar(3.5);
    this.flash.visible = true;
    this.flashT = 0.08;
  }

  label(text: string, color: string, posThree: THREE.Vector3, size = 1.6): void {
    let tex = this.labelTextures.get(text + color);
    if (!tex) {
      tex = makeLabelTexture(text, color);
      this.labelTextures.set(text + color, tex);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.position.copy(posThree);
    sprite.scale.set(size * 2, size, 1);
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.labels.push({ sprite, t: 0 });
  }

  // ------------------------------------------------------------ Geschosse

  syncProjectiles(projectiles: readonly ProjectileInfo[], turnTime: number): void {
    const alive = new Set<number>();
    for (const p of projectiles) {
      alive.add(p.id);
      let obj = this.bullets.get(p.id);
      if (!obj) {
        obj = p.weapon === 'rocket' ? new THREE.Mesh(this.rocketGeo, this.rocketMat) : new THREE.Mesh(this.bulletGeo, this.bulletMat);
        this.bullets.set(p.id, obj);
        this.group.add(obj);
      }
      if (turnTime < p.spawnTime) {
        obj.visible = false;
        continue;
      }
      obj.visible = true;
      const pos = projectilePosAt(p, turnTime);
      simToThree(pos.x, pos.y, pos.z, obj.position);
      const v = p.vel;
      this.tmp.set(v.x, v.y, -v.z).normalize();
      obj.quaternion.setFromUnitVectors(this.up, this.tmp);
      if (p.weapon === 'rocket' && Math.random() < 0.7) this.trail(obj.position);
    }
    for (const [id, obj] of this.bullets) {
      if (!alive.has(id)) {
        this.group.remove(obj);
        this.bullets.delete(id);
      }
    }
  }

  // ------------------------------------------------------------ Update

  update(dt: number): void {
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
    }
    for (const p of this.particles) {
      const k = p.life / p.maxLife;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy = p.vy * d - p.gravity * dt;
      p.vz *= d;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      this.positions[n * 3] = p.px;
      this.positions[n * 3 + 1] = p.py;
      this.positions[n * 3 + 2] = p.pz;
      this.colors[n * 4] = p.r;
      this.colors[n * 4 + 1] = p.g;
      this.colors[n * 4 + 2] = p.b;
      this.colors[n * 4 + 3] = p.alpha * (1 - k * k);
      this.sizes[n] = p.size0 + (p.size1 - p.size0) * k;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('pcolor') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i]!;
      l.t += dt;
      l.sprite.position.y += dt * 1.2;
      const s = l.t < 0.12 ? l.t / 0.12 : 1;
      l.sprite.material.opacity = l.t > 0.7 ? Math.max(0, 1 - (l.t - 0.7) / 0.3) : 1;
      l.sprite.scale.set(l.sprite.scale.y * 2, l.sprite.scale.y, 1);
      if (s < 1) l.sprite.scale.multiplyScalar(0.6 + s * 0.4);
      if (l.t > 1) {
        this.group.remove(l.sprite);
        l.sprite.material.dispose();
        this.labels.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.particles.length = 0;
    for (const obj of this.bullets.values()) this.group.remove(obj);
    this.bullets.clear();
  }
}

function makeLabelTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.font = '900 64px ui-rounded, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = '#14122b';
  g.strokeText(text, 128, 64);
  g.fillStyle = color;
  g.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function toThree(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, -v.z);
}
