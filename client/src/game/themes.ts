import type { ThemeId } from '@scope-rush/shared';

/** Farben und Deko je Strecken-Thema (alles prozedural, keine Dateien). */
export interface ThemeStyle {
  name: string;
  sky: [string, string, string];
  fog: number;
  ground: number;
  track: number;
  trackAlt: number;
  line: number;
  curb: number;
  pit: number;
  deco: 'tree' | 'cactus' | 'iceberg' | 'pillar' | 'lollipop';
  decoColors: number[];
  wall: number;
  crate: number;
  barrel: number;
  hurdle: number;
  pad: number;
  sinker: number;
}

export const THEME_STYLES: Record<ThemeId, ThemeStyle> = {
  meadow: {
    name: 'Wiese',
    sky: ['#4c6fff', '#8fb8ff', '#ffe2b8'],
    fog: 0xcfe0ff,
    ground: 0x6cc04a,
    track: 0xf4a259,
    trackAlt: 0xeb9446,
    line: 0xffffff,
    curb: 0xffffff,
    pit: 0x3b2a1e,
    deco: 'tree',
    decoColors: [0x3f9b3a, 0x57b947, 0x2e7d32],
    wall: 0x9aa5b1,
    crate: 0xd98b3a,
    barrel: 0xe63946,
    hurdle: 0x3046c8,
    pad: 0x39d0ff,
    sinker: 0x8e6bff,
  },
  desert: {
    name: 'Wüste',
    sky: ['#ff8a3d', '#ffc27a', '#fff0c9'],
    fog: 0xffe0b0,
    ground: 0xe8c07a,
    track: 0xc8664a,
    trackAlt: 0xb95a40,
    line: 0xfff3d6,
    curb: 0xfff3d6,
    pit: 0x5a3320,
    deco: 'cactus',
    decoColors: [0x4a9b4f, 0x5fb35e],
    wall: 0xc9a27a,
    crate: 0xb5793a,
    barrel: 0x2a9d8f,
    hurdle: 0xe63946,
    pad: 0xffd23f,
    sinker: 0x8a5a2b,
  },
  ice: {
    name: 'Eis',
    sky: ['#3a7bd5', '#9ad0ff', '#e8f6ff'],
    fog: 0xdff1ff,
    ground: 0xf1f8ff,
    track: 0x8fc9f0,
    trackAlt: 0x7fbbe6,
    line: 0xffffff,
    curb: 0x5aa0d8,
    pit: 0x1d3c5a,
    deco: 'iceberg',
    decoColors: [0xbfe6ff, 0xe3f4ff, 0x9fd4f7],
    wall: 0xb8d6ea,
    crate: 0x7aa7c7,
    barrel: 0xff6b6b,
    hurdle: 0x2c5f8a,
    pad: 0xff9f1c,
    sinker: 0x5aa0d8,
  },
  neon: {
    name: 'Neon-Stadt',
    sky: ['#120b2e', '#3a1a6b', '#ff4fa3'],
    fog: 0x2a1648,
    ground: 0x1b1433,
    track: 0x2b2b52,
    trackAlt: 0x323262,
    line: 0x39f3ff,
    curb: 0xff4fa3,
    pit: 0x050510,
    deco: 'pillar',
    decoColors: [0x39f3ff, 0xff4fa3, 0xa6ff4d],
    wall: 0x5a4a8a,
    crate: 0x3a86ff,
    barrel: 0xff4fa3,
    hurdle: 0xa6ff4d,
    pad: 0xffe14d,
    sinker: 0x39f3ff,
  },
  candy: {
    name: 'Süßwarenland',
    sky: ['#ff9ad5', '#ffc6e8', '#fff1d6'],
    fog: 0xffe0f0,
    ground: 0xb7f5c4,
    track: 0xff8fb8,
    trackAlt: 0xff7eac,
    line: 0xffffff,
    curb: 0xffffff,
    pit: 0x7a3b5a,
    deco: 'lollipop',
    decoColors: [0xff5d8f, 0x5dd3ff, 0xffd23f, 0x9b5de5],
    wall: 0xf9c6d9,
    crate: 0xffb347,
    barrel: 0x9b5de5,
    hurdle: 0x5dd3ff,
    pad: 0xffe14d,
    sinker: 0xff5d8f,
  },
};

/** Farben für Läufer-Figuren (Spieler 1–8) – Shirt, Hose, Mütze. */
export const RUNNER_PALETTES: Array<{ shirt: number; pants: number; cap: number }> = [
  { shirt: 0xff7a1a, pants: 0x3046c8, cap: 0xffd23f },
  { shirt: 0x2ec4b6, pants: 0x333366, cap: 0xff5d8f },
  { shirt: 0x9b5de5, pants: 0x222244, cap: 0x00f5d4 },
  { shirt: 0xf15bb5, pants: 0x3a3a3a, cap: 0xfee440 },
  { shirt: 0x80ed99, pants: 0x1d3557, cap: 0xe63946 },
  { shirt: 0xffd23f, pants: 0x6a4c93, cap: 0x1982c4 },
  { shirt: 0x1982c4, pants: 0x8ac926, cap: 0xff595e },
  { shirt: 0xff595e, pants: 0x264653, cap: 0xffffff },
];
