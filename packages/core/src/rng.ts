/**
 * Deterministic random numbers. Every client and the scoring server must
 * build the exact same object from the same seed, so nothing in core may
 * call Math.random.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /**
   * Independent stream derived from this seed and a label. Use one fork per
   * concern (shape, noise, color...) so adding a new random parameter to one
   * concern does not shift the values of the others.
   */
  fork(label: string): Rng;
}

/** cyrb128: hashes a string into four 32-bit words for seeding sfc32. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: small, fast, 128-bit state PRNG using only integer ops. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): Rng {
  const next = sfc32(...cyrb128(seed));
  // Discard the first outputs; sfc32 needs a few rounds to mix its state.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor((max - min + 1) * next()),
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() from an empty list");
      return items[Math.floor(items.length * next())]!;
    },
    fork: (label) => createRng(`${seed}/${label}`),
  };
}
