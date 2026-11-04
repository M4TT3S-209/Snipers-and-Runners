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

let vertexColorMat: THREE.MeshToonMaterial | null = null;

/** Toon-Material, das die Vertex-Farben der Geometrie benutzt (für verschmolzene Teile). */
export function toonVertex(): THREE.MeshToonMaterial {
  if (!vertexColorMat) vertexColorMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap() });
  return vertexColorMat;
}

export const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x14122b, side: THREE.BackSide });

/** Hängt eine Kontur an ein Mesh (Kind-Objekt, bewegt sich mit). */
export function addOutline(mesh: THREE.Mesh, thickness = 0.06): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, outlineMaterial);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  mesh.geometry.boundingBox?.getSize(size);
  mesh.geometry.boundingBox?.getCenter(center);
  // Pro Achse um die Mitte skalieren, damit auch lange, dünne Teile eine gleich dicke Kontur bekommen.
  const axis = (s: number) => (s > 0.001 ? (s + 2 * thickness) / s : 1);
  outline.scale.set(axis(size.x), axis(size.y), axis(size.z));
  outline.position.set(center.x * (1 - outline.scale.x), center.y * (1 - outline.scale.y), center.z * (1 - outline.scale.z));
  mesh.add(outline);
  return outline;
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  draw(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Holz-Textur für Kisten, per Canvas gezeichnet. */
export function crateTexture(base = '#d98b3a'): THREE.CanvasTexture {
  return canvasTexture(128, (g) => {
    const size = 128;
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < size; y += 32) g.fillRect(0, y + 28, size, 4);
    g.strokeStyle = 'rgba(60,25,5,0.85)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, size - 10, size - 10);
    g.beginPath();
    g.moveTo(10, 10);
    g.lineTo(size - 10, size - 10);
    g.stroke();
  });
}

/** Ziegel-Textur für Mauern. */
export function brickTexture(base = '#9aa5b1'): THREE.CanvasTexture {
  return canvasTexture(128, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 4;
    for (let row = 0; row < 4; row++) {
      const y = row * 32;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(128, y);
      g.stroke();
      const off = row % 2 === 0 ? 0 : 32;
      for (let x = off; x <= 128; x += 64) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 32);
        g.stroke();
      }
    }
  });
}

/** Ziellinie (Schachbrett). */
export function checkerTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(64, (g) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#1a1a2e';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Himmelsverlauf als Hintergrund. */
export function skyTexture(colors: [string, string, string] = ['#4c6fff', '#8fb8ff', '#ffd9a8']): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(0.55, colors[1]);
  grad.addColorStop(1, colors[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Runde, weiche Partikel-Textur. */
export function softDotTexture(): THREE.CanvasTexture {
  return canvasTexture(64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}
