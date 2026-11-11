import { useEffect, useRef, useState } from "react";
import { KNIFE_CUT, KNIFE_STATE, KNIFE_TURN } from "../scene/Knife.tsx";

/** Phones and tablets: no hover, no wheel, no keyboard. */
export const isTouchDevice = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/**
 * Turning the knife with the on-screen buttons: a tap nudges it half a
 * degree, and holding turns it faster and faster. Speeds are per second,
 * so a 120 Hz screen turns exactly like a 60 Hz one.
 */
const TURN = {
  nudge: (0.5 * Math.PI) / 180,
  /** A press shorter than this is just the nudge. */
  holdMs: 180,
  /** Radians per second when the hold starts turning, and once it is up to speed. */
  slow: 0.25,
  fast: 1.6,
  rampMs: 800,
} as const;

/** Hold-to-turn buttons and a big Cut button, shown while the knife is waiting. */
export function TouchControls() {
  const [touch] = useState(isTouchDevice);
  const [knifeReady, setKnifeReady] = useState(false);
  const turning = useRef({ direction: 0, since: 0 });

  useEffect(() => {
    const onState = (e: Event) => setKnifeReady((e as CustomEvent<boolean>).detail);
    window.addEventListener(KNIFE_STATE, onState);
    return () => window.removeEventListener(KNIFE_STATE, onState);
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      // Capped, so coming back from a background tab does not spin the knife.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { direction, since } = turning.current;
      const held = now - since - TURN.holdMs;
      if (direction && held > 0) {
        const ramp = Math.min(1, held / TURN.rampMs);
        const speed = TURN.slow + (TURN.fast - TURN.slow) * ramp * ramp;
        window.dispatchEvent(new CustomEvent(KNIFE_TURN, { detail: direction * speed * dt }));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!touch || !knifeReady) return null;

  const hold = (direction: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      turning.current = { direction, since: performance.now() };
      window.dispatchEvent(new CustomEvent(KNIFE_TURN, { detail: direction * TURN.nudge }));
    },
    onPointerUp: () => (turning.current.direction = 0),
    onPointerLeave: () => (turning.current.direction = 0),
    onPointerCancel: () => (turning.current.direction = 0),
  });

  return (
    <div className="touch-controls">
      <button className="btn touch-turn" aria-label="Girar faca para a esquerda" {...hold(-1)}>
        ⟲
      </button>
      <button className="btn btn-yellow touch-cut" onClick={() => window.dispatchEvent(new Event(KNIFE_CUT))}>
        🔪 Cortar
      </button>
      <button className="btn touch-turn" aria-label="Girar faca para a direita" {...hold(1)}>
        ⟳
      </button>
    </div>
  );
}
