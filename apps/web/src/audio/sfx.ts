import type { ObjectKind } from "@slice-even/core";

/**
 * Every sound is synthesized with Web Audio at play time: no audio files to
 * load, license or cache, and each cut sounds slightly different.
 *
 * Browsers only allow audio after a user gesture, so the context is created
 * lazily and resumed on the first click or key press (see unlockOnGesture).
 */

const MUTE_KEY = "slice-even:muted";

type Texture = "crunchy" | "juicy" | "soft";

const TEXTURE: Record<ObjectKind, Texture> = {
  apple: "crunchy",
  carrot: "crunchy",
  cucumber: "crunchy",
  orange: "juicy",
  tomato: "juicy",
  banana: "soft",
  bread: "soft",
  cake: "soft",
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function audio(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.6;
    // A gentle compressor keeps stacked sounds (cut + splats + jingle) from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  // Sounds scheduled on a suspended context would all fire at once on resume.
  if (ctx.state !== "running") return null;
  return { ctx, out: master!, noise: noise! };
}

/** Resume audio on the first real user gesture (pointermove does not count). */
export function unlockOnGesture() {
  const unlock = () => {
    audio();
    // The context takes a moment to start running after the gesture.
    setTimeout(syncAmbience, 400);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Not remembered in private mode; still applies for this visit.
  }
  if (value) void ctx?.suspend();
  else void ctx?.resume();
  setTimeout(syncAmbience, 400);
  listeners.forEach((l) => l(value));
}

export function onMuteChange(listener: (muted: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ------------------------------------------------------------ building blocks */

interface Env {
  attack?: number;
  decay: number;
  peak?: number;
}

/** Gain node with a fast attack and exponential decay, starting at `at`. */
function envelope(c: AudioContext, at: number, { attack = 0.005, decay, peak = 1 }: Env): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

function noiseBurst(
  a: NonNullable<ReturnType<typeof audio>>,
  at: number,
  filter: { type: BiquadFilterType; from: number; to?: number; q?: number },
  env: Env,
) {
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = a.ctx.createBiquadFilter();
  f.type = filter.type;
  f.Q.value = filter.q ?? 1;
  f.frequency.setValueAtTime(filter.from, at);
  if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, at + (env.attack ?? 0.005) + env.decay);
  const g = envelope(a.ctx, at, env);
  src.connect(f).connect(g).connect(a.out);
  src.start(at, Math.random() * 0.5);
  src.stop(at + (env.attack ?? 0.005) + env.decay + 0.05);
}

function tone(
  a: NonNullable<ReturnType<typeof audio>>,
  at: number,
  type: OscillatorType,
  from: number,
  to: number | null,
  env: Env,
  lowpass?: number,
) {
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  const end = at + (env.attack ?? 0.005) + env.decay;
  if (to) osc.frequency.exponentialRampToValueAtTime(to, end);
  const g = envelope(a.ctx, at, env);
  let node: AudioNode = osc;
  if (lowpass) {
    const f = a.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    node = node.connect(f);
  }
  node.connect(g).connect(a.out);
  osc.start(at);
  osc.stop(end + 0.05);
}

const jitter = (v: number, amount = 0.08) => v * (1 + (Math.random() * 2 - 1) * amount);

/* ------------------------------------------------------------ sounds */

export const sfx = {
  /** Blade moving through the air. `strength` 0..1 scales pitch and volume. */
  whoosh(strength = 1) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    noiseBurst(a, t, { type: "bandpass", from: 500, to: jitter(2600 * (0.6 + strength * 0.4)), q: 1.2 }, {
      attack: 0.06,
      decay: 0.18,
      peak: 0.35 * (0.5 + strength * 0.5),
    });
  },

  /** The blade going through the object and hitting the board. */
  cut(kind: ObjectKind) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const texture = TEXTURE[kind];
    if (texture === "crunchy") {
      // A quick run of tiny cracks, then the thunk on the board.
      for (let i = 0; i < 7; i++) {
        noiseBurst(a, t + i * 0.012 + Math.random() * 0.006, { type: "highpass", from: jitter(3000, 0.3) }, { decay: 0.02, peak: 0.5 - i * 0.05 });
      }
    } else if (texture === "juicy") {
      noiseBurst(a, t, { type: "lowpass", from: 2400, to: 500, q: 4 }, { attack: 0.01, decay: 0.16, peak: 0.55 });
      tone(a, t + 0.02, "sine", jitter(420), 110, { decay: 0.14, peak: 0.25 });
    } else {
      noiseBurst(a, t, { type: "lowpass", from: 1100, to: 400 }, { attack: 0.02, decay: 0.14, peak: 0.45 });
    }
    // Knife meets the cutting board.
    tone(a, t + 0.07, "sine", jitter(150), 55, { decay: 0.12, peak: 0.6 });
    noiseBurst(a, t + 0.07, { type: "bandpass", from: 900, q: 2 }, { decay: 0.05, peak: 0.25 });
  },

  /** A drop of juice or crumb landing. */
  splat(kind: ObjectKind) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    if (TEXTURE[kind] === "juicy") {
      tone(a, t, "sine", jitter(900, 0.3), 260, { decay: 0.05, peak: 0.08 });
    } else {
      noiseBurst(a, t, { type: "highpass", from: jitter(2500, 0.3) }, { decay: 0.015, peak: 0.08 });
    }
  },

  /** Buttons and chips. */
  click() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "triangle", jitter(620, 0.04), 940, { decay: 0.06, peak: 0.22 });
  },

  /** Something appears (a player joins, a panel pops in). */
  pop() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "sine", 380, 760, { decay: 0.09, peak: 0.25 });
  },

  /** Countdown tick for the last seconds of a round. */
  tick(urgent = false) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "square", urgent ? 1320 : 990, null, { decay: 0.035, peak: 0.07 }, 3000);
  },

  /** Round starts. */
  ding() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    for (const [f, p] of [[880, 0.25], [1320, 0.1], [1760, 0.05]] as const) tone(a, t, "sine", f, null, { decay: 0.9, peak: p });
  },

  /** The balance beam settling. */
  clunk() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "sine", 210, 140, { decay: 0.1, peak: 0.3 });
    noiseBurst(a, t, { type: "bandpass", from: 1400, q: 3 }, { decay: 0.04, peak: 0.12 });
  },

  /** Result jingle by rating tone. */
  result(tone_: "great" | "good" | "meh" | "bad") {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const note = (semitones: number) => 523.25 * 2 ** (semitones / 12);
    haptic(tone_ === "great" ? [18, 50, 18, 50, 40] : tone_ === "bad" ? 90 : 25);
    const play = (steps: number[], gap: number, type: OscillatorType, decay: number, peak: number) =>
      steps.forEach((s, i) => tone(a, t + i * gap, type, note(s), null, { decay, peak }));
    switch (tone_) {
      case "great":
        play([0, 4, 7, 12], 0.09, "triangle", 0.3, 0.3);
        play([12, 16, 19], 0.09, "sine", 0.5, 0.12);
        break;
      case "good":
        play([0, 7, 12], 0.1, "triangle", 0.28, 0.28);
        break;
      case "meh":
        play([4, 3], 0.16, "triangle", 0.3, 0.25);
        break;
      case "bad":
        // Sad trombone: three falling "wahs" and a long one.
        [0, 0.32, 0.64].forEach((d, i) =>
          tone(a, t + d, "sawtooth", note(-5 - i), note(-6 - i), { attack: 0.03, decay: 0.26, peak: 0.16 }, 1200),
        );
        tone(a, t + 0.96, "sawtooth", note(-8), note(-11), { attack: 0.03, decay: 0.8, peak: 0.16 }, 1000);
        break;
    }
  },

  /** Snare roll building suspense before a reveal. */
  drumroll(seconds = 1) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const hits = Math.round(seconds * 22);
    for (let i = 0; i < hits; i++) {
      const p = i / hits;
      noiseBurst(a, t + i / 22 + Math.random() * 0.006, { type: "bandpass", from: jitter(1800, 0.1), q: 0.8 }, {
        decay: 0.035,
        peak: 0.05 + 0.12 * p,
      });
    }
  },

  /** The cymbal-ish hit that lands on a reveal. */
  reveal() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    noiseBurst(a, t, { type: "highpass", from: 5000 }, { decay: 0.5, peak: 0.18 });
    tone(a, t, "sine", 110, 60, { decay: 0.25, peak: 0.4 });
  },

  /** You won the round / the game. */
  fanfare() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const note = (s: number) => 523.25 * 2 ** (s / 12);
    [0, 4, 7, 12, 7, 12].forEach((s, i) => tone(a, t + i * 0.11, "square", note(s), null, { decay: 0.2, peak: 0.12 }, 2600));
    tone(a, t + 0.66, "triangle", note(12), null, { decay: 0.9, peak: 0.25 });
  },

  /** An object landing on the board. */
  thud() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "sine", jitter(120), 48, { decay: 0.16, peak: 0.5 });
    noiseBurst(a, t, { type: "lowpass", from: 700, to: 200 }, { decay: 0.07, peak: 0.25 });
  },

  /** The serving dome coming down (blind rounds): a metallic ring. */
  clang() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    for (const [f, p, d] of [[1180, 0.14, 0.7], [1765, 0.08, 0.5], [2640, 0.05, 0.35]] as const) {
      tone(a, t, "sine", jitter(f, 0.01), null, { decay: d, peak: p });
    }
    noiseBurst(a, t, { type: "bandpass", from: 3200, q: 2 }, { decay: 0.04, peak: 0.2 });
  },

  /**
   * Tension for the last seconds of a round: a tone and a hiss that rise
   * until time is up. Returns a function that cuts it short (you cut, or the
   * round ended).
   */
  riser(seconds: number): () => void {
    const a = audio();
    if (!a || seconds <= 0) return () => undefined;
    const t = a.ctx.currentTime;
    const end = t + seconds;
    const out = a.ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.09, end);
    out.connect(a.out);

    const osc = a.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(600, end);
    osc.connect(out);
    osc.start(t);
    osc.stop(end + 0.3);

    const hiss = a.ctx.createBufferSource();
    hiss.buffer = a.noise;
    hiss.loop = true;
    const band = a.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 3;
    band.frequency.setValueAtTime(500, t);
    band.frequency.exponentialRampToValueAtTime(4500, end);
    const hissGain = a.ctx.createGain();
    hissGain.gain.value = 0.5;
    hiss.connect(band).connect(hissGain).connect(out);
    hiss.start(t);
    hiss.stop(end + 0.3);

    return () => {
      const now = a.ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0.0001, now, 0.04);
      osc.stop(now + 0.3);
      hiss.stop(now + 0.3);
    };
  },
};

/* ------------------------------------------------------------ ambience */

let ambienceWanted = false;
let ambience: { stop(): void } | null = null;

/**
 * A quiet kitchen behind the game: the hum of a fridge and a little room
 * tone. It is a wish rather than a call, because audio may not be allowed
 * yet (or may be muted) when a screen asks for it; it starts when it can.
 */
function syncAmbience() {
  if (!ambienceWanted || muted) {
    ambience?.stop();
    ambience = null;
    return;
  }
  if (ambience) return;
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const out = a.ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(1, t + 2);
  out.connect(a.out);

  const sources: AudioScheduledSourceNode[] = [];
  for (const [f, level] of [[50, 0.05], [100, 0.022], [151, 0.008]] as const) {
    const osc = a.ctx.createOscillator();
    osc.frequency.value = f;
    const g = a.ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(t);
    sources.push(osc);
  }
  const room = a.ctx.createBufferSource();
  room.buffer = a.noise;
  room.loop = true;
  const low = a.ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 420;
  const roomGain = a.ctx.createGain();
  roomGain.gain.value = 0.03;
  room.connect(low).connect(roomGain).connect(out);
  room.start(t);
  sources.push(room);

  const ctx = a.ctx;
  ambience = {
    stop() {
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0.0001, now, 0.15);
      for (const s of sources) s.stop(now + 1);
    },
  };
}

/** Turn the kitchen ambience on (in a game) or off (menus). */
export function setAmbience(on: boolean) {
  ambienceWanted = on;
  syncAmbience();
}

/**
 * A buzz on phones that can (Android; iOS has no web vibration). Follows the
 * sound toggle: muted means quiet in the hand too.
 */
export function haptic(pattern: number | number[]) {
  // Browsers refuse (and log) vibration before the first tap on the page.
  if (muted || navigator.userActivation?.hasBeenActive === false) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not allowed here; it is only a nicety.
  }
}
