import { render } from 'preact';
import './styles.css';
import { T } from './i18n/de';
import { installTouchGuards } from './platform/touchGuards';
import { registerServiceWorker } from './platform/serviceWorker';
import { startUpdateChecks } from './platform/updateCheck';
import { startTestScene, type SceneStats } from './game/testScene';
import { TestPage } from './app/TestPage';

installTouchGuards();
registerServiceWorker();
startUpdateChecks();

// Hochformat-Hinweis (per CSS nur im Querformat auf Touch-Geräten sichtbar)
const rotate = document.createElement('div');
rotate.className = 'rotate-overlay';
rotate.innerHTML = `<div class="rotate-icon">📱</div><h2>${T.rotate.title}</h2><p>${T.rotate.text}</p>`;
document.body.appendChild(rotate);

// 3D-Szene
const statsListeners = new Set<(s: SceneStats) => void>();
const canvas = document.getElementById('scene') as HTMLCanvasElement;
startTestScene(canvas, (s) => {
  for (const l of statsListeners) l(s);
});

const subscribeStats = (cb: (s: SceneStats) => void) => {
  statsListeners.add(cb);
  return () => {
    statsListeners.delete(cb);
  };
};

const ui = document.getElementById('ui');
if (ui) render(<TestPage subscribeStats={subscribeStats} />, ui);
