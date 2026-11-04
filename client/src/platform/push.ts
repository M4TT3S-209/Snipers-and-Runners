import type { HubClient } from '../account/HubClient';
import { isIOS, isStandalone } from './device';

/**
 * Push-Benachrichtigungen (Herausforderung kommt an, auch wenn die App zu ist).
 * iOS: nur in der Home-Bildschirm-App (ab iOS 16.4), Erlaubnis nur nach Tippen.
 */
export type PushResult = 'ok' | 'denied' | 'unsupported' | 'needsApp' | 'error';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushNeedsHomeScreen(): boolean {
  return isIOS() && !isStandalone();
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Muss direkt aus einem Tipp heraus aufgerufen werden (iOS). */
export async function enablePush(hub: HubClient): Promise<PushResult> {
  if (pushNeedsHomeScreen()) return 'needsApp';
  if (!pushSupported()) return 'unsupported';
  // Erlaubnis zuerst fragen – iOS verlangt das direkt im Tipp-Handler
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const key = await hub.getPushKey();
    if (!key) return 'error';
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return 'error';
    hub.subscribePush(json.endpoint, json.keys.p256dh, json.keys.auth);
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function disablePush(hub: HubClient): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  hub.unsubscribePush(sub.endpoint);
  await sub.unsubscribe().catch(() => false);
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
