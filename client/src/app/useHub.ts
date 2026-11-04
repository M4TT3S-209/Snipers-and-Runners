import { useEffect, useState } from 'preact/hooks';
import type { HubClient, HubState } from '../account/HubClient';

/** Aktueller Hub-Zustand – rendert bei jeder Änderung neu. */
export function useHub(hub: HubClient): HubState {
  const [state, setState] = useState(hub.state);
  useEffect(() => {
    setState(hub.state);
    return hub.on((e) => {
      if (e.t === 'state') setState(hub.state);
    });
  }, [hub]);
  return state;
}

/** Wie useHub, aber ohne Hub (kein Server) → null */
export function useHubOrNull(hub: HubClient | null): HubState | null {
  const [state, setState] = useState(hub?.state ?? null);
  useEffect(() => {
    if (!hub) return;
    setState(hub.state);
    return hub.on((e) => {
      if (e.t === 'state') setState(hub.state);
    });
  }, [hub]);
  return state;
}
