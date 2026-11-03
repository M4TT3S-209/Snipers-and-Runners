/**
 * Verhindert typische iOS-Safari-Störungen im Spiel:
 *  - Pinch-Zoom (iOS ignoriert `user-scalable=no` in Safari)
 *  - Doppeltipp-Zoom
 *  - Gummiband-Scrollen
 *  - Lupe / Text-Markieren / Kontextmenü bei langem Drücken
 *
 * Ergänzt die CSS-Regeln in styles.css (touch-action, user-select, overscroll).
 */
export function installTouchGuards(): void {
  const prevent = (e: Event) => e.preventDefault();
  const opts: AddEventListenerOptions = { passive: false };

  // Safari-eigene Pinch-Events
  document.addEventListener('gesturestart', prevent, opts);
  document.addEventListener('gesturechange', prevent, opts);
  document.addEventListener('gestureend', prevent, opts);

  // Mehr-Finger-Bewegung und Scrollen außerhalb erlaubter Bereiche
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        return;
      }
      const target = e.target as Element | null;
      if (!target?.closest('[data-scroll]')) e.preventDefault();
    },
    opts,
  );

  // Doppeltipp-Zoom
  document.addEventListener('dblclick', prevent, opts);

  // Kontextmenü bei langem Drücken
  document.addEventListener('contextmenu', prevent, opts);

  // Lupe/Markieren: Langes Drücken auf Nicht-Bedienelementen abfangen.
  document.addEventListener(
    'touchstart',
    (e) => {
      const target = e.target as Element | null;
      if (target?.closest('button, input, label, a, select, textarea, [data-allow-touch], [data-scroll]')) return;
      e.preventDefault();
    },
    opts,
  );
}
