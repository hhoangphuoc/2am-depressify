// A small seeded pseudo-random source, so the same seed always gives the same Demo Patients.
// Math.random is never used by the generator.

/**
 * @typedef {object} Random
 * @property {() => number} next uniform in [0, 1)
 * @property {(min: number, max: number) => number} int an integer in [min, max]
 * @property {(mean: number, sd: number) => number} normal
 * @property {(p: number) => boolean} chance true with probability p
 * @property {<T>(items: readonly T[]) => T} pick
 */

/**
 * A 32-bit FNV-1a hash, used to derive a per-Patient seed from the base seed and a name.
 * @param {string} text
 * @returns {number}
 */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Mulberry32: tiny, fast and good enough for invented demo values.
 * @param {number} seed
 * @returns {Random}
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    normal: (mean, sd) => {
      // Box-Muller; 1 - next() keeps the logarithm finite.
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}
