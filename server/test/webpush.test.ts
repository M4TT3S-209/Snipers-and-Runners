import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  generateVapidKeys,
  isAllowedEndpoint,
  vapidAuthorization,
} from '../src/push/webpush';

const enc = new TextEncoder();
const dec = new TextDecoder();
type Bytes = Uint8Array<ArrayBuffer>;
const B = (u: Uint8Array): Bytes => new Uint8Array(u);

/** Privaten P-256-Schlüssel aus d + öffentlichem Punkt (unkomprimiert) laden */
async function importEcPrivate(d: string, pub: string, alg: 'ECDH' | 'ECDSA'): Promise<CryptoKeyPair> {
  const p = b64urlDecode(pub);
  const x = b64urlEncode(p.slice(1, 33));
  const y = b64urlEncode(p.slice(33, 65));
  const usages: KeyUsage[] = alg === 'ECDH' ? ['deriveBits'] : ['sign'];
  const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d, x, y, ext: true }, { name: alg, namedCurve: 'P-256' }, true, usages);
  const publicKey = await crypto.subtle.importKey('raw', p, { name: alg, namedCurve: 'P-256' }, true, alg === 'ECDH' ? [] : ['verify']);
  return { privateKey, publicKey };
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, len: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** Unabhängige Entschlüsselung (Empfängerseite) nach RFC 8291 */
async function decryptPayload(body: Bytes, uaPrivate: CryptoKey, uaPublicB64: string, authB64: string): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const uaPublic = b64urlDecode(uaPublicB64);
  const info: Bytes = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(B(b64urlDecode(authB64)), secret, info, 32);
  const cek = await hkdf(salt, ikm, B(enc.encode('Content-Encoding: aes128gcm\0')), 16);
  const nonce = await hkdf(salt, ikm, B(enc.encode('Content-Encoding: nonce\0')), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain.at(-1)).toBe(2);
  return dec.decode(plain.slice(0, -1));
}

describe('Web Push: Verschlüsselung (RFC 8291)', () => {
  it('Hin und zurück: Gerät kann die Nachricht entschlüsseln', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer));
    const auth = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const msg = JSON.stringify({ title: 'Max fordert dich heraus!', body: 'Tippe zum Annehmen' });
    const body = await encryptPayload({ p256dh: uaPublic, auth }, B(enc.encode(msg)));
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(await decryptPayload(body, ua.privateKey, uaPublic, auth)).toBe(msg);
  });

  it('entspricht dem Beispiel aus RFC 8291, Anhang A', async () => {
    const asKeys = await importEcPrivate(
      'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
      'ECDH',
    );
    const uaPublic = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
    const body = await encryptPayload(
      { p256dh: uaPublic, auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      B(enc.encode('When I grow up, I want to be a watermelon')),
      { salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'), senderKeys: asKeys },
    );
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });
});

describe('Web Push: VAPID', () => {
  it('JWT ist mit dem öffentlichen Schlüssel prüfbar und enthält aud/sub', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH...', keys, 'https://example.org/', 1_800_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).not.toBeNull();
    const claims = JSON.parse(dec.decode(b64urlDecode(m[2]!))) as { aud: string; sub: string; exp: number };
    expect(claims.aud).toBe('https://web.push.apple.com');
    expect(claims.sub).toBe('https://example.org/');
    expect(m[4]).toBe(keys.publicKey);
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(m[3]!), B(enc.encode(`${m[1]}.${m[2]}`)));
    expect(ok).toBe(true);
  });

  it('nur bekannte Push-Dienste', () => {
    expect(isAllowedEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedEndpoint('https://evil.example/x')).toBe(false);
    expect(isAllowedEndpoint('http://web.push.apple.com/abc')).toBe(false);
  });
});
