import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./dock.css";

/** How far the 3D scene should slide (px) so a panel does not sit on top of the cut. */
export interface SceneShift {
  x: number;
  y: number;
}

export const NO_SHIFT: SceneShift = { x: 0, y: 0 };

/**
 * Attach the returned ref to a panel that covers part of the scene. A panel
 * docked at the side pushes the scene sideways by half its width; one at the
 * bottom pushes it up by half its height. Resets when the panel goes away.
 */
export function useSceneShift(onShift?: (shift: SceneShift) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onShift) return;
    let last = NO_SHIFT;
    const measure = () => {
      // Offsets, not the bounding rect: the panel animates in with a transform.
      const side = el.offsetLeft > innerWidth * 0.35 && el.offsetWidth < innerWidth * 0.65;
      const next = side
        ? { x: Math.round(Math.min(innerWidth * 0.3, (innerWidth - el.offsetLeft) / 2)), y: 0 }
        : { x: 0, y: Math.round(Math.min(innerHeight * 0.3, (innerHeight - el.offsetTop) / 2)) };
      if (next.x === last.x && next.y === last.y) return;
      last = next;
      onShift(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      onShift(NO_SHIFT);
    };
  }, [onShift]);
  return ref;
}

/**
 * Results panel that never outgrows the screen: docked on the right on wide
 * screens, a bottom sheet on phones. The head and foot stay put; only the
 * body scrolls, and only if it has to.
 */
export function ResultDock({
  head,
  foot,
  children,
  onShift,
}: {
  head: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
  onShift?(shift: SceneShift): void;
}) {
  const ref = useSceneShift(onShift);
  return (
    <div ref={ref} className="dock panel">
      <div className="dock-head">{head}</div>
      <div className="dock-body">{children}</div>
      {foot && <div className="dock-foot">{foot}</div>}
    </div>
  );
}
