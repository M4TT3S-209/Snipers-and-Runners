import { describe, expect, it } from 'vitest';
import { resolveServerUrl, toWebSocketUrl } from '../src/net/serverUrl';
import { LagQueue, parseLagSettings } from '../src/net/lagSim';

const PAGES = { protocol: 'https:', hostname: 'm4tt3s-209.github.io' };
const LOCAL = { protocol: 'http:', hostname: 'localhost' };

describe('resolveServerUrl', () => {
  it('nimmt die Build-Adresse auf GitHub Pages', () => {
    expect(resolveServerUrl('', 'https://rvs.example.workers.dev/', PAGES)).toBe('https://rvs.example.workers.dev');
  });

  it('?server= hat Vorrang', () => {
    expect(resolveServerUrl('?server=http://localhost:8787', 'https://x.workers.dev', PAGES)).toBe('http://localhost:8787');
  });

  it('lokal ohne Angabe → Port 8787 auf demselben Rechner', () => {
    expect(resolveServerUrl('', undefined, LOCAL)).toBe('http://localhost:8787');
    expect(resolveServerUrl('', '', { protocol: 'http:', hostname: '192.168.0.12' })).toBe('http://192.168.0.12:8787');
  });

  it('ohne Server-Adresse auf GitHub Pages → kein Server', () => {
    expect(resolveServerUrl('', '', PAGES)).toBeNull();
    expect(resolveServerUrl('?server=javascript:alert(1)', undefined, PAGES)).toBeNull();
  });

  it('wandelt http in ws um', () => {
    expect(toWebSocketUrl('https://a.workers.dev', '/hub?v=1')).toBe('wss://a.workers.dev/hub?v=1');
    expect(toWebSocketUrl('http://localhost:8787', '/hub')).toBe('ws://localhost:8787/hub');
  });
});

describe('Lag-Simulator', () => {
  it('liest die URL-Parameter', () => {
    expect(parseLagSettings('')).toBeNull();
    expect(parseLagSettings('?lag=150&jitter=40')).toEqual({ lag: 150, jitter: 40, spikePercent: 0 });
  });

  it('hält die Reihenfolge ein, auch bei Schwankung', () => {
    let now = 0;
    const randoms = [1, 0.9, 0, 0.9, 0.5, 0.9]; // 1. Nachricht +jitter, 2. −jitter …
    let i = 0;
    const q = new LagQueue(
      { lag: 100, jitter: 50, spikePercent: 0 },
      () => randoms[i++ % randoms.length] ?? 0,
      () => now,
      () => {},
    );
    const t1 = q.nextDeliveryTime(); // 100 + 50
    now = 1;
    const t2 = q.nextDeliveryTime(); // wäre 1 + 50 → muss nach t1 bleiben
    now = 2;
    const t3 = q.nextDeliveryTime();
    expect(t1).toBe(150);
    expect(t2).toBeGreaterThanOrEqual(t1);
    expect(t3).toBeGreaterThanOrEqual(t2);
  });
});
