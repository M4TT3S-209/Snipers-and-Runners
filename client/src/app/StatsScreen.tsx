import { useEffect } from 'preact/hooks';
import { formatTag } from '@scope-rush/shared';
import { T } from '../i18n/de';
import type { HubClient } from '../account/HubClient';
import { useHub } from './useHub';

/** Statistik: eigene Bilanz, Bilanz gegen jeden Freund, Rangliste im Freundeskreis. */
export function StatsScreen({ hub, onBack }: { hub: HubClient; onBack: () => void }) {
  const st = useHub(hub);
  useEffect(() => hub.loadStats(), [hub]);
  const s = st.stats;
  const nameOf = (id: string) => st.friends.find((f) => f.id === id)?.name ?? '?';
  const me = typeof st.account === 'object' ? st.account : null;

  return (
    <div class="list-screen">
      <h1>{T.stats.title}</h1>
      <div class="list-body" data-scroll>
        {s && (
          <>
            <div class="stat-grid">
              <Stat label={T.stats.trophies} value={`🏆 ${s.trophies}`} />
              <Stat label={T.stats.wins} value={s.wins} />
              <Stat label={T.stats.losses} value={s.losses} />
              <Stat label={T.stats.draws} value={s.draws} />
              <Stat label={T.stats.party} value={s.partyGames} />
            </div>
            <div class="section-label">{T.stats.vs}</div>
            {s.headToHead.length === 0 && <p class="muted center">{T.stats.noGames}</p>}
            {s.headToHead.map((h) => (
              <div key={h.friendId} class="friend-row">
                <span class="friend-name">{nameOf(h.friendId)}</span>
                <b>
                  {h.wins} : {h.losses}
                </b>
                {h.draws > 0 && <small class="muted">({h.draws} ×=)</small>}
              </div>
            ))}
            <div class="section-label">{T.stats.board}</div>
            <ol class="ranking board">
              {s.leaderboard.map((p) => (
                <li key={p.id} class={me && p.id === me.id ? 'me' : ''}>
                  <span>{formatTag(p)}</span>
                  <b>🏆 {p.trophies}</b>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
      <button class="btn back-btn" onClick={onBack}>
        {T.friends.back}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div class="stat">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}
