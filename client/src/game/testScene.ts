import * as THREE from 'three';
import { CONFIG } from '@scope-rush/shared';
import { createRunnerModel } from './runnerModel';
import { createTowerModel } from './towerModel';
import { addOutline, crateTexture, skyTexture, toon } from './toon';

/**
 * M0-Testszene: Läufer auf der Strecke, Hindernisse ziehen vorbei, hinten der
 * Sniper-Turm mit Glitzern. Die Kamera schwenkt langsam hin und her.
 * Misst FPS und senkt bei Bedarf die Auflösung.
 */
export interface SceneStats {
  fps: number;
  pixelRatio: number;
  drawCalls: number;
}

export interface TestScene {
  dispose(): void;
}

const TRACK_LENGTH = 140;
const TOWER_Z = -125;
const SCROLL_SPEED = 7; // m/s – Gefühl für das Lauftempo
const CAMERA_PITCH_TAN = Math.tan((21 * Math.PI) / 180); // Neigung nach unten

export function startTestScene(canvas: HTMLCanvasElement, onStats: (s: SceneStats) => void): TestScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xcfe0ff, 60, 170);

  const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 400);

  // Licht
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x5a7d3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-20, 40, 15);
  scene.add(sun);

  // Boden + Strecke
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(0x6cc04a));
  grass.rotation.x = -Math.PI / 2;
  grass.position.z = -100;
  scene.add(grass);

  const { lanes, laneWidth } = CONFIG.track;
  const trackWidth = lanes * laneWidth;
  const track = new THREE.Mesh(new THREE.BoxGeometry(trackWidth + 0.6, 0.3, TRACK_LENGTH), toon(0xf4a259));
  track.position.set(0, 0.0, 10 - TRACK_LENGTH / 2);
  scene.add(track);
  const lineGeo = new THREE.BoxGeometry(0.12, 0.02, TRACK_LENGTH);
  for (let i = 1; i < lanes; i++) {
    const line = new THREE.Mesh(lineGeo, toon(0xffffff));
    line.position.set(-trackWidth / 2 + i * laneWidth, 0.16, track.position.z);
    scene.add(line);
  }
  const curbGeo = new THREE.BoxGeometry(0.4, 0.5, TRACK_LENGTH);
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(curbGeo, toon(0xffffff));
    curb.position.set(side * (trackWidth / 2 + 0.3), 0.1, track.position.z);
    scene.add(curb);
  }

  // Turm
  const tower = createTowerModel(CONFIG.track.towerHeightM);
  tower.root.position.set(0, 0, TOWER_Z);
  scene.add(tower.root);

  // Läufer
  const runner = createRunnerModel();
  runner.root.position.set(0, 0.15, 0);
  scene.add(runner.root);

  // Hindernisse (laufen auf den Läufer zu, „Laufband“)
  const obstacles = new THREE.Group();
  scene.add(obstacles);
  const crateGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  const crateMat = toon(0xffffff, crateTexture());
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.3, 10);
  const hurdleBar = new THREE.BoxGeometry(laneWidth * 0.9, 0.18, 0.18);
  const hurdlePost = new THREE.BoxGeometry(0.14, 0.9, 0.14);
  const wallGeo = new THREE.BoxGeometry(laneWidth * 0.95, 1.8, 0.6);
  const laneX = (lane: number) => -trackWidth / 2 + laneWidth * (lane + 0.5);
  const kinds = ['crate', 'barrel', 'hurdle', 'wall', 'crate', 'hurdle'] as const;
  const spacing = 11;
  for (let i = 0; i < 10; i++) {
    const kind = kinds[i % kinds.length]!;
    const lane = (i * 7) % lanes;
    const obj = new THREE.Group();
    if (kind === 'crate') {
      const m = new THREE.Mesh(crateGeo, crateMat);
      m.position.y = 0.85;
      addOutline(m, 0.05);
      obj.add(m);
    } else if (kind === 'barrel') {
      const m = new THREE.Mesh(barrelGeo, toon(0xe63946));
      m.position.y = 0.8;
      addOutline(m, 0.05);
      obj.add(m);
    } else if (kind === 'hurdle') {
      const bar = new THREE.Mesh(hurdleBar, toon(0xffffff));
      bar.position.y = 0.85;
      addOutline(bar, 0.04);
      obj.add(bar);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(hurdlePost, toon(0x3046c8));
        post.position.set((s * laneWidth * 0.9) / 2, 0.55, 0);
        obj.add(post);
      }
    } else {
      const m = new THREE.Mesh(wallGeo, toon(0x9aa5b1));
      m.position.y = 1.05;
      addOutline(m, 0.05);
      obj.add(m);
    }
    obj.position.set(laneX(lane), 0, -14 - i * spacing);
    obstacles.add(obj);
  }
  const wrapLength = 10 * spacing;

  // Wolken
  const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 7; i++) {
    const cloud = new THREE.Mesh(cloudGeo, toon(0xffffff));
    cloud.position.set(-60 + i * 20, 35 + (i % 3) * 6, -160 - (i % 2) * 20);
    cloud.scale.set(7 + (i % 3) * 2, 3, 4);
    scene.add(cloud);
  }

  // Größe an Container anpassen
  const resize = () => {
    const parent = canvas.parentElement ?? document.body;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement ?? document.body);

  // Animationsschleife
  const clock = new THREE.Clock();
  let frames = 0;
  let fpsWindowStart = performance.now();
  let lowFpsSeconds = 0;
  let raf = 0;
  const lookTarget = new THREE.Vector3();

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    runner.animate(t, 1);

    for (const obj of obstacles.children) {
      obj.position.z += SCROLL_SPEED * dt;
      if (obj.position.z > 8) obj.position.z -= wrapLength;
    }

    // Glitzern alle ~3 s
    const g = (t % 3.2) / 3.2;
    tower.setGlint(g > 0.8 ? Math.sin(((g - 0.8) / 0.2) * Math.PI) : 0);

    // Kamera hinter dem Läufer, schwenkt langsam um ihn herum. Leicht nach
    // unten geneigt, damit Läufer und Turm über dem Bedienbereich liegen.
    const angle = Math.sin(t * 0.3) * 0.3;
    camera.position.set(Math.sin(angle) * 5.8, 2.6, Math.cos(angle) * 5.8);
    // Blick die Strecke hinauf (Richtung Turm), nur leicht mitdrehen
    lookTarget.set(-Math.sin(angle) * 6, 2.6 - 20 * CAMERA_PITCH_TAN, -20);
    camera.lookAt(lookTarget);

    renderer.render(scene, camera);

    // FPS messen, bei Bedarf Auflösung senken
    frames++;
    const now = performance.now();
    if (now - fpsWindowStart >= 1000) {
      const fps = Math.round((frames * 1000) / (now - fpsWindowStart));
      frames = 0;
      fpsWindowStart = now;
      lowFpsSeconds = fps < CONFIG.render.lowFpsThreshold ? lowFpsSeconds + 1 : 0;
      if (lowFpsSeconds >= 3 && pixelRatio > CONFIG.render.lowPixelRatio) {
        pixelRatio = CONFIG.render.lowPixelRatio;
        renderer.setPixelRatio(pixelRatio);
        resize();
        lowFpsSeconds = 0;
      }
      onStats({ fps, pixelRatio, drawCalls: renderer.info.render.calls });
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
    },
  };
}
