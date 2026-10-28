import { useEffect, useState } from "react";
import { Home, loadName } from "./Home.tsx";
import { PracticeGame } from "./PracticeGame.tsx";
import { RoomGame } from "./room/RoomGame.tsx";
import { createRoom, joinRoom } from "./net/rooms.ts";
import { ensureSignedIn, supabaseConfigured } from "./net/supabase.ts";
import { sfx, unlockOnGesture } from "./audio/sfx.ts";
import { SoundToggle } from "./ui/SoundToggle.tsx";

unlockOnGesture();
// Every chunky button and chip clicks.
document.addEventListener("click", (e) => {
  if ((e.target as Element | null)?.closest?.(".btn:not(.sound-toggle), .chip")) sfx.click();
});

type Screen =
  | { type: "home" }
  | { type: "practice" }
  | { type: "room"; roomId: string; userId: string };

function setUrl(params: Record<string, string>) {
  const url = new URL(location.href);
  url.search = new URLSearchParams(params).toString();
  history.replaceState(null, "", url);
}

export function App() {
  const params = new URLSearchParams(location.search);
  const codeFromUrl = (params.get("room") ?? "").toUpperCase();
  const [screen, setScreen] = useState<Screen>(() =>
    params.has("practice") || !supabaseConfigured ? { type: "practice" } : { type: "home" },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enterRoom = async (join: () => Promise<string>, code?: string) => {
    setBusy(true);
    setError(null);
    try {
      const userId = await ensureSignedIn();
      const roomId = await join();
      setScreen({ type: "room", roomId, userId });
      if (code) setUrl({ room: code });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Reloading (or opening an invite) with ?room=CODE rejoins, if we know your name.
  useEffect(() => {
    const name = loadName();
    if (supabaseConfigured && codeFromUrl.length === 5 && name && screen.type === "home") {
      void enterRoom(() => joinRoom(codeFromUrl, name), codeFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goHome = () => {
    setUrl({});
    setScreen({ type: "home" });
  };

  // A plain element, not a nested component: a component declared here would
  // be a new type on every render and remount the whole game.
  let content;
  switch (screen.type) {
    case "practice":
      content = <PracticeGame onExit={goHome} />;
      break;
    case "room":
      content = <RoomGame roomId={screen.roomId} userId={screen.userId} onExit={goHome} />;
      break;
    case "home":
      content = (
        <Home
          initialCode={codeFromUrl}
          busy={busy}
          error={error}
          onCreate={(name, rounds) => enterRoom(() => createRoom(name, rounds))}
          onJoin={(name, code) => enterRoom(() => joinRoom(code, name), code.toUpperCase())}
          onPractice={() => setScreen({ type: "practice" })}
        />
      );
      break;
  }

  return (
    <>
      {content}
      <SoundToggle />
    </>
  );
}
