import { useEffect, useState } from 'preact/hooks';
import type { GameHost, HudSnapshot } from '../../game/GameHost';

/** Liefert ~11× pro Sekunde den aktuellen Spielzustand für die Anzeige. */
export function useHud(host: GameHost): HudSnapshot | null {
  const [snap, setSnap] = useState<HudSnapshot | null>(null);
  useEffect(() => host.onHud(setSnap), [host]);
  return snap;
}
