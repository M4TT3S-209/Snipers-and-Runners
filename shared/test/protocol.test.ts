import { describe, expect, it } from 'vitest';
import { parseClientMessage, MAX_MESSAGE_CHARS } from '../src/protocol/schemas';

describe('parseClientMessage (Server-Validierung)', () => {
  it('akzeptiert eine gültige Echo-Nachricht', () => {
    expect(parseClientMessage('{"t":"echo","c":123.5}')).toEqual({ t: 'echo', c: 123.5 });
  });

  it('lehnt kaputtes JSON ab', () => {
    expect(parseClientMessage('{nope')).toBeNull();
  });

  it('lehnt unbekannte Typen und falsche Felder ab', () => {
    expect(parseClientMessage('{"t":"hack"}')).toBeNull();
    expect(parseClientMessage('{"t":"echo","c":"x"}')).toBeNull();
    expect(parseClientMessage('{"t":"echo"}')).toBeNull();
  });

  it('lehnt Binärdaten und zu große Nachrichten ab', () => {
    expect(parseClientMessage(new ArrayBuffer(8))).toBeNull();
    expect(parseClientMessage('x'.repeat(MAX_MESSAGE_CHARS + 1))).toBeNull();
  });
});
