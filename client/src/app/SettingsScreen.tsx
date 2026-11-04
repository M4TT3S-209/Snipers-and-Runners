import { useState } from 'preact/hooks';
import { formatTag } from '@scope-rush/shared';
import { T } from '../i18n/de';
import type { HubClient } from '../account/HubClient';
import { useHubOrNull } from './useHub';
import { QrCode } from './QrCode';
import { appLink } from './share';
import { audioSessionSupported, setIgnoreSilentSwitch, setVolume } from '../audio/synth';
import { requestGyroPermission } from '../input/sniperControls';
import { getSettings, updateSettings, type Settings } from './settings';

export function SettingsScreen({ hub, onBack, onDeviceTest }: { hub: HubClient | null; onBack: () => void; onDeviceTest: () => void }) {
  const [s, setS] = useState<Settings>(getSettings());
  const [gyroMsg, setGyroMsg] = useState('');
  const hubState = useHubOrNull(hub);
  const account = hubState && typeof hubState.account === 'object' ? hubState.account : null;
  const [code, setCode] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const set = (patch: Partial<Settings>) => {
    updateSettings(patch);
    setS(getSettings());
  };

  return (
    <div class="settings-screen">
      <h1>{T.settings.title}</h1>
      <div class="settings-list" data-scroll>
        {account ? (
          <div class="setting">
            <span>{T.account.tag}</span>
            <b class="tag">{formatTag(account)}</b>
            <label class="inline-edit">
              <input
                value={s.name}
                maxLength={14}
                onChange={(e) => {
                  const n = (e.target as HTMLInputElement).value.trim().slice(0, 14);
                  if (n.length >= 2 && n !== account.name) {
                    set({ name: n });
                    hub?.rename(n);
                  }
                }}
              />
              <small class="muted">{T.account.rename}</small>
            </label>
            <button
              class={`btn small ${showTransfer ? 'on' : ''}`}
              onClick={() => {
                if (!showTransfer) hub?.createTransfer();
                setShowTransfer(!showTransfer);
              }}
            >
              {T.account.transfer}
            </button>
            {showTransfer && hubState?.transfer && (
              <div class="qr-box">
                <small class="muted">{T.account.transferHint}</small>
                <QrCode text={appLink({ transfer: hubState.transfer.code })} size={190} />
                <b class="code">{hubState.transfer.code}</b>
              </div>
            )}
          </div>
        ) : (
          <label class="setting">
            <span>{hub ? T.settings.name : T.account.offlineName}</span>
            <input value={s.name} maxLength={14} onChange={(e) => set({ name: (e.target as HTMLInputElement).value.trim().slice(0, 14) })} />
          </label>
        )}

        {hub && !account && (
          <form
            class="setting"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim().length >= 8) hub.redeemTransfer(code.trim());
            }}
          >
            <span>{T.account.redeem}</span>
            <input value={code} placeholder={T.account.redeemPlaceholder} autoCapitalize="characters" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            <button class="btn small primary" type="submit" disabled={code.trim().length < 8}>
              {T.account.redeemButton}
            </button>
          </form>
        )}

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
