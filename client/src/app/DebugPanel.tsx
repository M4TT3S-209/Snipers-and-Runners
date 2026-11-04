import { useState } from 'preact/hooks';
import { CONFIG } from '@scope-rush/shared';

/**
 * Regler-Panel (?debug=1): Balancing-Werte live verändern – nur offline.
 * „Werte kopieren“ legt die geänderten Werte in die Zwischenablage, damit
 * sie in shared/src/config.ts übernommen werden können.
 */
type Param = [path: string, label: string, min: number, max: number, step: number];

const PARAMS: Param[] = [
  ['runner.speed', 'Lauftempo (m/s)', 4, 11, 0.1],
  ['runner.jumpHeight', 'Sprunghöhe (m)', 0.8, 2.4, 0.05],
  ['runner.jumpAirS', 'Sprungdauer (s)', 0.35, 1, 0.01],
  ['runner.laneChangeS', 'Spurwechsel (s)', 0.06, 0.4, 0.01],
  ['runner.stumbleS', 'Stolpern (s)', 0, 1.5, 0.05],
  ['weapons.precision.speed', 'Präzision: Kugel (m/s)', 50, 500, 5],
  ['weapons.precision.reloadS', 'Präzision: Nachladen (s)', 0.4, 4, 0.1],
  ['weapons.semi.speed', 'Halbauto: Kugel (m/s)', 50, 500, 5],
  ['weapons.semi.reloadS', 'Halbauto: Nachladen (s)', 0.4, 5, 0.1],
  ['weapons.rocket.speed', 'Rakete (m/s)', 15, 150, 1],
  ['weapons.rocket.splashR', 'Rakete: Radius (m)', 0.5, 6, 0.1],
  ['scope.dragDegPerPx', 'Ziel-Empfindlichkeit', 0.03, 0.35, 0.005],
  ['scope.swayDeg.1', 'Wackeln Zoom 1 (°)', 0, 0.6, 0.01],
  ['scope.swayDeg.2', 'Wackeln Zoom 2 (°)', 0, 0.8, 0.01],
  ['scope.swayDeg.3', 'Wackeln Zoom 3 (°)', 0, 1.2, 0.01],
  ['bots.sniper.medium.aimErrorDeg', 'Bot-Sniper (mittel): Streuung (°)', 0, 3, 0.05],
  ['bots.sniper.medium.aimS', 'Bot-Sniper (mittel): Zielzeit (s)', 0.2, 3, 0.05],
  ['bots.sniper.medium.leadSkill', 'Bot-Sniper (mittel): Vorhalt', 0, 1.2, 0.05],
  ['gadgets.smoke.durationS', 'Rauch (s)', 0.5, 8, 0.1],
  ['gadgets.sprint.factor', 'Sprint-Faktor', 1, 2.5, 0.05],
];

const original = new Map<string, number>();

function getPath(path: string): number {
  let o: unknown = CONFIG;
  for (const key of path.split('.')) o = (o as Record<string, unknown>)[key];
  return Number(o);
}

function setPath(path: string, value: number): void {
  const keys = path.split('.');
  let o: unknown = CONFIG;
  for (const key of keys.slice(0, -1)) o = (o as Record<string, unknown>)[key];
  (o as Record<string, number>)[keys.at(-1)!] = value;
}

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);

  if (!open) {
    return (
      <button class="btn small debug-toggle" onClick={() => setOpen(true)}>
        🛠
      </button>
    );
  }

  const changed = PARAMS.filter(([p]) => original.has(p) && original.get(p) !== getPath(p));
  const copy = async () => {
    const text = changed.map(([p]) => `${p} = ${getPath(p)}`).join('\n') || '(nichts geändert)';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      prompt('Werte:', text);
    }
  };

  return (
    <div class="debug-panel" data-scroll>
      <div class="debug-head">
        <b>Balancing (offline)</b>
        <button class="btn small" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      {PARAMS.map(([path, label, min, max, step]) => {
        const value = getPath(path);
        return (
          <label key={path} class="debug-row">
            <span>
              {label}: <b>{Number(value.toFixed(3))}</b>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onInput={(e) => {
                if (!original.has(path)) original.set(path, value);
                setPath(path, Number((e.target as HTMLInputElement).value));
                force((n) => n + 1);
              }}
            />
          </label>
        );
      })}
      <button class="btn small" onClick={() => void copy()}>
        {copied ? '✔ kopiert' : `Werte kopieren (${changed.length})`}
      </button>
    </div>
  );
}
