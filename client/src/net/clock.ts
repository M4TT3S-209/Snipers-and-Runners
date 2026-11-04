/**
 * Uhr-Abgleich mit dem Server (NTP-artig):
 *   offset = Serverzeit − (Sendezeit + Laufzeit/2)
 * Wir merken uns die Proben mit der kürzesten Laufzeit – die sind am genauesten.
 */
export class ClockSync {
  private samples: Array<{ rtt: number; offset: number }> = [];
  offset = 0;
  rtt = 150;
  private hasSample = false;

  addSample(clientSent: number, serverTime: number, clientNow: number): void {
    const rtt = Math.max(0, clientNow - clientSent);
    const offset = serverTime - (clientSent + rtt / 2);
    this.samples.push({ rtt, offset });
    if (this.samples.length > 12) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
    const newOffset = best.reduce((s, x) => s + x.offset, 0) / best.length;
    // Sprünge vermeiden: neuen Wert weich übernehmen (außer beim ersten Mal)
    this.offset = this.hasSample ? this.offset + (newOffset - this.offset) * 0.3 : newOffset;
    this.hasSample = true;
    const median = sorted[Math.floor(sorted.length / 2)]!.rtt;
    this.rtt = median;
  }

  get ready(): boolean {
    return this.hasSample;
  }

  serverNow(clientNow: number = performance.now()): number {
    return clientNow + this.offset;
  }
}
