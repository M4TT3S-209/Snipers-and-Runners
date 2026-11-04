import { useState } from 'preact/hooks';
import { T } from '../i18n/de';
import { audioSessionSupported, setIgnoreSilentSwitch, setVolume } from '../audio/synth';
import { requestGyroPermission } from '../input/sniperControls';
import { getSettings, updateSettings, type Settings } from './settings';

export function SettingsScreen({ onBack, onDeviceTest }: { onBack: () => void; onDeviceTest: () => void }) {
  const [s, setS] = useState<Settings>(getSettings());
  const [gyroMsg, setGyroMsg] = useState('');
  const set = (patch: Partial<Settings>) => {
    updateSettings(patch);
    setS(getSettings());
  };

  return (
    <div class="settings-screen">
      <h1>{T.settings.title}</h1>
      <div class="settings-list" data-scroll>
        <label class="setting">
          <span>{T.settings.name}</span>
          <input value={s.name} maxLength={14} onChange={(e) => set({ name: (e.target as HTMLInputElement).value.trim().slice(0, 14) })} />
        </label>

        <label class="setting">
          <span>
            {T.settings.sensitivity}: <b>{s.sensitivity.toFixed(2).replace('.', ',')}</b>
          </span>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.05}
            value={s.sensitivity}
            onInput={(e) => set({ sensitivity: Number((e.target as HTMLInputElement).value) })}
          />
        </label>

        <div class="setting">
          <span>{T.settings.fireMode}</span>
          <div class="seg">
            <button class={`btn small ${s.fireMode === 'button' ? 'on' : ''}`} onClick={() => set({ fireMode: 'button' })}>
              {T.settings.fireButton}
            </button>
            <button class={`btn small ${s.fireMode === 'release' ? 'on' : ''}`} onClick={() => set({ fireMode: 'release' })}>
              {T.settings.fireRelease}
            </button>
          </div>
        </div>

        <div class="setting">
          <span>{T.settings.gyro}</span>
          <button
            class={`btn small ${s.gyro ? 'on' : ''}`}
            onClick={async () => {
              if (s.gyro) {
                set({ gyro: false });
                return;
              }
              const ok = await requestGyroPermission();
              if (ok) set({ gyro: true });
              else setGyroMsg(T.settings.gyroDenied);
            }}
          >
            {s.gyro ? T.settings.on : T.settings.off}
          </button>
          {gyroMsg && <small class="bad">{gyroMsg}</small>}
        </div>

        <label class="setting">
          <span>
            {T.settings.volume}: <b>{Math.round(s.volume * 100)} %</b>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            onInput={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setVolume(v);
              set({ volume: v });
            }}
          />
        </label>

        {audioSessionSupported() && (
          <div class="setting">
            <span>{T.settings.silentSwitch}</span>
            <button
              class={`btn small ${s.ignoreSilentSwitch ? 'on' : ''}`}
              onClick={() => {
                setIgnoreSilentSwitch(!s.ignoreSilentSwitch);
                set({ ignoreSilentSwitch: !s.ignoreSilentSwitch });
              }}
            >
              {s.ignoreSilentSwitch ? T.settings.on : T.settings.off}
            </button>
          </div>
        )}

        <div class="setting">
          <span>{T.settings.showFps}</span>
          <button class={`btn small ${s.showFps ? 'on' : ''}`} onClick={() => set({ showFps: !s.showFps })}>
            {s.showFps ? T.settings.on : T.settings.off}
          </button>
        </div>

        <button class="btn" onClick={onDeviceTest}>
          🔧 {T.settings.deviceTest}
        </button>
        <small class="muted center">Version {__BUILD_ID__.slice(0, 7)}</small>
      </div>
      <button class="btn primary back-btn" onClick={onBack}>
        {T.settings.back}
      </button>
    </div>
  );
}
