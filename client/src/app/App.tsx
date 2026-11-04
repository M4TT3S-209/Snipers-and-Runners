import { useEffect, useState } from 'preact/hooks';
import { T } from '../i18n/de';
import { LocalSession, type LocalMode } from '../game/LocalSession';
import type { GameHost } from '../game/GameHost';
import { isIOS, isStandalone } from '../platform/device';
import { onUpdateAvailable, reloadForUpdate } from '../platform/updateCheck';
import { GameScreen } from './GameScreen';
import { Home } from './Home';
import { HomeScreenGuide, shouldAutoShowGuide } from './HomeScreenGuide';
import { SettingsScreen } from './SettingsScreen';
import { TestPage } from './TestPage';
import { getSettings, onSettings } from './settings';

type Screen = 'home' | 'settings' | 'game' | 'test';

export function App({ host, debug }: { host: GameHost; debug: boolean }) {
  const [screen, setScreen] = useState<Screen>(() => (new URLSearchParams(location.search).has('test') ? 'test' : 'home'));
  const [guide, setGuide] = useState(() => shouldAutoShowGuide(isIOS(), isStandalone()));
  const [update, setUpdate] = useState(false);
  const [hasName, setHasName] = useState(() => getSettings().name.length > 0);

  useEffect(() => onUpdateAvailable(() => setUpdate(true)), []);
  useEffect(() => onSettings((s) => setHasName(s.name.length > 0)), []);

  // Im Menü läuft im Hintergrund eine Demo (zwei Bots)
  useEffect(() => {
    if (screen === 'game') return;
    if (host.getSession() instanceof LocalSession && (host.getSession() as LocalSession).isDemo) return;
    host.setSession(new LocalSession({ mode: 'demo', myName: '', botLevel: 'medium' }));
  }, [screen, host]);

  const startLocal = (mode: LocalMode) => {
    const s = getSettings();
    host.setSession(new LocalSession({ mode, myName: s.name, botLevel: s.botLevel, bots: 3 }));
    setScreen('game');
  };

  return (
    <>
      {screen === 'home' && <Home onStart={startLocal} onSettings={() => setScreen('settings')} online={null} />}
      {screen === 'settings' && <SettingsScreen onBack={() => setScreen('home')} onDeviceTest={() => setScreen('test')} />}
      {screen === 'test' && (
        <TestPage
          onBack={() => setScreen('settings')}
          subscribeStats={(cb) => host.onHud((s) => cb(s.stats))}
        />
      )}
      {screen === 'game' && <GameScreen host={host} debug={debug} onExit={() => setScreen('home')} />}

      {update && screen !== 'game' && (
        <div class="update-toast">
          <span>{T.update.available}</span>
          <button class="btn primary small" onClick={() => void reloadForUpdate()}>
            {T.update.reload}
          </button>
        </div>
      )}
      {guide && hasName && screen === 'home' && <HomeScreenGuide onClose={() => setGuide(false)} />}
    </>
  );
}
