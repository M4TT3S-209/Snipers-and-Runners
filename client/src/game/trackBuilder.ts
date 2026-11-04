import * as THREE from 'three';
import { CONFIG, Rng, laneX, sinkerPhase, type CoverDef, type SinkerDef, type Track } from '@scope-rush/shared';
import { at, colored, merge } from './meshUtil';
import type { ThemeStyle } from './themes';
import { addOutline, brickTexture, checkerTexture, crateTexture, outlineMaterial, toon, toonVertex } from './toon';

/**
 * Baut die 3D-Szene einer Strecke aus den Streckendaten.
 * Three-Koordinaten: x gleich, y gleich, z = −z der Simulation.
 */

export interface CoverView {
  group: THREE.Group;
  def: CoverDef;
  shake: number;
  lastHp: number;
}

export interface TrackView {
  group: THREE.Group;
  covers: CoverView[];
  update(turnTick: number, coverHp: readonly number[], destroyed: readonly boolean[], dt: number): void;
  dispose(): void;
}

const LW = CONFIG.track.laneWidth;
const TRACK_HW = (CONFIG.track.lanes * LW) / 2;

interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  matrix: THREE.Matrix4;
}

/** Viele Teile → ein Mesh + passende Kontur (jedes Teil um seine eigene Mitte vergrößert). */
function outlinedMerge(parts: Part[], thickness: number): THREE.Group {
  const group = new THREE.Group();
  if (parts.length === 0) return group;
  const body = merge(parts.map((p) => colored(p.geo, p.color, p.matrix)));
  body.computeVertexNormals();
  group.add(new THREE.Mesh(body, toonVertex()));
  if (thickness > 0) {
    const outlines = parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.computeBoundingBox();
      const size = new THREE.Vector3();
      g.boundingBox?.getSize(size);
      const s = (v: number) => (v > 0.001 ? (v + 2 * thickness) / v : 1);
      g.scale(s(size.x), s(size.y), s(size.z));
      g.applyMatrix4(p.matrix);
      if (g.getAttribute('uv')) g.deleteAttribute('uv');
      if (g.getAttribute('normal')) g.deleteAttribute('normal');
      return g;
    });
    group.add(new THREE.Mesh(merge(outlines), outlineMaterial));
  }
  for (const p of parts) p.geo.dispose();
  return group;
}

/** Bereiche [a, b] einer Spur ohne Löcher */
function solidIntervals(track: Track, lane: number, from: number, to: number): Array<[number, number]> {
  const holes = track.holes.filter((h) => h.lane === lane).sort((a, b) => a.z0 - b.z0);
  const out: Array<[number, number]> = [];
  let cur = from;
  for (const h of holes) {
    if (h.z0 > cur) out.push([cur, h.z0]);
    cur = Math.max(cur, h.z1);
  }
  if (cur < to) out.push([cur, to]);
  return out;
}

function intersectIntervals(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a0, a1] of a) for (const [b0, b1] of b) {
    const s = Math.max(a0, b0);
    const e = Math.min(a1, b1);
    if (e > s) out.push([s, e]);
  }
  return out;
}

export function buildTrack(track: Track, style: ThemeStyle): TrackView {
  const group = new THREE.Group();
  const startZ = -14;
  const endZ = track.towerZ + 6;
  const rng = new Rng(track.seed ^ 0x9e3779b9);
  const textures: THREE.Texture[] = [];

  // ---------- Boden und Strecke
  const surface: THREE.BufferGeometry[] = [];
  const segBounds = track.segments.map((s) => s.z0);
  const segColorAt = (z: number) => {
    let idx = 0;
    for (let i = 0; i < segBounds.length; i++) if (z >= segBounds[i]!) idx = i;
    return idx % 2 === 0 ? style.track : style.trackAlt;
  };
  for (let lane = 0; lane < CONFIG.track.lanes; lane++) {
    for (const [a, b] of solidIntervals(track, lane, startZ, endZ)) {
      // an Segmentgrenzen teilen, damit die Farben wechseln
      const cuts = [a, ...segBounds.filter((z) => z > a && z < b), b];
      for (let i = 0; i < cuts.length - 1; i++) {
        const z0 = cuts[i]!;
        const z1 = cuts[i + 1]!;
        surface.push(colored(new THREE.BoxGeometry(LW, 0.3, z1 - z0), segColorAt(z0 + 0.01), at(laneX(lane), -0.15, -(z0 + z1) / 2)));
      }
    }
  }
  // Randsteine
  for (const side of [-1, 1]) {
    surface.push(colored(new THREE.BoxGeometry(0.4, 0.5, endZ - startZ), style.curb, at(side * (TRACK_HW + 0.2), 0.0, -(startZ + endZ) / 2)));
  }
  // Gruben unter den Löchern
  for (const h of track.holes) {
    surface.push(colored(new THREE.BoxGeometry(LW, 0.2, h.z1 - h.z0), style.pit, at(laneX(h.lane), -3, -(h.z0 + h.z1) / 2)));
  }
  // Spurlinien (nur wo beide Nachbarspuren Boden haben)
  for (let b = 1; b < CONFIG.track.lanes; b++) {
    const both = intersectIntervals(solidIntervals(track, b - 1, startZ, endZ), solidIntervals(track, b, startZ, endZ));
    for (const [z0, z1] of both) {
      surface.push(colored(new THREE.BoxGeometry(0.1, 0.02, z1 - z0), style.line, at(-TRACK_HW + b * LW, 0.006, -(z0 + z1) / 2)));
    }
  }
  // Startlinie
  surface.push(colored(new THREE.BoxGeometry(TRACK_HW * 2, 0.02, 0.4), 0xffffff, at(0, 0.008, -0.2)));
  const surfaceGeo = merge(surface);
  surfaceGeo.computeVertexNormals();
  group.add(new THREE.Mesh(surfaceGeo, toonVertex()));

  // Gras/Gelände links und rechts
  const groundMat = toon(style.ground);
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(300, endZ - startZ + 400), groundMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(side * (TRACK_HW + 0.4 + 150), -0.05, -(startZ + endZ) / 2);
    group.add(g);
  }
  for (const z of [startZ - 100, endZ + 100]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_HW * 2 + 1, 200), groundMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, -0.05, -z);
    group.add(g);
  }

  // ---------- Ziel
  const checker = checkerTexture();
  textures.push(checker);
  checker.repeat.set(6, 1);
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_HW * 2, 1.2), toon(0xffffff, checker));
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(0, 0.012, -track.length);
  group.add(finish);
  const archParts: Part[] = [];
  for (const side of [-1, 1]) {
    archParts.push({ geo: new THREE.BoxGeometry(0.35, 4.2, 0.35), color: 0xffffff, matrix: at(side * (TRACK_HW + 0.6), 2.1, -track.length) });
  }
  group.add(outlinedMerge(archParts, 0.06));
  const bannerTex = checkerTexture();
  textures.push(bannerTex);
  bannerTex.repeat.set(10, 1);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(TRACK_HW * 2 + 1.6, 0.7, 0.15), toon(0xffffff, bannerTex));
  banner.position.set(0, 4.2, -track.length);
  addOutline(banner, 0.05);
  group.add(banner);

  // ---------- Hürden, Balken, Sprungpads
  const tripParts: Part[] = [];
  for (const t of track.trips) {
    const zc = -(t.z0 + t.z1) / 2;
    if (t.kind === 'hurdle') {
      tripParts.push({ geo: new THREE.BoxGeometry(t.hw * 2, 0.14, 0.12), color: 0xffffff, matrix: at(t.x, t.y1 - 0.07, zc) });
      for (const s of [-1, 1]) tripParts.push({ geo: new THREE.BoxGeometry(0.12, t.y1, 0.12), color: style.hurdle, matrix: at(t.x + s * t.hw, t.y1 / 2, zc) });
    } else {
      const midY = (t.y0 + t.y1) / 2;
      tripParts.push({ geo: new THREE.BoxGeometry(t.hw * 2, t.y1 - t.y0, 0.3), color: 0xffd23f, matrix: at(t.x, midY, zc) });
      tripParts.push({ geo: new THREE.BoxGeometry(t.hw * 0.5, (t.y1 - t.y0) * 1.02, 0.32), color: 0x1a1a2e, matrix: at(t.x - t.hw * 0.4, midY, zc) });
      tripParts.push({ geo: new THREE.BoxGeometry(t.hw * 0.5, (t.y1 - t.y0) * 1.02, 0.32), color: 0x1a1a2e, matrix: at(t.x + t.hw * 0.5, midY, zc) });
      for (const s of [-1, 1]) tripParts.push({ geo: new THREE.BoxGeometry(0.14, t.y1, 0.14), color: 0xffffff, matrix: at(t.x + s * t.hw, t.y1 / 2, zc) });
    }
  }
  group.add(outlinedMerge(tripParts, 0.035));

  const padParts: Part[] = [];
  for (const p of track.pads) {
    const zc = -(p.z0 + p.z1) / 2;
    padParts.push({ geo: new THREE.BoxGeometry(LW * 0.9, 0.12, p.z1 - p.z0), color: style.pad, matrix: at(laneX(p.lane), 0.06, zc) });
    for (let k = 0; k < 2; k++) {
      padParts.push({ geo: new THREE.BoxGeometry(0.9, 0.05, 0.22), color: 0xffffff, matrix: at(laneX(p.lane) - 0.3, 0.14, zc + 0.35 - k * 0.7, 0, -0.6, 0) });
      padParts.push({ geo: new THREE.BoxGeometry(0.9, 0.05, 0.22), color: 0xffffff, matrix: at(laneX(p.lane) + 0.3, 0.14, zc + 0.35 - k * 0.7, 0, 0.6, 0) });
    }
  }
  group.add(outlinedMerge(padParts, 0.03));

  // ---------- Versinkende Plattformen
  const sinkers: Array<{ mesh: THREE.Group; def: SinkerDef }> = [];
  for (const s of track.sinkers) {
    const mesh = outlinedMerge(
      [
        { geo: new THREE.BoxGeometry(LW * 0.94, 0.3, s.z1 - s.z0), color: style.sinker, matrix: at(0, -0.15, 0) },
        { geo: new THREE.BoxGeometry(LW * 0.5, 0.02, (s.z1 - s.z0) * 0.8), color: 0xffffff, matrix: at(0, 0.005, 0) },
      ],
      0.04,
    );
    mesh.position.set(laneX(s.lane), 0, -(s.z0 + s.z1) / 2);
    group.add(mesh);
    sinkers.push({ mesh, def: s });
  }

  // ---------- Deckung
  const crateTex = crateTexture('#' + new THREE.Color(style.crate).getHexString());
  const brickTex = brickTexture('#' + new THREE.Color(style.wall).getHexString());
  textures.push(crateTex, brickTex);
  const covers: CoverView[] = track.covers.map((c) => {
    const g = new THREE.Group();
    const w = c.hw * 2;
    const d = c.z1 - c.z0;
    let mesh: THREE.Mesh;
    if (c.kind === 'crate') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, c.h, d), toon(0xffffff, crateTex));
    } else if (c.kind === 'wall') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, c.h, d), toon(0xffffff, brickTex));
    } else {
      const geo = merge([
        colored(new THREE.CylinderGeometry(w / 2, w / 2, c.h, 12), style.barrel),
        colored(new THREE.CylinderGeometry(w / 2 + 0.02, w / 2 + 0.02, 0.12, 12), 0xffffff, at(0, c.h * 0.18, 0)),
        colored(new THREE.CylinderGeometry(w / 2 + 0.02, w / 2 + 0.02, 0.12, 12), 0xffffff, at(0, -c.h * 0.18, 0)),
      ]);
      geo.computeVertexNormals();
      mesh = new THREE.Mesh(geo, toonVertex());
    }
    addOutline(mesh, 0.05);
    g.add(mesh);
    g.position.set(c.x, c.h / 2, -(c.z0 + c.z1) / 2);
    group.add(g);
    return { group: g, def: c, shake: 0, lastHp: c.hp };
  });

  // ---------- Deko am Rand (instanziert)
  const deco = buildDeco(style, rng, startZ, endZ);
  for (const d of deco) group.add(d);

  return {
    group,
    covers,
    update(turnTick, coverHp, destroyed, dt) {
      for (const s of sinkers) {
        const p = sinkerPhase(s.def, Math.floor(turnTick));
        const blend = 12;
        let y = 0;
        let wobble = 0;
        if (p >= s.def.upTicks) {
          const since = p - s.def.upTicks;
          const until = s.def.periodTicks - p;
          y = -2.5 * Math.min(1, since / blend, until / blend);
        } else if (s.def.upTicks - p < 25) {
          wobble = Math.sin(turnTick * 2.2) * 0.04;
        }
        s.mesh.position.y = y;
        s.mesh.rotation.z = wobble;
      }
      covers.forEach((cv, i) => {
        const dead = destroyed[i] ?? false;
        cv.group.visible = !dead;
        if (dead) return;
        const hp = coverHp[i] ?? cv.def.hp;
        if (hp < cv.lastHp) cv.shake = 0.25;
        cv.lastHp = hp;
        if (cv.shake > 0) {
          cv.shake -= dt;
          cv.group.rotation.z = Math.sin(cv.shake * 60) * 0.06 * (cv.shake / 0.25);
        } else {
          cv.group.rotation.z = 0;
        }
        // beschädigt → etwas schief und kleiner
        const damage = 1 - hp / cv.def.hp;
        cv.group.scale.setScalar(1 - damage * 0.12);
        cv.group.rotation.y = damage * 0.08;
      });
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      for (const t of textures) t.dispose();
    },
  };
}

function buildDeco(style: ThemeStyle, rng: Rng, startZ: number, endZ: number): THREE.Object3D[] {
  const positions: Array<{ x: number; z: number; s: number; c: number }> = [];
  for (let z = startZ - 30; z < endZ + 40; z += 5 + rng.next() * 4) {
    for (const side of [-1, 1]) {
      if (rng.next() < 0.35) continue;
      positions.push({
        x: side * (TRACK_HW + 3 + rng.next() * 22),
        z,
        s: 0.8 + rng.next() * 0.8,
        c: style.decoColors[rng.int(0, style.decoColors.length - 1)]!,
      });
    }
  }
  const out: THREE.Object3D[] = [];
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, place: (p: (typeof positions)[number], m: THREE.Matrix4) => void, colorOf?: (p: (typeof positions)[number]) => number) => {
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    positions.forEach((p, i) => {
      place(p, m);
      mesh.setMatrixAt(i, m);
      if (colorOf) mesh.setColorAt(i, c.set(colorOf(p)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    out.push(mesh);
  };
  const white = toon(0xffffff);

  switch (style.deco) {
    case 'tree':
      instanced(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), toon(0x8a5a2b), (p, m) => m.copy(at(p.x, p.s, -p.z, 0, 0, 0, p.s, p.s, p.s)));
      instanced(new THREE.IcosahedronGeometry(1.6, 0), white, (p, m) => m.copy(at(p.x, 2.8 * p.s, -p.z, 0, p.z, 0, p.s, p.s * 1.1, p.s)), (p) => p.c);
      break;
    case 'cactus':
      instanced(new THREE.CapsuleGeometry(0.4, 2.4, 2, 6), white, (p, m) => m.copy(at(p.x, 1.6 * p.s, -p.z, 0, 0, 0, p.s, p.s, p.s)), (p) => p.c);
      instanced(new THREE.CapsuleGeometry(0.25, 0.9, 2, 6), white, (p, m) => m.copy(at(p.x + 0.6 * p.s, 2 * p.s, -p.z, 0, 0, -0.8, p.s, p.s, p.s)), (p) => p.c);
      break;
    case 'iceberg':
      instanced(new THREE.IcosahedronGeometry(2, 0), white, (p, m) => m.copy(at(p.x, 0.6 * p.s, -p.z, p.z, p.x, 0, p.s * 1.4, p.s * 1.8, p.s * 1.2)), (p) => p.c);
      break;
    case 'pillar': {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      instanced(new THREE.BoxGeometry(1, 1, 1), toon(0x241a44), (p, m) => m.copy(at(p.x, 4 * p.s, -p.z, 0, 0, 0, 1.6, 8 * p.s, 1.6)));
      instanced(new THREE.BoxGeometry(1.7, 0.25, 1.7), mat, (p, m) => m.copy(at(p.x, 8 * p.s + 0.1, -p.z, 0, 0, 0, 1, 1, 1)), (p) => p.c);
      break;
    }
    case 'lollipop':
      instanced(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), white, (p, m) => m.copy(at(p.x, 1.5 * p.s, -p.z, 0, 0, 0, p.s, p.s, p.s)));
      instanced(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 14), white, (p, m) => m.copy(at(p.x, 3.2 * p.s, -p.z, Math.PI / 2, 0, 0, p.s, p.s, p.s)), (p) => p.c);
      break;
  }
  return out;
}
