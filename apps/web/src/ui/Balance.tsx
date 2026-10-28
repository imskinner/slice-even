import { useEffect, useState } from "react";
import { sfx } from "../audio/sfx.ts";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const grams = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g`;

/** Beam scale: the heavier half sinks, so a perfect cut stays level. */
export function Balance({ left, right }: { left: number; right: number }) {
  const total = left + right || 1;
  // A few percent of difference should already be visible; cap the tilt.
  const target = Math.max(-16, Math.min(16, ((right - left) / total) * 160));
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAngle(target));
    // The beam starts moving after 0.6 s (CSS delay); knock when it lands.
    const knock = setTimeout(() => sfx.clunk(), 1300);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(knock);
    };
  }, [target]);

  const counter = { transform: `translateX(-50%) rotate(${-angle}deg)` };
  return (
    <div className="balance" aria-label={`${pct(left / total)} contra ${pct(right / total)}`}>
      <div className="balance-foot" />
      <div className="balance-post" />
      <div className="balance-beam" style={{ transform: `rotate(${angle}deg)` }}>
        <div className="balance-pan left" style={counter}>
          <div className="string" />
          <div className="dish">
            <div className="pct">{pct(left / total)}</div>
            <div className="grams">{grams(left)}</div>
          </div>
        </div>
        <div className="balance-pan right" style={counter}>
          <div className="string" />
          <div className="dish">
            <div className="pct">{pct(right / total)}</div>
            <div className="grams">{grams(right)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
