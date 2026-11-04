import { useEffect, useRef, useState } from 'preact/hooks';
import { T } from '../i18n/de';
import { HubClient, type HubState } from '../account/HubClient';
import { LocalSession, type LocalMode } from '../game/LocalSession';
import { RemoteSession, newRoomId } from '../game/RemoteSession';
import type { GameHost } from '../game/GameHost';
import { parseLagSettings } from '../net/lagSim';
import { resolveServerUrl } from '../net/serverUrl';
import { isIOS, isStandalone } from '../platform/device';
import { onUpdateAvailable, reloadForUpdate } from '../platform/updateCheck';
import { FriendsScreen } from './FriendsScreen';
import { GameScreen } from './GameScreen';
import { Home } from './Home';
import { HomeScreenGuide, shouldAutoShowGuide } from './HomeScreenGuide';
import { Popups } from './Popups';
import { RoomScreen } from './RoomScreen';
import { SettingsScreen } from './SettingsScreen';
import { StatsScreen } from './StatsScreen';
import { TestPage } from './TestPage';
import { getSettings, onSettings, updateSettings } from './settings';
import { takeUrlParam } from './share';

type Screen = 'home' | 'settings' | 'game' | 'test' | 'room' | 'friends' | 'stats';

const SERVER_URL = resolveServerUrl(location.search, import.meta.env.VITE_SERVER_URL, location);
let hubSingleton: HubClient | null = null;
function getHub(): HubClient | null {
  if (!SERVER_URL) return null;
  if (!hubSingleton) {
    hubSingleton = new HubClient(SERVER_URL);
    // Nur beim Entwickeln: Zugriff für Browser-Tests
    if (import.meta.env.DEV) (window as unknown as { __hub: HubClient }).__hub = hubSingleton;
  }
  return hubSingleton;
}

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

function useHubState(hub: HubClient | null): HubState | null {
  const [state, setState] = useState(hub?.state ?? null);
  useEffect(() => {
    if (!hub) return;
    setState(hub.state);
    return hub.on((e) => {
      if (e.t === 'state') setState(hub.state);
    });
  }, [hub]);
  return state;
}

export function App({ host, debug }: { host: GameHost; debug: boolean }) {
  const hub = getHub();
  const hubState = useHubState(hub);
  const [screen, setScreen] = useState<Screen>(() => (new URLSearchParams(location.search).has('test') ? 'test' : 'home'));
  const [guide, setGuide] = useState(() => shouldAutoShowGuide(isIOS(), isStandalone()));
  const [update, setUpdate] = useState(false);
  const [name, setName] = useState(() => getSettings().name);
  const [remote, setRemote] = useState<RemoteSession | null>(null);
  const [pairingDeclined, setPairingDeclined] = useState(false);
  const pendingRoom = useRef<string | null>(roomFromUrl());
  const inviteToken = useRef<string | null>(takeUrlParam('invite'));
  const transferCode = useRef<string | null>(takeUrlParam('transfer'));
  const accountRequested = useRef(false);

  useEffect(() => onUpdateAvailable(() => setUpdate(true)), []);
  useEffect(() => onSettings((s) => setName(s.name)), []);

  const account = hubState && typeof hubState.account === 'object' ? hubState.account : null;

  // Einladungs-/Übertragungslink aus der Adresse
  useEffect(() => {
    if (!hub) return;
    if (inviteToken.current) hub.lookupInvite(inviteToken.current);
    if (transferCode.current) {
      hub.redeemTransfer(transferCode.current);
      transferCode.current = null;
    }
  }, [hub]);

  // Kein Konto auf diesem Gerät → erst nach Kopplung fragen (Safari → App),
  // sonst mit dem gewählten Namen still ein Konto anlegen.
  useEffect(() => {
    if (!hub || !hubState) return;
    if (hubState.account === 'none' && !hubState.pairingChecked) {
      hub.checkPairing();
      return;
    }
    const offerOpen = hubState.pairing.some((p) => p.kind === 'account');
    if (hubState.account === 'none' && (!offerOpen || pairingDeclined) && name && !accountRequested.current) {
      accountRequested.current = true;
      hub.createAccount(name, inviteToken.current ?? undefined);
    }
  }, [hub, hubState?.account, hubState?.pairingChecked, hubState?.pairing, name, pairingDeclined]);

  // Konto da → Name lokal merken (für Offline-Spiel)
  useEffect(() => {
    if (account && account.name !== getSettings().name) updateSettings({ name: account.name });
  }, [account?.name]);

  // Mit Konto: bekannte Einladungen nach Kopplung prüfen (Link wurde in Safari geöffnet)
  useEffect(() => {
    if (hub && account) hub.checkPairing();
  }, [hub, account?.id]);

  // Hub meldet: Raum für Herausforderung/Party bereit → beitreten
  useEffect(() => {
    if (!hub) return;
    return hub.on((e) => {
      if (e.t === 'roomReady') joinRoom(e.roomId);
    });
  }, [hub, remote]);

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
    if (!id || !name || !SERVER_URL || remote) return;
    pendingRoom.current = null;
    joinRoom(id);
  }, [name, account?.id]);

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
    return remote.onEvent(check);
  }, [remote, screen]);

  function joinRoom(id: string): void {
    if (!SERVER_URL) return;
    if (remote) {
      if (remote.roomId === id) return;
      remote.leave();
    }
    setRoomInUrl(id);
    const session = new RemoteSession({
      serverUrl: SERVER_URL,
      roomId: id,
      name: getSettings().name || T.game.you,
      token: hub?.token ?? null,
      lag: parseLagSettings(location.search),
    });
    setRemote(session);
    setScreen('room');
  }

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

  const onNameChosen = (n: string) => {
    updateSettings({ name: n });
    if (hub && hubState?.account === 'none' && !accountRequested.current) {
      accountRequested.current = true;
      hub.createAccount(n, inviteToken.current ?? undefined);
    }
  };

  const pendingRequests = hubState ? hubState.incoming.length : 0;
  const onlineFriends = hubState ? hubState.friends.filter((f) => f.status !== 'offline').length : 0;
  const inviter = hubState?.inviteInfo && hubState.inviteInfo.token === inviteToken.current ? hubState.inviteInfo.from : null;
  const showPopups = hub && !(screen === 'game' && remote && host.getSession() === remote);

  return (
    <>
      {screen === 'home' && (
        <Home
          account={account}
          inviter={inviter}
          onNameChosen={onNameChosen}
          onInviteAppHint={() => {
            if (hub && inviteToken.current) hub.offerPairing('invite', inviteToken.current);
          }}
          onStart={startLocal}
          onSettings={() => setScreen('settings')}
          friends={hub ? { online: onlineFriends, requests: pendingRequests, onClick: () => setScreen('friends') } : null}
          online={
            SERVER_URL
              ? { label: T.room.online, sub: T.room.onlineSub, onClick: () => joinRoom(newRoomId()) }
              : { label: T.room.noServer, sub: '', onClick: null }
          }
        />
      )}
      {screen === 'settings' && <SettingsScreen hub={hub} onBack={() => setScreen('home')} onDeviceTest={() => setScreen('test')} />}
      {screen === 'friends' && hub && <FriendsScreen hub={hub} onBack={() => setScreen('home')} onStats={() => setScreen('stats')} />}
      {screen === 'stats' && hub && <StatsScreen hub={hub} onBack={() => setScreen('friends')} />}
      {screen === 'test' && <TestPage onBack={() => setScreen('settings')} subscribeStats={(cb) => host.onHud((s) => cb(s.stats))} />}
      {screen === 'room' && remote && <RoomScreen session={remote} hub={hub} onLeave={leaveRoom} />}
      {screen === 'game' && <GameScreen host={host} debug={debug && !remote} onExit={exitGame} />}

      {update && screen !== 'game' && (
        <div class="update-toast">
          <span>{T.update.available}</span>
          <button class="btn primary small" onClick={() => void reloadForUpdate()}>
            {T.update.reload}
          </button>
        </div>
      )}
      {guide && name && screen === 'home' && (
        <HomeScreenGuide
          onShow={() => {
            // Safari: Konto für die Home-Bildschirm-App bereitlegen (Kopplung über gleiche IP)
            if (hub && account) hub.offerPairing('account');
          }}
          onClose={() => setGuide(false)}
        />
      )}
      {showPopups && (
        <Popups
          hub={hub}
          inviteToken={inviteToken.current}
          onPairingDeclined={() => {
            setPairingDeclined(true);
          }}
        />
      )}
    </>
  );
}
