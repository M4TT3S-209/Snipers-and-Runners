import { useEffect, useRef, useState } from 'preact/hooks';
import { T } from '../i18n/de';
import { LocalSession, type LocalMode } from '../game/LocalSession';
import { RemoteSession, newRoomId } from '../game/RemoteSession';
import type { GameHost } from '../game/GameHost';
import { parseLagSettings } from '../net/lagSim';
import { resolveServerUrl } from '../net/serverUrl';
import { isIOS, isStandalone } from '../platform/device';
import { onUpdateAvailable, reloadForUpdate } from '../platform/updateCheck';
import { GameScreen } from './GameScreen';
import { Home } from './Home';
import { HomeScreenGuide, shouldAutoShowGuide } from './HomeScreenGuide';
import { RoomScreen } from './RoomScreen';
import { SettingsScreen } from './SettingsScreen';
import { TestPage } from './TestPage';
import { getSettings, onSettings } from './settings';

type Screen = 'home' | 'settings' | 'game' | 'test' | 'room';

const SERVER_URL = resolveServerUrl(location.search, import.meta.env.VITE_SERVER_URL, location);

function roomFromUrl(): string | null {
  const id = new URLSearchParams(location.search).get('room');
  return id && /^[a-z0-9]{6,16}$/.test(id) ? id : null;
}

function setRoomInUrl(id: string | null): void {
  const url = new URL(location.href);
  if (id) url.searchParams.set('room', id);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url.toString());
}

export function App({ host, debug }: { host: GameHost; debug: boolean }) {
  const [screen, setScreen] = useState<Screen>(() => (new URLSearchParams(location.search).has('test') ? 'test' : 'home'));
  const [guide, setGuide] = useState(() => shouldAutoShowGuide(isIOS(), isStandalone()));
  const [update, setUpdate] = useState(false);
  const [hasName, setHasName] = useState(() => getSettings().name.length > 0);
  const [remote, setRemote] = useState<RemoteSession | null>(null);
  const pendingRoom = useRef<string | null>(roomFromUrl());

  useEffect(() => onUpdateAvailable(() => setUpdate(true)), []);
  useEffect(() => onSettings((s) => setHasName(s.name.length > 0)), []);

  // Im Menü läuft im Hintergrund eine Demo (zwei Bots)
  useEffect(() => {
    if (screen === 'game') return;
    const current = host.getSession();
    if (current instanceof LocalSession && current.isDemo) return;
    host.setSession(new LocalSession({ mode: 'demo', myName: '', botLevel: 'medium' }));
  }, [screen, host]);

  // Raum-Link geöffnet → beitreten, sobald ein Name da ist
  useEffect(() => {
    const id = pendingRoom.current;
    if (!id || !hasName || !SERVER_URL || remote) return;
    pendingRoom.current = null;
    joinRoom(id);
  }, [hasName]);

  // Match im Raum gestartet → Spielbildschirm
  useEffect(() => {
    if (!remote) return;
    const check = () => {
      if (remote.inMatch && screen === 'room' && host.getSession() !== remote) {
        host.setSession(remote);
        setScreen('game');
      }
    };
    check();
    const off = remote.onEvent(check);
    return off;
  }, [remote, screen]);

  const joinRoom = (id: string) => {
    if (!SERVER_URL) return;
    setRoomInUrl(id);
    const session = new RemoteSession({
      serverUrl: SERVER_URL,
      roomId: id,
      name: getSettings().name,
      lag: parseLagSettings(location.search),
    });
    setRemote(session);
    setScreen('room');
  };

  const leaveRoom = () => {
    remote?.leave();
    setRemote(null);
    setRoomInUrl(null);
    setScreen('home');
  };

  const startLocal = (mode: LocalMode) => {
    const s = getSettings();
    host.setSession(new LocalSession({ mode, myName: s.name, botLevel: s.botLevel, bots: 3 }));
    setScreen('game');
  };

  const exitGame = () => {
    if (remote && host.getSession() === remote) {
      leaveRoom();
      return;
    }
    setScreen('home');
  };

  return (
    <>
      {screen === 'home' && (
        <Home
          onStart={startLocal}
          onSettings={() => setScreen('settings')}
          online={
            SERVER_URL
              ? { label: T.room.online, sub: T.room.onlineSub, onClick: () => joinRoom(newRoomId()) }
              : { label: T.room.noServer, sub: '', onClick: null }
          }
        />
      )}
      {screen === 'settings' && <SettingsScreen onBack={() => setScreen('home')} onDeviceTest={() => setScreen('test')} />}
      {screen === 'test' && <TestPage onBack={() => setScreen('settings')} subscribeStats={(cb) => host.onHud((s) => cb(s.stats))} />}
      {screen === 'room' && remote && <RoomScreen session={remote} onLeave={leaveRoom} />}
      {screen === 'game' && <GameScreen host={host} debug={debug && !remote} onExit={exitGame} />}

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
