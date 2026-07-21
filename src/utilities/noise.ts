/*
 * Noise utility for Jelly UI — a dependency-free 2D simplex-noise source
 * that follows the same multi-channel / Quantize pattern as the website's
 * Staccato noise system.  Components sample independent channels at
 * different rates so amplitude, phase, and morph evolve asynchronously,
 * creating organic, non-repeating motion.
 *
 *   import { jellyNoise, jellyQuantize } from '../utilities/noise.js';
 *   const force = jellyQuantize(
 *     jellyNoise(time * SPEED,          elIndex * 101), 6);
 *   const phase = jellyQuantize(
 *     jellyNoise(time * SPEED * 0.18,   elIndex * 203), 4);
 *   const morph = jellyQuantize(
 *     jellyNoise(time * SPEED * 0.25,   elIndex * 307), 5);
 */

// ── 2D Simplex (self-contained, no npm dep) ────────────────────────
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD3: [number, number][] = [
  [ 1,  1], [-1,  1], [ 1, -1], [-1, -1],
  [ 1,  0], [-1,  0], [ 1,  0], [-1,  0],
  [ 0,  1], [ 0, -1], [ 0,  1], [ 0, -1],
];

let _perm: Uint8Array;
let _permMod12: Uint8Array;

function buildPerm(): void {
  _perm = new Uint8Array(512);
  _permMod12 = new Uint8Array(512);
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 42;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807 + 0) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) {
    _perm[i] = p[i & 255];
    _permMod12[i] = _perm[i] % 12;
  }
}

function dot2(g: [number, number], x: number, y: number): number {
  return g[0] * x + g[1] * y;
}

/** Simplex noise value in [-1, 1].  Deterministic for the same (x, y). */
export function jellyNoise(x: number, y: number): number {
  if (!_perm) buildPerm();

  const s  = (x + y) * F2;
  const i  = Math.floor(x + s);
  const j  = Math.floor(y + s);
  const t  = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = x - X0;
  const y0 = y - Y0;

  let i1: number, j1: number;
  if (x0 > y0) { i1 = 1; j1 = 0; }
  else         { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1  + 2 * G2;
  const y2 = y0 - 1  + 2 * G2;

  const ii  = i & 255;
  const jj  = j & 255;
  const gi0 = _permMod12[ii      + _perm[jj     ]];
  const gi1 = _permMod12[ii + i1 + _perm[jj + j1]];
  const gi2 = _permMod12[ii + 1  + _perm[jj + 1 ]];

  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * dot2(GRAD3[gi0], x0, y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * dot2(GRAD3[gi1], x1, y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * dot2(GRAD3[gi2], x2, y2); }

  return 70 * (n0 + n1 + n2);
}

// ── Quantize (matching Staccato) ────────────────────────────────────

/**
 * Quantize a continuous value into discrete levels.
 *   Quantize(value, step) => Math.floor(value * step) / step
 *
 * For a value in [-1, 1] with `steps = 6`, the result is one of 7
 * equally-spaced levels.
 */
export function jellyQuantize(value: number, steps: number): number {
  return Math.floor(value * steps) / steps;
}

// ── Multi-channel hover preset ──────────────────────────────────────

/** Base noise speed matching Staccato (0.0001). */
export const HOVER_NOISE_SPEED = 0.0001;

interface HoverChannels {
  /** 6-level quantized force [0, 1] — drives membrane bulge amplitude. */
  force: number;
  /** 4-level quantized phase [-1, 1] — biases the spread toward one side. */
  phase: number;
  /** 5-level quantized morph [0, 1] — spreads or tightens the bulge. */
  morph: number;
}

/**
 * Sample all three noise channels for one frame.  Each channel uses a
 * different Y-offset and relative speed so they evolve asynchronously
 * (the same way the website's Staccato Phase/Color/Morph channels do).
 */
export function jellyHoverChannels(
  time: number,
  elIndex: number,
): HoverChannels {
  const s = HOVER_NOISE_SPEED;
  const i = elIndex;

  const rawForce = jellyNoise(time * s,            i * 101);
  const rawPhase = jellyNoise(time * s * 0.18,     i * 203);
  const rawMorph = jellyNoise(time * s * 0.25,     i * 307);

  return {
    force: jellyQuantize(rawForce, 6),
    phase: jellyQuantize(rawPhase, 4),
    morph: jellyQuantize(rawMorph, 5),
  };
}
