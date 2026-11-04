/**
 * Namensregeln: 2–14 Zeichen, Buchstaben (inkl. Umlaute), Ziffern, Leerzeichen,
 * Bindestrich, Unterstrich. Grobe Wörter werden abgelehnt – auch in
 * Schreibweisen wie „4rschl0ch“.
 */
const ALLOWED = /^[\p{L}\p{N} _-]{2,14}$/u;

// Kurze, bewusst grobe Liste (deutsch/englisch). Erweiterbar.
const BLOCKED = [
  'arsch',
  'fick',
  'fuck',
  'hure',
  'nazi',
  'hitler',
  'fotze',
  'wichser',
  'schlampe',
  'nigg',
  'neger',
  'bitch',
  'cunt',
  'penis',
  'vagina',
  'porn',
  'sex',
  'spast',
  'behindert',
  'schwuchtel',
  'kanake',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' };

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[0-9@$]/g, (c) => LEET[c] ?? c)
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '');
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: 'length' | 'chars' | 'word' };

export function checkName(raw: string): NameCheck {
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 14) return { ok: false, reason: 'length' };
  if (!ALLOWED.test(name)) return { ok: false, reason: 'chars' };
  const flat = normalize(name);
  if (BLOCKED.some((w) => flat.includes(w))) return { ok: false, reason: 'word' };
  return { ok: true, name };
}
