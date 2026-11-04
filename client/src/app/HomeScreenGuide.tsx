import { useEffect } from 'preact/hooks';
import { T } from '../i18n/de';

const STORAGE_KEY = 'rvs.a2hs.dismissed';

/** Darf die Anleitung automatisch erscheinen? (nur iPhone in Safari, nicht abgelehnt) */
export function shouldAutoShowGuide(ios: boolean, standalone: boolean): boolean {
  if (!ios || standalone) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

export function HomeScreenGuide({ onClose, onShow }: { onClose: () => void; onShow?: () => void }) {
  useEffect(() => onShow?.(), []);
  const dismissForever = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // privater Modus – egal
    }
    onClose();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="a2hs-title">
      <div class="modal">
        <h2 id="a2hs-title">{T.homeScreen.guideTitle}</h2>
        <p class="muted">{T.homeScreen.guideIntro}</p>
        <ol class="steps">
          {T.homeScreen.steps.map((step, i) => (
            <li key={i}>
              <span class="step-num">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div class="modal-actions">
          <button class="btn primary" onClick={onClose}>
            {T.homeScreen.close}
          </button>
          <button class="btn ghost" onClick={dismissForever}>
            {T.homeScreen.dontShowAgain}
          </button>
        </div>
      </div>
    </div>
  );
}
