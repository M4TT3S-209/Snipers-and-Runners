import { useEffect, useRef, useState } from 'preact/hooks';
import { CONFIG, PROTOCOL_VERSION } from '@scope-rush/shared';
import type { ServerMessage } from '@scope-rush/shared';
import { ReconnectingSocket, type SocketStatus } from '../net/socket';
import { resolveServerUrl, toWebSocketUrl } from '../net/serverUrl';
import { parseLagSettings } from '../net/lagSim';
import { markUpdateAvailable } from '../platform/updateCheck';

export interface ServerTestState {
  configured: boolean;
  status: SocketStatus | 'none';
  rttMs: number | null;
  boots: number | null;
  connections: number | null;
  serverBuild: string | null;
  lag: { lag: number; jitter: number } | null;
  reconnect: () => void;
}

/** Verbindet sich mit dem Hub und misst regelmäßig die Laufzeit (Echo). */
export function useServerTest(): ServerTestState {
  const serverUrl = resolveServerUrl(location.search, import.meta.env.VITE_SERVER_URL, location);
  const lag = parseLagSettings(location.search);
  const [status, setStatus] = useState<SocketStatus | 'none'>(serverUrl ? 'connecting' : 'none');
  const [rttMs, setRtt] = useState<number | null>(null);
  const [info, setInfo] = useState<{ boots: number; connections: number; build: string } | null>(null);
  const socketRef = useRef<ReconnectingSocket | null>(null);

  useEffect(() => {
    if (!serverUrl) return;
    let smoothed: number | null = null;
    const socket = new ReconnectingSocket({
      url: () => toWebSocketUrl(serverUrl, `/hub?v=${PROTOCOL_VERSION}`),
      lag,
      onStatus: setStatus,
      onUpdateRequired: markUpdateAvailable,
      onOpen: () => socket.send({ t: 'echo', c: performance.now() }),
      onMessage: (msg: ServerMessage) => {
        if (msg.t === 'welcome') {
          setInfo({ boots: msg.boots, connections: msg.connections, build: msg.server });
          if (msg.protocol !== PROTOCOL_VERSION) markUpdateAvailable();
        } else if (msg.t === 'echo') {
          const rtt = performance.now() - msg.c;
          smoothed = smoothed === null ? rtt : smoothed * 0.7 + rtt * 0.3;
          setRtt(Math.round(smoothed));
        }
      },
    });
    socketRef.current = socket;
    socket.start();
    const timer = setInterval(() => {
      if (socket.isOpen) socket.send({ t: 'echo', c: performance.now() });
    }, CONFIG.net.syncIntervalMs);
    return () => {
      clearInterval(timer);
      socket.stop();
    };
    // Nur einmal beim Start verbinden.
  }, []);

  return {
    configured: serverUrl !== null,
    status,
    rttMs,
    boots: info?.boots ?? null,
    connections: info?.connections ?? null,
    serverBuild: info?.build ?? null,
    lag: lag ? { lag: lag.lag, jitter: lag.jitter } : null,
    reconnect: () => socketRef.current?.reconnectNow(),
  };
}
