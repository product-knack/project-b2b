// Design tokens extracted from the "Trainer Hub" Claude Design prototype.
export const C = {
  // brand / accent
  orange: '#F47A2A',
  orangeGradA: '#FB8B3A',
  orangeGradB: '#EE5E16',
  // status
  green: '#57C98A',
  red: '#E76A52',
  blue: '#7C8FE8',
  purple: '#9A7BEA',
  purpleDeep: '#6E5BD0',
  gold: '#E0A53C',
  // surfaces
  bg: '#080606',
  panel: '#12100E',
  drawerBg: '#0C0908',
  sheetBg: '#0E0A09',
  // text
  white: '#ffffff',
  ink: '#EDE8E2',
  ink2: '#D8D2CC',
  ink3: '#C8C2BC',
  muted: '#9A938C',
  muted2: '#8A847E',
  muted3: '#7C766F',
  faint: '#6E6862',
  faint2: '#5C5650',
  // mono label browns
  mono: '#8A6A4E',
  mono2: '#9A6B45',
} as const;

// The gradient stops for the signature orange fill.
export const ORANGE_GRAD: [string, string] = [C.orangeGradA, C.orangeGradB];

// Card gradient (warm dark brown → near-black), the workhorse surface.
export const cardGrad = (a = 'rgba(56,34,21,0.42)', b = 'rgba(20,16,15,0.5)'): [string, string] => [a, b];
export const CARD_BORDER = 'rgba(255,150,90,0.1)';

// Brand type system — Geogrotesque (Emtype) everywhere; Gradvis-Regular is the
// intended display face for the serif/hero slots once its file is added
// (see App.tsx). TRIAL fonts in use: license both before commercial release.
export const F = {
  // Display / hero headlines — swap to 'Gradvis-Regular' when the font lands.
  serif: 'Geogrotesque-Bold',
  serifSemi: 'Geogrotesque-SemiBold',
  // UI / body text
  body: 'Geogrotesque-Medium',
  bodyReg: 'Geogrotesque-Regular',
  bodyBold: 'Geogrotesque-Bold',
  bodySemi: 'Geogrotesque-SemiBold',
  bodyLight: 'Geogrotesque-Light',
  italic: 'Geogrotesque-Italic',
  // Tabular/label slots (formerly JetBrains Mono) — spec: one sans family app-wide.
  mono: 'Geogrotesque-Medium',
  monoReg: 'Geogrotesque-Regular',
} as const;

// hex + alpha helper (mirrors the prototype's hexA())
export function hexA(hex: string, a: number): string {
  // Defensive: only #RGB / #RRGGBB inputs can be alpha-composited. Anything else
  // (an already-rgba string, a named color, or undefined) must pass through or
  // fall back — never become `rgba(NaN,NaN,NaN,a)`, which RN/SVG reject as an
  // invalid color and surface as a "render error: color" crash.
  if (typeof hex !== 'string' || hex[0] !== '#') {
    return typeof hex === 'string' && hex ? hex : `rgba(255,255,255,${a})`;
  }
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join(''); // #abc → #aabbcc
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const tones: Record<string, string> = {
  red: C.red,
  amber: C.gold,
  green: C.green,
  blue: C.blue,
  gold: C.gold,
  purple: C.purple,
  orange: C.orange,
};
