import { CONFIG, CLOSE_CODES, HEARTBEAT_PING, HEARTBEAT_PONG } from '@scope-rush/shared';
import type { ClientMessage, ServerMessage } from '@scope-rush/shared';
import { LagQueue, type LagSettings } from './lagSim';

/**
 * WebSocket mit automatischem Neuverbinden – gebaut für iOS:
 * Beim App-Wechsel friert iOS die Seite ein und die Verbindung stirbt oft
 * „still“ (ohne close-Event). Deshalb:
 *  - Heartbeat („ping“ → „pong“, beantwortet der Server automatisch)
 *  - bei Rückkehr in die App (visibilitychange/pageshow/online) sofort prüfen
 *  - Neuverbinden mit wachsender Wartezeit (0,5 s … 8 s)
 *  - Code 4001 vom Server = Version passt nicht → kein Neuverbinden, Update nötig
 */
export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'update';

export interface SocketOptions<In> {
  url: () => string;
  onMessage: (msg: In) => void;
  onStatus?: (status: SocketStatus) => void;
  onOpen?: () => void;
  onUpdateRequired?: () => void;
  lag?: LagSettings | null;
}

const PROBE_TIMEOUT_MS = 2500;

export class ReconnectingSocket<In = ServerMessage, Out = ClientMessage> {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageAt = 0;
  private stopped = true;
  private status: SocketStatus = 'connecting';
  private readonly sendQueue: LagQueue | null;
  private readonly recvQueue: LagQueue | null;

  constructor(private readonly opts: SocketOptions<In>) {
    this.sendQueue = opts.lag ? new LagQueue(opts.lag) : null;
    this.recvQueue = opts.lag ? new LagQueue(opts.lag) : null;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('pageshow', this.onWake);
    window.addEventListener('online', this.onWake);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('pageshow', this.onWake);
    window.removeEventListener('online', this.onWake);
    this.clearTimers();
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }

  send(msg: Out): void {
    this.sendRaw(JSON.stringify(msg));
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Sofort neu verbinden (z. B. per Button). */
  reconnectNow(): void {
    if (this.status === 'update') return;
    this.attempt = 0;
    this.dropSocket();
    this.connect();
  }

  // ---------------------------------------------------------------------------

  private sendRaw(data: string): void {
    const doSend = () => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    };
    if (this.sendQueue) this.sendQueue.push(doSend);
    else doSend();
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus?.(status);
  }

  private connect(): void {
    if (this.stopped || this.status === 'update') return;
    this.clearTimers();
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.attempt = 0;
      this.lastMessageAt = performance.now();
      this.setStatus('open');
      this.startHeartbeat();
      this.opts.onOpen?.();
    };

    ws.onmessage = (event) => {
      if (ws !== this.ws) return;
      this.lastMessageAt = performance.now();
      const data = event.data;
      if (typeof data !== 'string' || data === HEARTBEAT_PONG) return;
      let msg: In;
      try {
        msg = JSON.parse(data) as In;
      } catch {
        return;
      }
      const deliver = () => {
        if (ws === this.ws) this.opts.onMessage(msg);
      };
      if (this.recvQueue) this.recvQueue.push(deliver);
      else deliver();
    };

    ws.onclose = (event) => {
      if (ws !== this.ws) return;
      this.ws = null;
      this.clearTimers();
      if (event.code === CLOSE_CODES.versionMismatch) {
        this.setStatus('update');
        this.opts.onUpdateRequired?.();
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose folgt immer – dort wird neu verbunden.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const { reconnectBaseMs, reconnectMaxMs } = CONFIG.net;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(): void {
    const interval = CONFIG.net.heartbeatMs;
    this.heartbeatTimer = setInterval(() => {
      if (performance.now() - this.lastMessageAt > interval * 2.5) {
        // Lange nichts gehört → Verbindung ist vermutlich tot.
        this.reconnectNow();
        return;
      }
      this.sendRaw(HEARTBEAT_PING);
    }, interval);
  }

  /** Rückkehr in die App: Lebt die Verbindung noch? */
  private readonly onWake = () => {
    if (this.stopped || document.visibilityState !== 'visible') return;
    if (!this.isOpen) {
      this.reconnectNow();
      return;
    }
    const probeStart = performance.now();
    this.sendRaw(HEARTBEAT_PING);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => {
      if (this.lastMessageAt < probeStart) this.reconnectNow();
    }, PROBE_TIMEOUT_MS);
  };

  private dropSocket(): void {
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close(1000, 'reconnect');
      } catch {
        // egal
      }
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.reconnectTimer = this.heartbeatTimer = this.probeTimer = null;
  }
}
