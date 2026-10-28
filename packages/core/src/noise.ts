import type { Rng } from "./rng.ts";

export type Noise3 = (x: number, y: number, z: number) => number;

// prettier-ignore
const GRAD3 = new Int8Array([
  1, 1, 0,  -1, 1, 0,  1, -1, 0,  -1, -1, 0,
  1, 0, 1,  -1, 0, 1,  1, 0, -1,  -1, 0, -1,
  0, 1, 1,  0, -1, 1,  0, 1, -1,  0, -1, -1,
]);

const F3 = 1 / 3;
const G3 = 1 / 6;

/**
 * 3D simplex noise (Gustavson) with a permutation table shuffled by `rng`.
 * Output is roughly in [-1, 1]. Uses only arithmetic and Math.floor, so it is
 * bit-identical across JS engines.
 */
export function createNoise3(rng: Rng): Noise3 {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    permMod12[i] = perm[i]! % 12;
  }

  const corner = (gi: number, t: number, x: number, y: number, z: number): number => {
    if (t < 0) return 0;
    t *= t;
    const g = gi * 3;
    return t * t * (GRAD3[g]! * x + GRAD3[g + 1]! * y + GRAD3[g + 2]! * z);
  };

  return (xin, yin, zin) => {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else {
      if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
      else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const gi0 = permMod12[ii + perm[jj + perm[kk]!]!]!;
    const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]!;
    const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]!;
    const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]!;

    return (
      32 *
      (corner(gi0, 0.6 - x0 * x0 - y0 * y0 - z0 * z0, x0, y0, z0) +
        corner(gi1, 0.6 - x1 * x1 - y1 * y1 - z1 * z1, x1, y1, z1) +
        corner(gi2, 0.6 - x2 * x2 - y2 * y2 - z2 * z2, x2, y2, z2) +
        corner(gi3, 0.6 - x3 * x3 - y3 * y3 - z3 * z3, x3, y3, z3))
    );
  };
}

/** Fractal sum of `octaves` noise layers, normalized back to roughly [-1, 1]. */
export function fbm3(
  noise: Noise3,
  x: number,
  y: number,
  z: number,
  octaves = 3,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
