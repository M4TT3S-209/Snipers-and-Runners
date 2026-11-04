import { useEffect, useState } from 'preact/hooks';
import type { RoomMember } from '@scope-rush/shared';
import { T } from '../i18n/de';
import { playClick } from '../audio/synth';
import type { RemoteSession } from '../game/RemoteSession';

/** Lobby eines Online-Raums (Raum-Link teilen, Mitspieler, Bereit). */
export function RoomScreen({ session, onLeave }: { session: RemoteSession; onLeave: () => void }) {
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const off = session.onEvent(() => setTick((n) => n + 1));
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [session]);

  const room = session.room;
  const me = room?.members.find((m) => m.id === session.myId);
  const players = room?.members.filter((m) => m.seat === 'player') ?? [];
  const spectators = room?.members.filter((m) => m.seat === 'spectator') ?? [];
  const link = roomLink(session.roomId);

  const share = async () => {
    playClick();
    const data = { title: T.appName, text: T.room.shareText, url: link };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      // abgebrochen → Kopieren anbieten
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      prompt(T.room.copyPrompt, link);
    }
  };

  return (
    <div class="room-screen">
      <h1>{T.room.title}</h1>
      <div class="room-card">
        <div class="room-status">
          <span class={`dot ${session.status === 'open' ? 'ok' : 'warn'}`} />
          <span>{session.status === 'open' ? T.room.connected(Math.round(session.rtt)) : T.server.reconnecting}</span>
        </div>
        {session.error && <div class="bad">{T.room.errors[session.error as keyof typeof T.room.errors] ?? session.error}</div>}

        <div class="room-link">
          <code>{link.replace(/^https?:\/\//, '')}</code>
        </div>
        <div class="tile-grid">
          <button class="btn primary" onClick={() => void share()}>
            📤 {T.room.share}
          </button>
          <button
            class="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                prompt(T.room.copyPrompt, link);
              }
            }}
          >
            {copied ? `✔ ${T.room.copied}` : `📋 ${T.room.copy}`}
          </button>
        </div>

        <div class="section-label">{T.room.players(players.length)}</div>
        {players.map((m) => (
          <MemberRow key={m.id} m={m} me={m.id === session.myId} />
        ))}
        {players.length < 2 && <div class="muted center">{T.room.waitingForFriend}</div>}
        {spectators.length > 0 && (
          <>
            <div class="section-label">{T.room.spectators}</div>
            {spectators.map((m) => (
              <MemberRow key={m.id} m={m} me={m.id === session.myId} />
            ))}
          </>
        )}

        {me?.seat === 'player' && (
          <button
            class={`btn big-btn ${me.ready ? 'on' : 'primary'}`}
            disabled={players.length < 2}
            onClick={() => {
              playClick();
              session.setReady(!me.ready);
            }}
          >
            {me.ready ? `✔ ${T.room.readyWaiting}` : T.room.ready}
          </button>
        )}
      </div>
      <button class="btn back-btn" onClick={onLeave}>
        {T.room.leave}
      </button>
    </div>
  );
}

function MemberRow({ m, me }: { m: RoomMember; me: boolean }) {
  return (
    <div class={`member c${m.color % 8}`}>
      <span class="member-dot" />
      <b>
        {m.name}
        {me ? ` (${T.game.you})` : ''}
      </b>
      <span class="member-state">
        {!m.connected ? `💤 ${T.room.away}` : m.ready ? `✔ ${T.room.isReady}` : ''}
      </span>
    </div>
  );
}

export function roomLink(roomId: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomId);
  return url.toString();
}
