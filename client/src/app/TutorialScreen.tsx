import { useEffect, useRef, useState } from 'preact/hooks';
import { T } from '../i18n/de';
import { playBeep, playFanfare, unlockAudio } from '../audio/synth';
import { attachGestures } from '../input/gestures';
import type { Gesture } from '../input/gestureRecognizer';
import { updateSettings } from './settings';

/** Kurzes Mitmach-Tutorial: Gesten selbst ausprobieren, dann Grundregeln. */
export function TutorialScreen({ onDone, onPractice }: { onDone: () => void; onPractice: (role: 'runner' | 'sniper') => void }) {
  const steps = T.tutorial.steps;
  const [i, setI] = useState(0);
  const [ok, setOk] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);
  const step = steps[i]!;
  const last = i === steps.length - 1;

  useEffect(() => {
    const pad = padRef.current;
    if (!pad || !step.wait) return;
    setOk(false);
    return attachGestures(pad, (g: Gesture) => {
      unlockAudio();
      if (g === step.wait) {
        playBeep(990, 0.08);
        setOk(true);
        setTimeout(() => setI((n) => Math.min(n + 1, steps.length - 1)), 650);
      } else if (g !== 'holdEnd' && g !== 'tap') {
        playBeep(330, 0.06);
      }
    });
  }, [i]);

  const finish = () => {
    updateSettings({ seenTutorial: true });
    playFanfare();
  };

  return (
    <div class="tutorial">
      <div class="tutorial-card card">
        <div class="tutorial-progress">
          {steps.map((_, k) => (
            <span key={k} class={k <= i ? 'on' : ''} />
          ))}
        </div>
        <div class="tutorial-icon">{step.icon}</div>
        <h2>{step.title}</h2>
        <p class="center">{step.text}</p>
        {step.wait && (
          <div ref={padRef} class={`gesture-pad big ${ok ? 'ok' : ''}`} data-allow-touch>
            {ok ? T.tutorial.nice : <span class="muted">{T.tutorial.tryIt}</span>}
          </div>
        )}
        {!step.wait && !last && (
          <button class="btn primary big-btn" onClick={() => setI(i + 1)}>
            {T.tutorial.next}
          </button>
        )}
        {last && (
          <>
            <div class="tile-grid">
              <button
                class="btn primary"
                onClick={() => {
                  finish();
                  onPractice('runner');
                }}
              >
                {T.tutorial.practiceRunner}
              </button>
              <button
                class="btn primary"
                onClick={() => {
                  finish();
                  onPractice('sniper');
                }}
              >
                {T.tutorial.practiceSniper}
              </button>
            </div>
            <button
              class="btn"
              onClick={() => {
                finish();
                onDone();
              }}
            >
              {T.tutorial.done}
            </button>
          </>
        )}
      </div>
      {!last && (
        <button
          class="btn ghost skip-btn"
          onClick={() => {
            updateSettings({ seenTutorial: true });
            onDone();
          }}
        >
          {T.tutorial.skip}
        </button>
      )}
    </div>
  );
}
