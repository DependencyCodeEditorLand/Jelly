/*
 * Noise utility for Jelly UI — a lightweight, dependency-free 2D simplex-noise
 * source that follows the same Quantize / time-driven pattern used by the
 * website's Staccato noise system.  Components that want organic,
 * non-repeating hover or idle variation import { jellyNoise } and call
 * jellyNoise(x, y) to get a value in [-1, 1].
 *
 *   import { jellyNoise, jellyQuantize } from '../utilities/noise.js';
 *   const level = jellyQuantize(jellyNoise(time * 0.5, index * 1.7), 5);
 *
 * The 2D simplex implementation is a minimal, self-contained port (public
 * domain / unlicense) — no external npm dependency, so it bundles cleanly
 * even when Vite library mode externalises node_modules.
 */

// ── permuted corner contribution ────────────────────────────────
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD3: [number, number][] = [
  [ 1,  1], [-1,  1], [ 1, -1], [-1, -1],
  [ 1,  0], [-1,  0], [ 1,  0], [-1,  0],
  [ 0,  1], [ 0, -1], [ 0,  1], [ 0, -1],
];

// Standard permutation table, shuffled once at init
let _perm: Uint8Array;
let _permMod12: Uint8Array;

function buildPerm(): void {
  _perm = new Uint8Array(512);
  _permMod12 = new Uint8Array(512);
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with deterministic seed 42
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

/** Return simplex noise value in [-1, 1] for the given 2D coordinate. */
export function jellyNoise(x: number, y: number): number {
  if (!_perm) buildPerm();

  // Skew input space into simplex grid
  const s  = (x + y) * F2;
  const i  = Math.floor(x + s);
  const j  = Math.floor(y + s);
  const t  = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = x - X0;
  const y0 = y - Y0;

  // Determine which simplex we're in
  let i1: number, j1: number;
  if (x0 > y0) { i1 = 1; j1 = 0; }
  else         { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1  + 2 * G2;
  const y2 = y0 - 1  + 2 * G2;

  // Hash corners
  const ii  = i & 255;
  const jj  = j & 255;
  const gi0 = _permMod12[ii      + _perm[jj     ]];
  const gi1 = _permMod12[ii + i1 + _perm[jj + j1]];
  const gi2 = _permMod12[ii + 1  + _perm[jj + 1 ]];

  // Corner contributions
  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * dot2(GRAD3[gi0], x0, y0); }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * dot2(GRAD3[gi1], x1, y1); }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * dot2(GRAD3[gi2], x2, y2); }

  // Scale to [-1, 1]
  return 70 * (n0 + n1 + n2);
}

/**
 * Quantize a continuous value into discrete levels.
 * Matching the Staccato Quantize pattern:
 *   Quantize(value, step) => Math.floor(value * step) / step
 */
export function jellyQuantize(value: number, steps: number): number {
  return Math.floor(value * steps) / steps;
}
