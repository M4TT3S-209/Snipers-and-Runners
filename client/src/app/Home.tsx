import { useState } from 'preact/hooks';
import { T } from '../i18n/de';
import { playClick, unlockAudio } from '../audio/synth';
import type { LocalMode } from '../game/LocalSession';
import { getSettings, updateSettings, type BotLevelSetting } from './settings';

export interface HomeProps {
  onStart: (mode: LocalMode) => void;
  onSettings: () => void;
  online: { label: string; sub: string; onClick: (() => void) | null } | null;
}

const LEVELS: BotLevelSetting[] = ['easy', 'medium', 'hard'];

export function Home({ onStart, onSettings, online }: HomeProps) {
  const [settings, setSettingsState] = useState(getSettings());
  const [name, setName] = useState(settings.name);

  const saveName = () => {
    const trimmed = name.trim().slice(0, 14);
    if (trimmed.length < 2) return;
    updateSettings({ name: trimmed });
    setSettingsState(getSettings());
  };

  const start = (mode: LocalMode) => {
    unlockAudio();
    playClick();
    onStart(mode);
  };

  return (
    <div class="home">
      <div class="home-title">
        <h1 class="logo big">{T.appName}</h1>
        <p class="tagline">{T.home.tagline}</p>
      </div>

      <section class="home-sheet">
        {!settings.name ? (
          <form
            class="name-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveName();
            }}
          >
            <label>{T.home.namePrompt}</label>
            <input
              value={name}
              maxLength={14}
              placeholder={T.home.namePlaceholder}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              autoComplete="nickname"
              enterKeyHint="done"
            />
            <button class="btn primary" type="submit" disabled={name.trim().length < 2}>
              {T.home.nameOk}
            </button>
          </form>
        ) : (
          <>
            <div class="home-greeting">
              <span>{T.home.greeting(settings.name)}</span>
              <button class="btn small ghost" onClick={onSettings}>
                {T.home.settings}
              </button>
            </div>

            {online && (
              <button
                class={`btn big-btn ${online.onClick ? 'primary' : ''}`}
                disabled={!online.onClick}
                onClick={() => {
                  unlockAudio();
                  online.onClick?.();
                }}
              >
                <span>{online.label}</span>
                {online.sub && <small>{online.sub}</small>}
              </button>
            )}

            <div class="section-label">{T.home.offline}</div>
            <button class="btn big-btn" onClick={() => start('duel')}>
              <span>{T.home.duelBot}</span>
              <small>{T.home.duelBotSub}</small>
            </button>
            <div class="tile-grid">
              <button class="btn" onClick={() => start('practiceRunner')}>
                {T.home.practiceRunner}
              </button>
              <button class="btn" onClick={() => start('practiceSniper')}>
                {T.home.practiceSniper}
              </button>
            </div>
            <button class="btn" onClick={() => start('classic')}>
              {T.home.classicBot} <small class="muted">· {T.home.classicBotSub}</small>
            </button>
            <div class="level-row">
              <span class="muted">{T.home.level}</span>
              {LEVELS.map((l) => (
                <button
                  key={l}
                  class={`btn small ${settings.botLevel === l ? 'on' : ''}`}
                  onClick={() => {
                    updateSettings({ botLevel: l });
                    setSettingsState(getSettings());
                  }}
                >
                  {T.home.levels[l]}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
