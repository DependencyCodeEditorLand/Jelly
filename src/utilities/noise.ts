/*
 * Noise utility for Jelly UI — a lightweight, zero-config 2D simplex-noise
 * source that follows the same Quantize / time-driven pattern used by the
 * website's Staccato noise system. Components that want organic,
 * non-repeating hover or idle variation import { jellyNoise } and call
 * jellyNoise(x, y) to get a value in [-1, 1].
 *
 *   import { jellyNoise, jellyQuantize } from '../utilities/noise.js';
 *   const level = jellyQuantize(jellyNoise(time * 0.5, index * 1.7), 5);
 */

import { createNoise2D } from 'simplex-noise';

type Noise2D = ReturnType<typeof createNoise2D>;

// One shared noise source for the whole page
let _noise: Noise2D | undefined;

function noise(): Noise2D {
  if (!_noise) {
    _noise = createNoise2D();
  }
  return _noise;
}

/** Call noise(x, y) for a deterministic value in [-1, 1]. */
export function jellyNoise(x: number, y: number): number {
  return noise()(x, y);
}

/**
 * Quantize a continuous value into discrete levels.
 * Matching the Staccato Quantize pattern:
 *   Quantize(value, step) => Math.floor(value * step) / step
 */
export function jellyQuantize(value: number, steps: number): number {
  return Math.floor(value * steps) / steps;
}
