import { useEffect, useState } from "react";
import { Home, loadName } from "./Home.tsx";
import { PracticeGame } from "./PracticeGame.tsx";
import { RoomGame } from "./room/RoomGame.tsx";
import { createRoom, multiplayerConfigured } from "./net/rooms.ts";
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
  | { type: "room"; code: string; name: string };

function setUrl(params: Record<string, string>) {
  const url = new URL(location.href);
  url.search = new URLSearchParams(params).toString();
  history.replaceState(null, "", url);
}

export function App() {
  const params = new URLSearchParams(location.search);
  const codeFromUrl = (params.get("room") ?? "").toUpperCase();
  const [screen, setScreen] = useState<Screen>(() =>
    params.has("practice") || !multiplayerConfigured ? { type: "practice" } : { type: "home" },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Joining happens over the room's WebSocket; RoomGame shows any rejection.
  const enterRoom = (code: string, name: string) => {
    setError(null);
    setScreen({ type: "room", code: code.trim().toUpperCase(), name });
  };

  const create = async (name: string, rounds: number) => {
    setBusy(true);
    setError(null);
    try {
      enterRoom(await createRoom(rounds), name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Reloading (or opening an invite) with ?room=CODE rejoins, if we know your name.
  useEffect(() => {
    const name = loadName();
    if (multiplayerConfigured && codeFromUrl.length === 5 && name && screen.type === "home") {
      enterRoom(codeFromUrl, name);
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
      content = <RoomGame code={screen.code} name={screen.name} onExit={goHome} />;
      break;
    case "home":
      content = (
        <Home
          initialCode={codeFromUrl}
          busy={busy}
          error={error}
          onCreate={create}
          onJoin={(name, code) => enterRoom(code, name)}
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
