import { useState } from 'preact/hooks';
import { UNLOCKS, isUnlocked, trophiesFor, type EmoteId, type Unlockable } from '@scope-rush/shared';
import { T } from '../i18n/de';
import { playClick } from '../audio/synth';
import { RUNNER_PALETTES } from '../game/themes';
import { myCosmetics, myTrophies, setMyCosmetics } from './profile';

const EMOTES: EmoteId[] = ['cheer', 'dance', 'spin', 'flex'];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Aussehen wählen (Farbe, Sieger-Jubel) und Freischaltungen ansehen. */
export function LookScreen({ onBack, offline }: { onBack: () => void; offline: boolean }) {
  const trophies = myTrophies();
  const [c, setC] = useState(myCosmetics());

  const choose = (patch: Partial<typeof c>) => {
    const next = { ...c, ...patch };
    setC(next);
    setMyCosmetics(next);
    playClick();
  };

  return (
    <div class="list-screen">
      <h1>{T.look.title}</h1>
      <div class="list-body" data-scroll>
        <div class="me-card">
          <b class="tag">{T.look.trophies(trophies)}</b>
        </div>
        {offline && <small class="muted">{T.look.offlineHint}</small>}

        <div class="section-label">{T.look.skins}</div>
        <div class="skin-grid">
          {RUNNER_PALETTES.map((p, i) => {
            const locked = !isUnlocked('skin', i, trophies);
            return (
              <button key={i} class={`skin ${c.skin === i ? 'selected' : ''} ${locked ? 'locked' : ''}`} disabled={locked} onClick={() => choose({ skin: i })}>
                <span class="swatch">
                  <i style={{ background: hex(p.cap) }} />
                  <i style={{ background: hex(p.shirt) }} />
                  <i style={{ background: hex(p.pants) }} />
                </span>
                {locked ? `🔒 ${trophiesFor('skin', i)}` : c.skin === i ? '✔' : ''}
              </button>
            );
          })}
        </div>

        <div class="section-label">{T.look.emotes}</div>
        <div class="tile-grid">
          {EMOTES.map((e) => {
            const locked = !isUnlocked('emote', e, trophies);
            return (
              <button key={e} class={`btn ${c.emote === e ? 'on' : ''}`} disabled={locked} onClick={() => choose({ emote: e })}>
                {locked ? `🔒 ${T.look.emoteNames[e]} · ${trophiesFor('emote', e)}` : T.look.emoteNames[e]}
              </button>
            );
          })}
        </div>

        <div class="section-label">{T.look.unlocks}</div>
        {UNLOCKS.filter((u) => u.trophies > 0).map((u) => (
          <div key={`${u.kind}-${u.id}`} class={`unlock-row ${trophies >= u.trophies ? 'got' : ''}`}>
            <span>
              {trophies >= u.trophies ? '✔' : '🔒'} {T.look.kinds[u.kind]}: {unlockName(u)}
            </span>
            <b>🏆 {u.trophies}</b>
          </div>
        ))}
      </div>
      <button class="btn back-btn" onClick={onBack}>
        {T.look.back}
      </button>
    </div>
  );
}

export function unlockName(u: Unlockable): string {
  switch (u.kind) {
    case 'theme':
      return T.themes[u.id];
    case 'weapon':
      return T.weapons[u.id].name;
    case 'gadget':
      return T.gadgets[u.id].name;
    case 'skin':
      return `#${u.id + 1}`;
    case 'emote':
      return T.look.emoteNames[u.id];
  }
}
