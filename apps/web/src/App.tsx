import { useEffect, useState } from "react";
import { Home, loadName } from "./Home.tsx";
import { PracticeGame } from "./PracticeGame.tsx";
import { RoomGame } from "./room/RoomGame.tsx";
import { createRoom, joinRoom } from "./net/rooms.ts";
import { ensureSignedIn, supabaseConfigured } from "./net/supabase.ts";

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

  switch (screen.type) {
    case "practice":
      return <PracticeGame onExit={goHome} />;
    case "room":
      return <RoomGame roomId={screen.roomId} userId={screen.userId} onExit={goHome} />;
    case "home":
      return (
        <Home
          initialCode={codeFromUrl}
          busy={busy}
          error={error}
          onCreate={(name, rounds) => enterRoom(() => createRoom(name, rounds))}
          onJoin={(name, code) => enterRoom(() => joinRoom(code, name), code.toUpperCase())}
          onPractice={() => setScreen({ type: "practice" })}
        />
      );
  }
}
