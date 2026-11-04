import { useEffect, useState } from 'preact/hooks';
import { CONFIG, type RoomMember } from '@scope-rush/shared';
import { T } from '../i18n/de';
import { playClick } from '../audio/synth';
import type { HubClient } from '../account/HubClient';
import type { RemoteSession } from '../game/RemoteSession';
import { appLink, shareLink } from './share';

/** Lobby eines Online-Raums: Link teilen, Freunde einladen, Modus (Gastgeber), Bereit. */
export function RoomScreen({ session, hub, onLeave }: { session: RemoteSession; hub: HubClient | null; onLeave: () => void }) {
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    const off = session.onEvent(() => setTick((n) => n + 1));
    const offHub = hub?.on(() => setTick((n) => n + 1));
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      off();
      offHub?.();
      clearInterval(timer);
    };
  }, [session, hub]);

  const room = session.room;
  const me = room?.members.find((m) => m.id === session.myId);
  const isHost = !!room && room.hostId === session.myId;
  const mode = room?.mode ?? 'duel';
  const maxPlayers = mode === 'duel' ? 2 : CONFIG.party.maxPlayers;
  const minPlayers = mode === 'duel' ? 2 : CONFIG.party.minPlayers;
  const players = room?.members.filter((m) => m.seat === 'player') ?? [];
  const spectators = room?.members.filter((m) => m.seat === 'spectator') ?? [];
  const link = appLink({ room: session.roomId });
  const inRoom = new Set(room?.members.map((m) => m.id) ?? []);
  const invitable = hub ? hub.state.friends.filter((f) => f.status === 'online' && !inRoom.has(f.id)) : [];

  return (
    <div class="room-screen">
      <h1>{mode === 'classic' ? T.room.partyTitle : T.room.title}</h1>
      <div class="room-card" data-scroll>
        <div class="room-status">
          <span class={`dot ${session.status === 'open' ? 'ok' : 'warn'}`} />
          <span>{session.status === 'open' ? T.room.connected(Math.round(session.rtt)) : T.server.reconnecting}</span>
        </div>
        {session.error && <div class="bad">{T.room.errors[session.error as keyof typeof T.room.errors] ?? session.error}</div>}

        {isHost && (
          <div class="seg">
            <button class={`btn small ${mode === 'duel' ? 'on' : ''}`} onClick={() => session.setMode('duel')}>
              {T.room.modeDuel}
            </button>
            <button class={`btn small ${mode === 'classic' ? 'on' : ''}`} onClick={() => session.setMode('classic')}>
              {T.room.modeClassic}
            </button>
          </div>
        )}

        <div class="tile-grid">
          <button
            class="btn primary"
            onClick={async () => {
              playClick();
              const r = await shareLink(link, T.room.shareText);
              if (r === 'copied') setCopied(true);
            }}
          >
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

        {invitable.length > 0 && (
          <>
            <div class="section-label">{T.room.inviteFriends}</div>
            <div class="chip-row">
              {invitable.map((f) => (
                <button
                  key={f.id}
                  class={`btn small ${invited.has(f.id) ? 'on' : ''}`}
                  disabled={invited.has(f.id)}
                  onClick={() => {
                    hub?.inviteToParty(f.id, session.roomId);
                    setInvited(new Set([...invited, f.id]));
                  }}
                >
                  {invited.has(f.id) ? `${f.name} ✔` : `+ ${f.name}`}
                </button>
              ))}
            </div>
          </>
        )}

        <div class="section-label">{T.room.players(players.length, maxPlayers)}</div>
        {players.map((m) => (
          <MemberRow key={m.id} m={m} me={m.id === session.myId} host={m.id === room?.hostId} />
        ))}
        {players.length < minPlayers && <div class="muted center">{mode === 'duel' ? T.room.waitingForFriend : T.room.needPlayers(minPlayers - players.length)}</div>}
        {spectators.length > 0 && (
          <>
            <div class="section-label">{T.room.spectators}</div>
            {spectators.map((m) => (
              <MemberRow key={m.id} m={m} me={m.id === session.myId} host={m.id === room?.hostId} />
            ))}
          </>
        )}

        {me?.seat === 'player' && (
          <button
            class={`btn big-btn ${me.ready ? 'on' : 'primary'}`}
            disabled={players.length < minPlayers}
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

function MemberRow({ m, me, host }: { m: RoomMember; me: boolean; host: boolean }) {
  return (
    <div class={`member c${m.color % 8}`}>
      <span class="member-dot" />
      <b>
        {host ? '👑 ' : ''}
        {m.name}
        {me ? ` (${T.game.you})` : ''}
      </b>
      <span class="member-state">{!m.connected ? `💤 ${T.room.away}` : m.ready ? `✔ ${T.room.isReady}` : ''}</span>
    </div>
  );
}
