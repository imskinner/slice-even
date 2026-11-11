import { useEffect, useRef, useState } from "react";
import { REACTIONS } from "@slice-even/server/protocol";
import type { Reaction } from "../net/rooms.ts";
import { sfx } from "../audio/sfx.ts";

/**
 * Row of emoji buttons; the server ignores taps faster than its rate limit.
 * Floats at the edge of the screen while cutting; `inline` sits inside a results panel.
 */
export function ReactionBar({ onReact, inline = false }: { onReact(emoji: string): void; inline?: boolean }) {
  return (
    <div className={inline ? "reaction-bar inline" : "reaction-bar"}>
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          className="reaction-btn"
          aria-label={`Reagir com ${emoji}`}
          onClick={(e) => {
            e.currentTarget.blur();
            onReact(emoji);
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

interface Splat {
  id: number;
  x: number;
  y: number;
  rotate: number;
}

/**
 * Reactions float up the screen with the sender's name. A tomato thrown by
 * someone else also splats on your screen for a moment.
 */
export function ReactionLayer({ reactions, userId }: { reactions: Reaction[]; userId: string }) {
  const [splats, setSplats] = useState<Splat[]>([]);
  const seen = useRef(new Set<number>());
  // Each bubble gets a stable horizontal lane.
  const lanes = useRef(new Map<number, number>());

  useEffect(() => {
    for (const r of reactions) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      lanes.current.set(r.id, 8 + Math.random() * 74);
      if (r.emoji === "🍅" && r.from !== userId) {
        sfx.splat("tomato");
        sfx.cut("tomato");
        const splat = { id: r.id, x: 15 + Math.random() * 60, y: 15 + Math.random() * 50, rotate: Math.random() * 360 };
        setSplats((list) => [...list, splat]);
        setTimeout(() => setSplats((list) => list.filter((s) => s.id !== splat.id)), 1800);
      } else {
        sfx.pop();
      }
    }
  }, [reactions, userId]);

  return (
    <div className="reaction-layer" aria-hidden>
      {reactions.map((r) => (
        <div key={r.id} className="reaction-bubble" style={{ left: `${lanes.current.get(r.id) ?? 50}%` }}>
          <span className="reaction-emoji">{r.emoji}</span>
          <span className="reaction-name">{r.from === userId ? "você" : r.name}</span>
        </div>
      ))}
      {splats.map((s) => (
        <svg
          key={s.id}
          className="tomato-splat"
          viewBox="0 0 200 200"
          style={{ left: `${s.x}%`, top: `${s.y}%`, transform: `translate(-50%, -50%) rotate(${s.rotate}deg)` }}
        >
          <path
            d="M100 30c18 0 22 22 38 24s30-10 38 6-14 26-6 40 26 22 14 38-32 2-44 12-10 34-30 34-18-26-34-30-36 10-44-6 12-28 4-42-26-22-14-38 34-2 44-14 16-24 34-24z"
            fill="#d7261a"
          />
          <circle cx="58" cy="44" r="10" fill="#d7261a" />
          <circle cx="168" cy="150" r="8" fill="#d7261a" />
          <circle cx="40" cy="160" r="6" fill="#d7261a" />
          <ellipse cx="88" cy="84" rx="16" ry="9" fill="#f6c94a" opacity="0.8" />
          <ellipse cx="122" cy="118" rx="12" ry="7" fill="#f6c94a" opacity="0.8" />
        </svg>
      ))}
    </div>
  );
}
