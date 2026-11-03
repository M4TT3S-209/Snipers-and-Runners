/**
 * Prozedurale Sounds mit der Web-Audio-API – keine Audiodateien, keine Lizenzen.
 *
 * iOS: Der AudioContext darf erst nach dem ersten Tipp starten → unlockAudio()
 * in einem Touch-/Klick-Handler aufrufen. Der Stummschalter am iPhone schaltet
 * Web-Audio normalerweise stumm; mit setIgnoreSilentSwitch(true) spielt der Ton
 * trotzdem (Audio Session API, Safari ≥ 16.4).
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

type AudioSessionType = 'auto' | 'playback' | 'ambient' | 'transient' | 'transient-solo' | 'play-and-record';
interface NavigatorWithAudioSession extends Navigator {
  audioSession?: { type: AudioSessionType };
}

export function audioSessionSupported(): boolean {
  return 'audioSession' in navigator;
}

export function setIgnoreSilentSwitch(ignore: boolean): void {
  const nav = navigator as NavigatorWithAudioSession;
  if (nav.audioSession) nav.audioSession.type = ignore ? 'playback' : 'ambient';
}

/** Im ersten Touch-/Klick-Handler aufrufen. Mehrfaches Aufrufen schadet nicht. */
export function unlockAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    noiseBuffer = makeNoise(ctx);
  }
  if (ctx.state !== 'running') void ctx.resume();
}

function makeNoise(c: AudioContext): AudioBuffer {
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function ready(): { c: AudioContext; out: GainNode } | null {
  if (!ctx || !master || ctx.state !== 'running') return null;
  return { c: ctx, out: master };
}

/** Comic-„Peng“: kurzes Rauschen + fallender Ton. */
export function playShot(): void {
  const a = ready();
  if (!a || !noiseBuffer) return;
  const { c, out } = a;
  const t = c.currentTime;

  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(1800, t);
  band.frequency.exponentialRampToValueAtTime(400, t + 0.15);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.9, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  noise.connect(band).connect(ng).connect(out);
  noise.start(t);
  noise.stop(t + 0.2);

  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.16);
  const og = c.createGain();
  og.gain.setValueAtTime(0.35, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 0.18);
}

/** Glitzern des Zielfernrohrs: hohes „Ting“ mit Schimmer. */
export function playGlint(): void {
  const a = ready();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  for (const [freq, delay] of [
    [2637, 0],
    [3520, 0.05],
    [4186, 0.1],
  ] as const) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t + delay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(0.25, t + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.35);
    osc.connect(g).connect(out);
    osc.start(t + delay);
    osc.stop(t + delay + 0.4);
  }
}

/** Kurzer Piepton (Countdown, UI). */
export function playBeep(freq = 880, duration = 0.08): void {
  const a = ready();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}
