import { useEffect, useState } from "react";
import { isMuted, onMuteChange, setMuted, sfx } from "../audio/sfx.ts";

/** Corner mute button, shown on every screen. */
export function SoundToggle() {
  const [muted, setState] = useState(isMuted);
  useEffect(() => {
    const off = onMuteChange(setState);
    return () => {
      off();
    };
  }, []);
  return (
    <button
      className="btn btn-small sound-toggle"
      aria-label={muted ? "Ligar som" : "Desligar som"}
      title={muted ? "Ligar som" : "Desligar som"}
      onClick={(e) => {
        e.currentTarget.blur();
        setMuted(!muted);
        if (muted) setTimeout(() => sfx.pop(), 50);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
