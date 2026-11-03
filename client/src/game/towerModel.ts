import * as THREE from 'three';
import { addOutline, toon } from './toon';

/** Sniper-Turm (Low-Poly) mit Glitzer-Punkt am Fenster. */
export interface TowerModel {
  root: THREE.Group;
  /** Stärke des Zielfernrohr-Glitzerns 0 … 1 */
  setGlint(strength: number): void;
}

export function createTowerModel(height = 18): TowerModel {
  const root = new THREE.Group();
  const wood = 0x8a5a2b;
  const roof = 0xe63946;

  // Vier schräge Beine
  const legGeo = new THREE.BoxGeometry(0.6, height, 0.6);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, toon(wood));
    leg.position.set(x * 2.4, height / 2, z * 2.4);
    leg.rotation.z = -x * 0.06;
    leg.rotation.x = z * 0.06;
    addOutline(leg, 0.12);
    root.add(leg);
  }
  // Querstreben
  const braceGeo = new THREE.BoxGeometry(5.2, 0.35, 0.35);
  for (let i = 1; i <= 3; i++) {
    for (const z of [-1, 1]) {
      const brace = new THREE.Mesh(braceGeo, toon(0x6b4220));
      brace.position.set(0, (height / 4) * i, z * 2.35);
      root.add(brace);
    }
  }

  // Plattform + Hütte
  const platform = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 7), toon(0xa0692f));
  platform.position.y = height;
  addOutline(platform, 0.15);
  root.add(platform);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 5), toon(0xf1e3c6));
  cabin.position.y = height + 1.8;
  addOutline(cabin, 0.15);
  root.add(cabin);

  const window_ = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.1), toon(0x22264f));
  window_.position.set(0, height + 2.1, 2.52);
  root.add(window_);

  const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.6, 4), toon(roof));
  roofMesh.position.y = height + 4.6;
  roofMesh.rotation.y = Math.PI / 4;
  addOutline(roofMesh, 0.15);
  root.add(roofMesh);

  // Fahne
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2), toon(0xdddddd));
  pole.position.set(0, height + 7, 0);
  root.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), toon(0xffd23f));
  (flag.material as THREE.Material).side = THREE.DoubleSide;
  flag.position.set(0.7, height + 7.6, 0);
  root.add(flag);

  // Glitzern: additives Sprite vor dem Fenster
  const glintTex = makeGlintTexture();
  const glint = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glintTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }),
  );
  glint.position.set(0.6, height + 2.1, 2.8);
  glint.scale.setScalar(0.001);
  root.add(glint);

  return {
    root,
    setGlint(strength) {
      const s = Math.max(0, Math.min(1, strength));
      glint.scale.setScalar(0.001 + s * 9);
      glint.material.opacity = s;
      glint.material.rotation = s * 0.6;
    },
  };
}

function makeGlintTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  const c = size / 2;
  const radial = g.createRadialGradient(c, c, 0, c, c, c);
  radial.addColorStop(0, 'rgba(255,255,255,1)');
  radial.addColorStop(0.15, 'rgba(255,250,200,0.9)');
  radial.addColorStop(0.4, 'rgba(255,230,120,0.25)');
  radial.addColorStop(1, 'rgba(255,230,120,0)');
  g.fillStyle = radial;
  g.fillRect(0, 0, size, size);
  // Strahlen
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.moveTo(c, 0);
  g.lineTo(c + 4, c);
  g.lineTo(c, size);
  g.lineTo(c - 4, c);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(0, c);
  g.lineTo(c, c - 4);
  g.lineTo(size, c);
  g.lineTo(c, c + 4);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
