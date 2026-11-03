import * as THREE from 'three';

/**
 * Comic-Look: Toon-Material mit 3 harten Lichtstufen + optionaler Kontur
 * („inverted hull“: schwarze, leicht größere Rückseite – sehr billig).
 */
let gradientMap: THREE.DataTexture | null = null;

function getGradientMap(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 170, 255]);
  gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const materialCache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${map?.uuid ?? ''}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap(), ...(map ? { map } : {}) });
    materialCache.set(key, mat);
  }
  return mat;
}

const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x14122b, side: THREE.BackSide });

/** Hängt eine Kontur an ein Mesh (Kind-Objekt, bewegt sich mit). */
export function addOutline(mesh: THREE.Mesh, thickness = 0.06): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, outlineMaterial);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  mesh.geometry.boundingBox?.getSize(size);
  // Pro Achse skalieren, damit auch lange, dünne Teile eine gleich dicke Kontur bekommen.
  const axis = (s: number) => (s > 0.001 ? (s + 2 * thickness) / s : 1);
  outline.scale.set(axis(size.x), axis(size.y), axis(size.z));
  mesh.add(outline);
  return outline;
}

/** Holz-Textur für Kisten, per Canvas gezeichnet. */
export function crateTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  g.fillStyle = '#d98b3a';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#c47428';
  for (let y = 0; y < size; y += 32) g.fillRect(0, y + 28, size, 4);
  g.strokeStyle = '#7a3f12';
  g.lineWidth = 10;
  g.strokeRect(5, 5, size - 10, size - 10);
  g.beginPath();
  g.moveTo(10, 10);
  g.lineTo(size - 10, size - 10);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Himmelsverlauf als Hintergrund. */
export function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4c6fff');
  grad.addColorStop(0.55, '#8fb8ff');
  grad.addColorStop(1, '#ffd9a8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
