import { useEffect, useRef, useState } from "react";
import { KNIFE_CUT, KNIFE_STATE, KNIFE_TURN } from "../scene/Knife.tsx";

/** Phones and tablets: no hover, no wheel, no keyboard. */
export const isTouchDevice = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Radians per frame while a turn button is held. */
const TURN_SPEED = 0.012;

/** Hold-to-turn buttons and a big Cut button, shown while the knife is waiting. */
export function TouchControls() {
  const [touch] = useState(isTouchDevice);
  const [knifeReady, setKnifeReady] = useState(false);
  const turning = useRef(0);

  useEffect(() => {
    const onState = (e: Event) => setKnifeReady((e as CustomEvent<boolean>).detail);
    window.addEventListener(KNIFE_STATE, onState);
    return () => window.removeEventListener(KNIFE_STATE, onState);
  }, []);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      if (turning.current) window.dispatchEvent(new CustomEvent(KNIFE_TURN, { detail: turning.current * TURN_SPEED }));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!touch || !knifeReady) return null;

  const hold = (direction: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      turning.current = direction;
    },
    onPointerUp: () => (turning.current = 0),
    onPointerLeave: () => (turning.current = 0),
    onPointerCancel: () => (turning.current = 0),
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
