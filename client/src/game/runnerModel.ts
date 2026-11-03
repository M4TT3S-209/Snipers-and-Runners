import * as THREE from 'three';
import { addOutline, toon } from './toon';

/**
 * Comic-Läufer aus einfachen Formen (keine Modelldatei nötig).
 * Eigene Figur – große Augen, Mütze, bunte Kleidung.
 */
export interface RunnerModel {
  root: THREE.Group;
  /** Laufanimation; `phase` in Sekunden, `speed` 0 … 1 */
  animate(time: number, speed: number): void;
}

export interface RunnerColors {
  shirt: THREE.ColorRepresentation;
  pants: THREE.ColorRepresentation;
  cap: THREE.ColorRepresentation;
  skin: THREE.ColorRepresentation;
}

const DEFAULT_COLORS: RunnerColors = { shirt: 0xff7a1a, pants: 0x3046c8, cap: 0xffd23f, skin: 0xffc9a1 };

export function createRunnerModel(colors: RunnerColors = DEFAULT_COLORS): RunnerModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.95;
  root.add(body);

  const part = (geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, outline = true) => {
    const mesh = new THREE.Mesh(geo, toon(color));
    if (outline) addOutline(mesh, 0.035);
    return mesh;
  };

  // Rumpf
  const torso = part(new THREE.CapsuleGeometry(0.26, 0.38, 3, 8), colors.shirt);
  torso.position.y = 0.22;
  body.add(torso);

  // Kopf
  const head = new THREE.Group();
  head.position.y = 0.78;
  body.add(head);
  head.add(part(new THREE.IcosahedronGeometry(0.27, 1), colors.skin));
  const eyeWhite = new THREE.SphereGeometry(0.075, 10, 8);
  const pupil = new THREE.SphereGeometry(0.035, 8, 6);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeWhite, toon(0xffffff));
    eye.position.set(side * 0.1, 0.03, -0.22);
    const p = new THREE.Mesh(pupil, toon(0x1a1a2e));
    p.position.set(0, 0, -0.055);
    eye.add(p);
    head.add(eye);
  }
  const cap = part(new THREE.SphereGeometry(0.285, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), colors.cap);
  cap.position.y = 0.05;
  head.add(cap);
  const brim = part(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 10, 1, false, 0, Math.PI), colors.cap);
  brim.rotation.y = Math.PI / 2;
  brim.position.set(0, 0.06, -0.2);
  head.add(brim);

  // Arme und Beine an Gelenken (Group = Drehpunkt)
  const limb = (len: number, radius: number, color: THREE.ColorRepresentation) => {
    const pivot = new THREE.Group();
    const mesh = part(new THREE.CapsuleGeometry(radius, len, 2, 6), color);
    mesh.position.y = -len / 2 - radius * 0.5;
    pivot.add(mesh);
    return pivot;
  };
  const arms = [-1, 1].map((side) => {
    const arm = limb(0.34, 0.08, colors.shirt);
    arm.position.set(side * 0.34, 0.42, 0);
    body.add(arm);
    return arm;
  });
  const legs = [-1, 1].map((side) => {
    const leg = limb(0.42, 0.1, colors.pants);
    leg.position.set(side * 0.13, -0.1, 0);
    const shoe = part(new THREE.BoxGeometry(0.16, 0.1, 0.26), 0xffffff);
    shoe.position.set(0, -0.68, -0.05);
    leg.add(shoe);
    body.add(leg);
    return leg;
  });

  // Blob-Schatten (billiger als echte Schatten)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  root.add(shadow);

  return {
    root,
    animate(time, speed) {
      const f = time * 11;
      const swing = Math.sin(f) * 0.9 * speed;
      legs[0]!.rotation.x = swing;
      legs[1]!.rotation.x = -swing;
      arms[0]!.rotation.x = -swing * 0.9;
      arms[1]!.rotation.x = swing * 0.9;
      body.position.y = 0.95 + Math.abs(Math.sin(f)) * 0.08 * speed;
      body.rotation.x = -0.12 * speed;
      head.rotation.z = Math.sin(f * 0.5) * 0.05;
    },
  };
}
