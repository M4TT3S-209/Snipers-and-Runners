import { render } from 'preact';
import './styles.css';
import { T } from './i18n/de';
import { installTouchGuards } from './platform/touchGuards';
import { registerServiceWorker } from './platform/serviceWorker';
import { startUpdateChecks } from './platform/updateCheck';
import { GameHost } from './game/GameHost';
import { App } from './app/App';
import { getSettings } from './app/settings';
import { setIgnoreSilentSwitch, setVolume } from './audio/synth';

installTouchGuards();
registerServiceWorker();
startUpdateChecks();

const settings = getSettings();
setVolume(settings.volume);
if (settings.ignoreSilentSwitch) setIgnoreSilentSwitch(true);

// Hochformat-Hinweis (per CSS nur im Querformat auf Touch-Geräten sichtbar)
const rotate = document.createElement('div');
rotate.className = 'rotate-overlay';
rotate.innerHTML = `<div class="rotate-icon">📱</div><h2>${T.rotate.title}</h2><p>${T.rotate.text}</p>`;
document.body.appendChild(rotate);

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const host = new GameHost(canvas);
host.start();

const debug = new URLSearchParams(location.search).has('debug');
const ui = document.getElementById('ui');
if (ui) render(<App host={host} debug={debug} />, ui);
