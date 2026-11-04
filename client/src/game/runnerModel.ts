import * as THREE from 'three';
import type { RunnerPose } from '@scope-rush/shared';
import { at, colored, merge } from './meshUtil';
import { addOutline, outlineMaterial, toonVertex } from './toon';

/**
 * Comic-Läufer aus einfachen Formen (keine Modelldatei nötig).
 * Teile sind pro Gelenk zu je einem Mesh verschmolzen → ~12 Draw-Calls pro Figur.
 */
export interface RunnerColors {
  shirt: number;
  pants: number;
  cap: number;
  skin?: number;
}

export type RunnerAnim = RunnerPose | 'cheer' | 'blocked' | 'dance' | 'spin' | 'flex';

export interface RunnerModel {
  root: THREE.Group;
  animate(dt: number, anim: RunnerAnim, speed: number): void;
  flash(): void;
  setOpacity(alpha: number): void;
  dispose(): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function partGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = build();
    g.computeVertexNormals();
    geoCache.set(key, g);
  }
  return g;
}

export function createRunnerModel(colors: RunnerColors): RunnerModel {
  const skin = colors.skin ?? 0xffc9a1;
  const ck = `${colors.shirt}-${colors.pants}-${colors.cap}-${skin}`;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const material = toonVertex();
  const meshes: THREE.Mesh[] = [];

  const addPart = (parent: THREE.Object3D, geo: THREE.BufferGeometry, outline = 0.035) => {
    const mesh = new THREE.Mesh(geo, material);
    if (outline > 0) addOutline(mesh, outline);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // Rumpf
  const torso = new THREE.Group();
  torso.position.y = 0.82;
  body.add(torso);
  addPart(
    torso,
    partGeo(`torso-${ck}`, () =>
      merge([
        colored(new THREE.CapsuleGeometry(0.26, 0.38, 3, 8), colors.shirt, at(0, 0.22, 0)),
        colored(new THREE.CylinderGeometry(0.27, 0.27, 0.1, 10), colors.pants, at(0, -0.06, 0)),
      ]),
    ),
  );

  // Kopf (mit Gesicht und Mütze in einem Mesh)
  const head = new THREE.Group();
  head.position.y = 0.78;
  torso.add(head);
  addPart(
    head,
    partGeo(`head-${ck}`, () =>
      merge([
        colored(new THREE.IcosahedronGeometry(0.27, 1), skin),
        colored(new THREE.SphereGeometry(0.075, 8, 6), 0xffffff, at(-0.1, 0.03, -0.215)),
        colored(new THREE.SphereGeometry(0.075, 8, 6), 0xffffff, at(0.1, 0.03, -0.215)),
        colored(new THREE.SphereGeometry(0.036, 6, 4), 0x1a1a2e, at(-0.1, 0.03, -0.28)),
        colored(new THREE.SphereGeometry(0.036, 6, 4), 0x1a1a2e, at(0.1, 0.03, -0.28)),
        colored(new THREE.SphereGeometry(0.285, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), colors.cap, at(0, 0.05, 0)),
        colored(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 10, 1, false, 0, Math.PI), colors.cap, at(0, 0.06, -0.2, 0, Math.PI / 2, 0)),
      ]),
    ),
  );

  // Gliedmaßen an Gelenken
  const limb = (key: string, len: number, radius: number, color: number, end: THREE.BufferGeometry) => {
    const pivot = new THREE.Group();
    addPart(
      pivot,
      partGeo(`${key}-${ck}`, () => merge([colored(new THREE.CapsuleGeometry(radius, len, 2, 6), color, at(0, -len / 2 - radius * 0.5, 0)), end])),
    );
    return pivot;
  };
  const arms = [-1, 1].map((side) => {
    const arm = limb('arm', 0.32, 0.08, colors.shirt, colored(new THREE.SphereGeometry(0.09, 6, 5), skin, at(0, -0.5, 0)));
    arm.position.set(side * 0.34, 0.42, 0);
    torso.add(arm);
    return arm;
  });
  const legs = [-1, 1].map((side) => {
    const leg = limb('leg', 0.4, 0.1, colors.pants, colored(new THREE.BoxGeometry(0.17, 0.11, 0.27), 0xffffff, at(0, -0.66, -0.05)));
    leg.position.set(side * 0.13, -0.08, 0);
    torso.add(leg);
    return leg;
  });

  // Blob-Schatten
  const shadow = new THREE.Mesh(
    partGeo('shadow', () => new THREE.CircleGeometry(0.45, 14)),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  let phase = 0;
  let flashT = 0;
  let ghost: THREE.MeshToonMaterial | null = null;
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const smooth = (obj: THREE.Object3D, key: 'x' | 'y' | 'z', target: number, k: number) => {
    obj.rotation[key] += (target - obj.rotation[key]) * k;
  };

  return {
    root,
    animate(dt, anim, speed) {
      phase += dt * 11 * Math.max(0.2, speed);
      const k = Math.min(1, dt * 14);
      let legSwing = 0;
      let armSwing = 0;
      let torsoY = 0.82;
      let torsoRx = 0;
      let torsoRz = 0;
      let armRaise = 0;
      let legBend = 0;
      let bob = 0;

      switch (anim) {
        case 'run':
          legSwing = Math.sin(phase) * 0.95 * speed;
          armSwing = -legSwing * 0.9;
          torsoRx = -0.14 * speed;
          bob = Math.abs(Math.sin(phase)) * 0.08 * speed;
          break;
        case 'jump':
          legBend = 0.9;
          armRaise = -2.4;
          torsoRx = -0.1;
          break;
        case 'slide':
          torsoY = 0.38;
          torsoRx = 1.15;
          legBend = -1.3;
          armRaise = -0.6;
          break;
        case 'duck':
          torsoY = 0.48;
          torsoRx = -0.5;
          legBend = 1.2;
          armRaise = -2.6;
          break;
        case 'fall':
          armRaise = -2.8 + Math.sin(phase * 2) * 0.4;
          legSwing = Math.sin(phase * 2) * 0.6;
          torsoRz = Math.sin(phase) * 0.3;
          break;
        case 'cheer':
          armRaise = -2.8 + Math.sin(phase * 1.5) * 0.3;
          bob = Math.abs(Math.sin(phase * 0.8)) * 0.35;
          legBend = 0.2;
          break;
        case 'blocked':
          armSwing = 0.3;
          torsoRx = -0.25;
          break;
        case 'dance':
          torsoRz = Math.sin(phase * 0.7) * 0.28;
          armRaise = -1.6;
          armSwing = Math.sin(phase * 1.4) * 0.9;
          legSwing = Math.sin(phase * 0.7) * 0.35;
          bob = Math.abs(Math.sin(phase * 0.7)) * 0.12;
          break;
        case 'spin':
          armRaise = -1.4;
          bob = 0.05;
          break;
        case 'flex':
          armRaise = -2.3;
          torsoRx = 0.12;
          bob = Math.abs(Math.sin(phase * 0.5)) * 0.06;
          break;
        default:
          bob = Math.sin(phase * 0.3) * 0.02;
          break;
      }

      torso.position.y += (torsoY + bob - torso.position.y) * k;
      smooth(torso, 'x', torsoRx, k);
      smooth(torso, 'z', torsoRz, k);
      smooth(legs[0]!, 'x', legSwing + legBend, k);
      smooth(legs[1]!, 'x', -legSwing + legBend, k);
      smooth(arms[0]!, 'x', armSwing + armRaise, k);
      smooth(arms[1]!, 'x', -armSwing + armRaise, k);
      const armOut = anim === 'spin' ? 1.3 : anim === 'flex' ? 0.9 : armRaise !== 0 ? 0.25 : 0;
      smooth(arms[0]!, 'z', -armOut, k);
      smooth(arms[1]!, 'z', armOut, k);
      // Drehen-Emote: der ganze Körper dreht sich
      if (anim === 'spin') body.rotation.y += dt * 9;
      else body.rotation.y += (0 - body.rotation.y) * k;
      head.rotation.z = Math.sin(phase * 0.5) * 0.05;

      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) for (const m of meshes) m.material = ghost ?? material;
      }
    },
    flash() {
      flashT = 0.09;
      for (const m of meshes) m.material = flashMat;
    },
    setOpacity(alpha) {
      if (alpha >= 1) {
        ghost = null;
        for (const m of meshes) m.material = material;
        for (const m of meshes) for (const c of m.children) (c as THREE.Mesh).visible = true;
        shadow.visible = true;
        return;
      }
      if (!ghost) {
        ghost = material.clone();
        ghost.transparent = true;
      }
      ghost.opacity = alpha;
      for (const m of meshes) {
        m.material = ghost;
        for (const c of m.children) (c as THREE.Mesh).visible = alpha > 0.6;
      }
      shadow.visible = alpha > 0.6;
    },
    dispose() {
      flashMat.dispose();
      ghost?.dispose();
      // Geometrien sind geteilt (Cache) und werden nicht freigegeben.
      void outlineMaterial;
    },
  };
}
