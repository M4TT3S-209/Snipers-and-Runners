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
let volume = 0.8;

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

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume * 0.75;
}

/** Im ersten Touch-/Klick-Handler aufrufen. Mehrfaches Aufrufen schadet nicht. */
export function unlockAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volume * 0.75;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuffer = makeNoise(ctx);
  }
  if (ctx.state !== 'running') void ctx.resume();
}

function makeNoise(c: AudioContext): AudioBuffer {
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function ready(): { c: AudioContext; out: GainNode; t: number } | null {
  if (!ctx || !master || ctx.state !== 'running') return null;
  return { c: ctx, out: master, t: ctx.currentTime };
}

function env(c: AudioContext, peak: number, attack: number, decay: number, at: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

function tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, delay = 0): void {
  const a = ready();
  if (!a) return;
  const { c, out } = a;
  const t = a.t + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
  osc.connect(env(c, peak, attack, decay, t)).connect(out);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

function noise(filter: BiquadFilterType, f0: number, f1: number, peak: number, attack: number, decay: number, delay = 0, q = 1): void {
  const a = ready();
  if (!a || !noiseBuffer) return;
  const { c, out } = a;
  const t = a.t + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
  src.connect(f).connect(env(c, peak, attack, decay, t)).connect(out);
  src.start(t);
  src.stop(t + attack + decay + 0.05);
}

/** Comic-„Peng“ (nah = eigener Schuss, fern = Schuss vom Turm) */
export function playShot(near = true): void {
  if (near) {
    noise('bandpass', 2200, 300, 1, 0.004, 0.2, 0, 0.8);
    tone('square', 420, 55, 0.4, 0.004, 0.18);
  } else {
    noise('lowpass', 900, 200, 0.6, 0.01, 0.35);
    tone('sine', 160, 60, 0.3, 0.01, 0.3);
  }
}

export function playRocketLaunch(): void {
  noise('bandpass', 400, 1400, 0.7, 0.05, 0.5, 0, 2);
  tone('sawtooth', 120, 260, 0.15, 0.05, 0.45);
}

/** Zischen einer Kugel nah am Läufer vorbei */
export function playWhiz(): void {
  noise('bandpass', 5200, 1800, 0.35, 0.02, 0.18, 0, 6);
}

export function playGlint(): void {
  tone('sine', 2637, 2637, 0.2, 0.01, 0.3);
  tone('sine', 3520, 3520, 0.16, 0.01, 0.3, 0.05);
  tone('sine', 4186, 4186, 0.12, 0.01, 0.3, 0.1);
}

export function playBeep(freq = 880, duration = 0.08): void {
  tone('triangle', freq, freq, 0.3, 0.005, duration);
}

export function playClick(): void {
  tone('square', 1800, 1200, 0.08, 0.002, 0.03);
}

export function playReload(): void {
  tone('square', 700, 500, 0.12, 0.003, 0.04);
  tone('square', 1100, 900, 0.12, 0.003, 0.05, 0.12);
}

export function playHitBody(): void {
  tone('sine', 260, 90, 0.6, 0.005, 0.22);
  noise('lowpass', 1200, 300, 0.4, 0.004, 0.1);
}

export function playHitHead(): void {
  tone('sine', 600, 1400, 0.5, 0.005, 0.12);
  tone('sine', 1400, 300, 0.4, 0.005, 0.3, 0.12);
}

export function playShieldBlock(): void {
  tone('triangle', 1600, 1600, 0.35, 0.005, 0.4);
  tone('triangle', 2400, 2400, 0.2, 0.005, 0.35, 0.02);
}

export function playWood(): void {
  noise('bandpass', 900, 500, 0.6, 0.003, 0.12, 0, 3);
  tone('triangle', 220, 160, 0.2, 0.003, 0.1);
}

export function playBreak(): void {
  noise('bandpass', 1400, 300, 0.8, 0.004, 0.35, 0, 1.5);
  noise('bandpass', 700, 200, 0.5, 0.004, 0.25, 0.08, 2);
}

export function playExplosion(): void {
  noise('lowpass', 1800, 60, 1, 0.01, 0.9);
  tone('sine', 90, 35, 0.8, 0.01, 0.7);
}

export function playPop(): void {
  tone('sine', 900, 1800, 0.35, 0.003, 0.08);
  noise('highpass', 3000, 6000, 0.2, 0.003, 0.08);
}

export function playJump(): void {
  tone('square', 320, 640, 0.08, 0.005, 0.1);
}

export function playSlide(): void {
  noise('bandpass', 1200, 500, 0.25, 0.02, 0.25, 0, 1.2);
}

export function playLand(): void {
  noise('lowpass', 500, 150, 0.2, 0.003, 0.08);
}

export function playTrip(): void {
  tone('triangle', 500, 220, 0.25, 0.005, 0.25);
}

export function playFall(): void {
  tone('sine', 1200, 200, 0.25, 0.02, 0.8);
}

export function playPad(): void {
  tone('square', 200, 900, 0.15, 0.01, 0.3);
}

export function playGadget(): void {
  tone('triangle', 660, 990, 0.2, 0.01, 0.15);
  tone('triangle', 990, 1320, 0.15, 0.01, 0.15, 0.08);
}

export function playOut(): void {
  [523, 392, 330, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.25, 0.01, 0.18, i * 0.13));
}

export function playFanfare(): void {
  [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.01, i === 3 ? 0.5 : 0.14, i * 0.12));
}

export function playCountdown(final: boolean): void {
  if (final) tone('square', 1320, 1320, 0.18, 0.005, 0.35);
  else tone('square', 660, 660, 0.15, 0.005, 0.12);
}

export function playWin(): void {
  [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.01, 0.16, i * 0.11));
}

export function playLose(): void {
  [392, 370, 349, 330].forEach((f, i) => tone('sawtooth', f, f * 0.97, 0.12, 0.01, 0.25, i * 0.22));
}

/** Kompatibilität mit der Testseite (M0) */
export const playTestShot = () => playShot(true);
