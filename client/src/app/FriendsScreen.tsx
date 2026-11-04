import { useEffect, useState } from 'preact/hooks';
import { formatTag, parseTag, type FriendInfo } from '@scope-rush/shared';
import { T } from '../i18n/de';
import { playClick } from '../audio/synth';
import type { HubClient } from '../account/HubClient';
import { useHub } from './useHub';
import { QrCode } from './QrCode';
import { appLink, shareLink } from './share';

/** Freundesliste: Status, Herausfordern, Hinzufügen (Link/QR/Name#Tag), Anfragen, Party, Statistik. */
export function FriendsScreen({ hub, onBack, onStats }: { hub: HubClient; onBack: () => void; onStats: () => void }) {
  const st = useHub(hub);
  const [query, setQuery] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<FriendInfo | null>(null);
  const [searchError, setSearchError] = useState('');

  // Einladungslink bei Bedarf erzeugen (7 Tage gültig)
  useEffect(() => {
    if (!st.invite || st.invite.expiresAt < Date.now() + 3600_000) hub.createInvite();
  }, [hub, typeof st.account === 'object']);

  useEffect(() => {
    const e = st.lastError;
    if (e && Date.now() - e.at < 3000 && (e.ctx === 'friend' || ['self', 'already_friends', 'not_found'].includes(e.code))) {
      setSearchError(T.friends.errors[e.code] ?? e.code);
    }
  }, [st.lastError]);

  const me = typeof st.account === 'object' ? st.account : null;
  const link = st.invite ? appLink({ invite: st.invite.token }) : null;
  const order = { online: 0, match: 1, offline: 2 } as const;
  const friends = [...st.friends].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const outgoingTo = new Set(st.challengesOut.map((c) => c.to.id));

  const search = () => {
    const parsed = parseTag(query);
    if (!parsed) {
      setSearchError(T.friends.searchHint);
      return;
    }
    setSearchError('');
    hub.searchFriend(parsed.name, parsed.tag);
    setQuery('');
  };

  return (
    <div class="list-screen">
      <h1>{T.friends.title}</h1>
      <div class="list-body" data-scroll>
        {st.status !== 'open' && <div class="banner-inline warn">{T.friends.offline}</div>}
        {me && (
          <div class="me-card">
            <span class="muted">{T.friends.me}</span>
            <b class="tag">{formatTag(me)}</b>
          </div>
        )}

        <div class="section-label">{T.friends.addTitle}</div>
        <div class="tile-grid">
          <button
            class="btn primary"
            disabled={!link || !me}
            onClick={() => {
              playClick();
              if (link && me) void shareLink(link, T.friends.inviteText(me.name));
            }}
          >
            {T.friends.inviteLink}
          </button>
          <button class={`btn ${showQr ? 'on' : ''}`} disabled={!link} onClick={() => setShowQr(!showQr)}>
            {T.friends.showQr}
          </button>
        </div>
        {showQr && link && (
          <div class="qr-box">
            <QrCode text={link} size={210} />
            <small class="muted">{T.friends.qrHint}</small>
          </div>
        )}
        <form
          class="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input
            value={query}
            placeholder={T.friends.searchPlaceholder}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="send"
          />
          <button class="btn" type="submit" disabled={query.trim().length < 4}>
            {T.friends.searchButton}
          </button>
        </form>
        {searchError && <small class="bad">{searchError}</small>}

        {(st.incoming.length > 0 || st.outgoing.length > 0) && <div class="section-label">{T.friends.requests}</div>}
        {st.incoming.map((r) => (
          <div key={r.id} class="friend-row">
            <span class="friend-name">{formatTag(r)}</span>
            <button class="btn small primary" onClick={() => hub.respondFriend(r.id, true)}>
              {T.friends.accept}
            </button>
            <button class="btn small" onClick={() => hub.respondFriend(r.id, false)}>
              ✕
            </button>
          </div>
        ))}
        {st.outgoing.map((r) => (
          <div key={r.id} class="friend-row">
            <span class="friend-name">{formatTag(r)}</span>
            <small class="muted">{T.friends.pending}</small>
          </div>
        ))}

        <div class="section-label">{T.friends.list(friends.length)}</div>
        {friends.length === 0 && <p class="muted center">{T.friends.empty}</p>}
        {friends.map((f) => (
          <div key={f.id} class="friend-row">
            <span class={`status-dot ${f.status}`} />
            <span class="friend-name">
              {f.name}
              <small class="muted">
                {' '}
                · {f.status === 'offline' && f.lastSeen ? T.friends.lastSeen(Math.max(1, Math.round((Date.now() - f.lastSeen) / 60000))) : T.friends.status[f.status]}
              </small>
            </span>
            <button class="btn small ghost" aria-label={T.friends.remove} onClick={() => setConfirmRemove(f)}>
              ⋯
            </button>
            <button
              class="btn small primary"
              aria-label={T.friends.challengeLabel}
              disabled={f.status === 'match' || outgoingTo.has(f.id)}
              onClick={() => {
                playClick();
                hub.challenge(f.id);
              }}
            >
              {T.friends.challenge}
            </button>
          </div>
        ))}

        <button class="btn big-btn" disabled={!me} onClick={() => hub.createParty()}>
          <span>{T.friends.party}</span>
          <small>{T.friends.partySub}</small>
        </button>
        <button class="btn" disabled={!me} onClick={onStats}>
          {T.friends.stats}
        </button>
      </div>
      <button class="btn back-btn" onClick={onBack}>
        {T.friends.back}
      </button>

      {confirmRemove && (
        <div class="modal-backdrop">
          <div class="modal">
            <h2>{T.friends.removeConfirm(confirmRemove.name)}</h2>
            <div class="modal-actions">
              <button class="btn primary" onClick={() => setConfirmRemove(null)}>
                {T.game.leaveNo}
              </button>
              <button
                class="btn"
                onClick={() => {
                  hub.removeFriend(confirmRemove.id);
                  setConfirmRemove(null);
                }}
              >
                {T.friends.remove}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
