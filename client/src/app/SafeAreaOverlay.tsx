import { useEffect, useState } from 'preact/hooks';
import { T } from '../i18n/de';

/** Liest die Safe-Area-Abstände (Dynamic Island oben, Home-Leiste unten) in Pixeln. */
export function readSafeAreas(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const result = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return result;
}

export function useSafeAreas(): { top: number; bottom: number } {
  const [areas, setAreas] = useState(() => readSafeAreas());
  useEffect(() => {
    const update = () => setAreas(readSafeAreas());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return areas;
}

/** Färbt die Bereiche ein, in denen keine Bedienelemente liegen dürfen. */
export function SafeAreaOverlay() {
  const { top, bottom } = useSafeAreas();
  return (
    <div class="safe-overlay" aria-hidden="true">
      <div class="safe-top">{top > 0 ? `${Math.round(top)} px` : ''}</div>
      <div class="safe-bottom">{bottom > 0 ? `${Math.round(bottom)} px` : ''}</div>
      <div class="safe-left" />
      <div class="safe-right" />
      <div class="half-line">{T.safeArea.values(Math.round(top), Math.round(bottom))}</div>
    </div>
  );
}
