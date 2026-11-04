import { useEffect, useRef, useState } from 'preact/hooks';
import { T } from '../i18n/de';
import type { RenderStats as SceneStats } from '../game/GameRenderer';
import { attachGestures } from '../input/gestures';
import type { Gesture } from '../input/gestureRecognizer';
import { audioSessionSupported, playBeep, playGlint, playShot, setIgnoreSilentSwitch, unlockAudio } from '../audio/synth';
import { onWakeLockChange, requestWakeLock, wakeLockSupported } from '../platform/wakeLock';
import { onUpdateAvailable, reloadForUpdate } from '../platform/updateCheck';
import { isStandalone } from '../platform/device';
import { useServerTest } from './useServerTest';
import { HomeScreenGuide } from './HomeScreenGuide';
import { SafeAreaOverlay } from './SafeAreaOverlay';

const GESTURE_TEXT: Record<Gesture, string> = {
  left: T.gestures.left,
  right: T.gestures.right,
  up: T.gestures.up,
  down: T.gestures.down,
  holdStart: T.gestures.holdStart,
  holdEnd: T.gestures.holdEnd,
  tap: T.gestures.tap,
};

export function TestPage({ subscribeStats, onBack }: { subscribeStats: (cb: (s: SceneStats) => void) => () => void; onBack: () => void }) {
  const standalone = isStandalone();
  const server = useServerTest();
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [gesture, setGesture] = useState<{ g: Gesture; n: number } | null>(null);
  const [wakeActive, setWakeActive] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [loudMode, setLoudMode] = useState(false);
  const [update, setUpdate] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeStats(setStats), [subscribeStats]);
  useEffect(() => onWakeLockChange(setWakeActive), []);
  useEffect(() => onUpdateAvailable(() => setUpdate(true)), []);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    let n = 0;
    return attachGestures(pad, (g) => {
      n++;
      setGesture({ g, n });
      if (g === 'holdStart') playBeep(440, 0.12);
      else if (g !== 'holdEnd') playBeep(g === 'up' ? 990 : 660, 0.06);
    });
  }, []);

  // Erster Tipp irgendwo: Ton freischalten + Bildschirm wach halten.
  useEffect(() => {
    const onFirstTouch = () => {
      unlockAudio();
      void requestWakeLock();
    };
    window.addEventListener('pointerup', onFirstTouch);
    window.addEventListener('touchend', onFirstTouch);
    return () => {
      window.removeEventListener('pointerup', onFirstTouch);
      window.removeEventListener('touchend', onFirstTouch);
    };
  }, []);

  const toggleLoud = () => {
    const next = !loudMode;
    setLoudMode(next);
    setIgnoreSilentSwitch(next);
  };

  const testSound = () => {
    unlockAudio();
    playShot();
    setTimeout(playGlint, 350);
  };

  return (
    <>
      <header class="top-bar">
        <div class="brand">
          <span class="logo">{T.appName}</span>
          <span class="badge">
            {T.testPage.title} {T.testPage.milestone}
          </span>
        </div>
        <div class="stats">
          <span>
            {T.testPage.fps} <b>{stats?.fps ?? '–'}</b>
          </span>
          <span>
            {T.testPage.pixelRatio} <b>{stats ? `${stats.pixelRatio}×` : '–'}</b>
          </span>
          <span>
            {T.testPage.build} <b>{__BUILD_ID__.slice(0, 7)}</b>
          </span>
        </div>
      </header>

      <section class="sheet">
        {update && (
          <div class="update-banner">
            <span>{T.update.available}</span>
            <button class="btn primary small" onClick={() => void reloadForUpdate()}>
              {T.update.reload}
            </button>
          </div>
        )}

        <div ref={padRef} class="gesture-pad" data-allow-touch>
          {gesture ? (
            <span key={gesture.n} class="gesture-pop">
              {GESTURE_TEXT[gesture.g]}
            </span>
          ) : (
            <span class="muted">{T.gestures.hint}</span>
          )}
        </div>

        <div class="tile server-tile">
          <span class="tile-label">{T.server.label}</span>
          <ServerStatus {...server} />
          {server.configured && (
            <button class="btn small icon" onClick={server.reconnect} aria-label={T.server.reconnect}>
              ↻
            </button>
          )}
        </div>

        <div class="tile-grid">
          <button class="btn" onClick={testSound}>
            🔊 {T.sound.test}
          </button>
          {audioSessionSupported() ? (
            <button class={`btn ${loudMode ? 'on' : ''}`} onClick={toggleLoud} aria-pressed={loudMode}>
              {loudMode ? '🔔' : '🔕'} {T.sound.ignoreSilentSwitch}
            </button>
          ) : (
            <span />
          )}
          <button class={`btn ${showSafe ? 'on' : ''}`} onClick={() => setShowSafe(!showSafe)} aria-pressed={showSafe}>
            📐 {showSafe ? T.safeArea.hide : T.safeArea.show}
          </button>
          {standalone ? (
            <span class="tile ok center">{T.homeScreen.installed}</span>
          ) : (
            <button class="btn" onClick={() => setShowGuide(true)}>
              📲 {T.homeScreen.howTo}
            </button>
          )}
        </div>

        <button class="btn" onClick={onBack}>
          ← {T.settings.back}
        </button>

        <div class={`status-line ${wakeActive ? 'ok' : 'muted'}`}>
          🔆 {T.wakeLock.label}:{' '}
          {!wakeLockSupported() ? T.wakeLock.unsupported : wakeActive ? T.wakeLock.active : T.wakeLock.inactive}
        </div>
      </section>

      {showSafe && <SafeAreaOverlay />}
      {showGuide && <HomeScreenGuide onClose={() => setShowGuide(false)} />}
    </>
  );
}

function ServerStatus(s: ReturnType<typeof useServerTest>) {
  if (!s.configured) return <span class="muted">{T.server.notConfigured}</span>;
  let text: string;
  let cls = 'muted';
  switch (s.status) {
    case 'open':
      text = s.rttMs !== null ? T.server.connected(s.rttMs) : T.server.connectedNoPing;
      cls = s.rttMs !== null && s.rttMs > 250 ? 'warn' : 'ok';
      break;
    case 'connecting':
      text = T.server.connecting;
      break;
    case 'reconnecting':
      text = T.server.reconnecting;
      cls = 'warn';
      break;
    case 'update':
      text = T.server.updateRequired;
      cls = 'bad';
      break;
    default:
      text = T.server.offline;
      cls = 'bad';
  }
  return (
    <span class="server-status">
      <span class="status-main">
        <span class={`dot ${cls}`} />
        <span class={cls}>{text}</span>
      </span>
      {s.status === 'open' && s.serverBuild && <small class="muted">Server {s.serverBuild}</small>}
      {s.lag && <small class="warn">{T.server.lagActive(s.lag.lag, s.lag.jitter)}</small>}
    </span>
  );
}
