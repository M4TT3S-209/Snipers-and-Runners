import { useEffect, useState } from 'preact/hooks';
import { formatTag } from '@scope-rush/shared';
import { T } from '../i18n/de';
import { playGlint } from '../audio/synth';
import type { HubClient } from '../account/HubClient';
import { useHub } from './useHub';

/**
 * Globale Pop-ups über allen Bildschirmen (unten, in Daumennähe):
 * Herausforderungen, Party-Einladungen, Kopplung „Bist du …?“, Hinweise.
 */
export function Popups({ hub, inviteToken, onPairingDeclined }: { hub: HubClient; inviteToken: string | null; onPairingDeclined: () => void }) {
  const st = useHub(hub);
  const [, setNow] = useState(0);
  const [closedNote, setClosedNote] = useState<string | null>(null);
  const [inviteDone, setInviteDone] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () =>
      hub.on((e) => {
        if (e.t !== 'challengeClosed') return;
        const name = e.byName ?? '';
        if (e.reason === 'declined' && name) setClosedNote(T.challenge.declined(name));
        else if (e.reason === 'expired' && name) setClosedNote(T.challenge.expired(name));
        else if (e.reason === 'gone') setClosedNote(T.challenge.gone);
        setTimeout(() => setClosedNote(null), 3500);
      }),
    [hub],
  );

  const incoming = st.challengesIn[0];
  useEffect(() => {
    if (incoming) playGlint();
  }, [incoming?.id]);

  const now = Date.now();
  const me = typeof st.account === 'object' ? st.account : null;

  // 1) Kopplung: Konto aus Safari übernehmen
  const accountOffer = !me ? st.pairing.find((p) => p.kind === 'account') : undefined;
  if (accountOffer?.account) {
    return (
      <div class="popup">
        <div class="card">
          <h2>{T.account.pairTitle}</h2>
          <p class="center big-text">{T.account.pairQuestion(formatTag(accountOffer.account))}</p>
          <div class="modal-actions">
            <button class="btn primary" onClick={() => hub.acceptPairing(accountOffer.id)}>
              {T.account.pairYes}
            </button>
            <button
              class="btn"
              onClick={() => {
                hub.dismissPairing();
                onPairingDeclined();
              }}
            >
              {T.account.pairNo}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2) Einladung (über Link oder Kopplung), wenn man schon ein Konto hat
  const inviteOffer = me ? st.pairing.find((p) => p.kind === 'invite') : undefined;
  if (inviteOffer?.from) {
    return (
      <div class="popup">
        <div class="card">
          <h2>{T.account.inviteTitle(formatTag(inviteOffer.from))}</h2>
          <div class="modal-actions">
            <button class="btn primary" onClick={() => hub.acceptPairing(inviteOffer.id)}>
              {T.account.inviteAccept}
            </button>
            <button class="btn" onClick={() => hub.dismissPairing()}>
              {T.challenge.decline}
            </button>
          </div>
        </div>
      </div>
    );
  }
  const linkInvite = st.inviteInfo && inviteToken && st.inviteInfo.token === inviteToken ? st.inviteInfo : null;
  if (me && linkInvite && !inviteDone && linkInvite.from && linkInvite.from.id !== me.id && !st.friends.some((f) => f.id === linkInvite.from!.id)) {
    return (
      <div class="popup">
        <div class="card">
          <h2>{T.account.inviteTitle(formatTag(linkInvite.from))}</h2>
          <div class="modal-actions">
            <button
              class="btn primary"
              onClick={() => {
                hub.redeemInvite(linkInvite.token);
                setInviteDone(true);
              }}
            >
              {T.account.inviteAccept}
            </button>
            <button class="btn" onClick={() => setInviteDone(true)}>
              {T.challenge.decline}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3) Herausforderung
  if (incoming) {
    const total = incoming.expiresAt - incoming.createdAt;
    const left = Math.max(0, incoming.expiresAt - now);
    const ageMin = Math.round((now - incoming.createdAt) / 60000);
    return (
      <div class="popup">
        <div class="card challenge-card">
          <h2>{ageMin >= 1 ? T.challenge.incomingInbox(incoming.from.name, ageMin) : T.challenge.incoming(incoming.from.name)}</h2>
          <div class="timebar">
            <div style={{ width: `${(left / total) * 100}%` }} />
          </div>
          <div class="modal-actions">
            <button class="btn primary big-btn" onClick={() => hub.respondChallenge(incoming.id, true)}>
              {T.challenge.accept}
            </button>
            <button class="btn" onClick={() => hub.respondChallenge(incoming.id, false)}>
              {T.challenge.decline}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4) Party-Einladung
  const party = st.parties[0];
  if (party) {
    return (
      <div class="popup">
        <div class="card">
          <h2>{T.challenge.partyInvite(party.from.name)}</h2>
          <div class="modal-actions">
            <button class="btn primary" onClick={() => hub.respondParty(party.id, true)}>
              {T.challenge.join}
            </button>
            <button class="btn" onClick={() => hub.respondParty(party.id, false)}>
              {T.challenge.decline}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 5) Eigene Herausforderung wartet
  const out = st.challengesOut[0];
  if (out) {
    const left = Math.max(0, Math.ceil((out.expiresAt - now) / 1000));
    return (
      <div class="popup small">
        <div class="card row">
          <span>
            ⚔️ {T.challenge.waiting(out.to.name)} <small class="muted">{left > 60 ? `${Math.ceil(left / 60)} min` : `${left} s`}</small>
          </span>
          <button class="btn small" onClick={() => hub.cancelChallenge(out.id)}>
            {T.challenge.cancel}
          </button>
        </div>
      </div>
    );
  }

  const toast = closedNote ?? (st.toast && now - st.toast.at < 3000 ? st.toast.text : null);
  if (toast) {
    return (
      <div class="popup small">
        <div class="card row">{toast}</div>
      </div>
    );
  }
  return null;
}
