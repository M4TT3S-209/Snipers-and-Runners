/**
 * Web Push ohne externe Dienste – nur WebCrypto (läuft im Worker und in Node):
 *  - Nachricht verschlüsseln nach RFC 8291 (aes128gcm)
 *  - Absender ausweisen per VAPID (RFC 8292, JWT mit ES256)
 */

export interface PushSubscriptionData {
  endpoint: string;
  /** Öffentlicher Schlüssel des Geräts (base64url, 65 Bytes unkomprimiert) */
  p256dh: string;
  /** Auth-Geheimnis des Geräts (base64url, 16 Bytes) */
  auth: string;
}

export interface VapidKeys {
  /** öffentlicher Schlüssel, base64url (65 Bytes) */
  publicKey: string;
  /** privater Schlüssel als JWK */
  privateJwk: JsonWebKey;
}

const enc = new TextEncoder();

/** Bytes auf einem echten ArrayBuffer (so will es WebCrypto) */
type Bytes = Uint8Array<ArrayBuffer>;

function bytes(text: string): Bytes {
  return new Uint8Array(enc.encode(text));
}

// ------------------------------------------------------------------ base64url

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Bytes {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ------------------------------------------------------------------ HKDF

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// ------------------------------------------------------------------ Schlüssel

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: b64urlEncode(raw), privateJwk };
}

// ------------------------------------------------------------------ Verschlüsselung (RFC 8291)

/**
 * Verschlüsselt `plaintext` für ein Gerät. `salt` und `senderPrivateJwk` sind
 * nur für Tests vorgebbar (sonst zufällig).
 */
export async function encryptPayload(
  sub: Pick<PushSubscriptionData, 'p256dh' | 'auth'>,
  plaintext: Bytes,
  opts: { salt?: Bytes; senderKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender = opts.senderKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', sender.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Standard-Name ist `public`; die Cloudflare-Typen nennen es `$public` → beide angeben
  const ecdhParams = { name: 'ECDH', public: uaKey, $public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, sender.privateKey, 256));

  const keyInfo = concat(bytes('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, bytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, bytes('Content-Encoding: nonce\0'), 12);

  const record = concat(plaintext, new Uint8Array([2])); // 0x02 = letzter Datensatz
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// ------------------------------------------------------------------ VAPID

export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSec: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(bytes(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(bytes(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: subject })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto liefert die Signatur schon im JWS-Format (r||s, 64 Bytes)
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

/** Nur bekannte Push-Dienste anschreiben (kein Missbrauch des Servers für beliebige Adressen) */
export function isAllowedEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname;
  return (
    h === 'web.push.apple.com' ||
    h.endsWith('.push.apple.com') ||
    h === 'fcm.googleapis.com' ||
    h === 'updates.push.services.mozilla.com' ||
    h.endsWith('.notify.windows.com')
  );
}

export type PushResult = 'ok' | 'gone' | 'error';

/** Schickt eine Benachrichtigung. 'gone' = Abo existiert nicht mehr → löschen. */
export async function sendPush(sub: PushSubscriptionData, payload: object, keys: VapidKeys, subject: string): Promise<PushResult> {
  if (!isAllowedEndpoint(sub.endpoint)) return 'gone';
  try {
    const body = await encryptPayload(sub, bytes(JSON.stringify(payload)));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, keys, subject, Math.floor(Date.now() / 1000)),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '300',
        Urgency: 'high',
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
