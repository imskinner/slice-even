import { useCallback, useEffect, useMemo, useState } from "react";
import { generateObject, playerSeed, type CutResult, type Plane } from "@slice-even/core";
import { GameCanvas } from "../scene/GameCanvas.tsx";
import { SliceStage } from "../scene/SliceStage.tsx";
import { appearanceFor, evaluateCut, objectSpan, type CutOutcome } from "../game.ts";
import { ItemBadge } from "../ui/Hud.tsx";
import { sfx } from "../audio/sfx.ts";
import { useRoom, type Round } from "../net/rooms.ts";
import { Lobby, RoundResults, FinalScoreboard, RoundStatus } from "./RoomPanels.tsx";

interface RoomGameProps {
  code: string;
  name: string;
  onExit(): void;
}

export function RoomGame({ code, name, onExit }: RoomGameProps) {
  const { state, error, fatal, connected, start, cut, playerId: userId } = useRoom(code, name);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = useCallback((action: () => void) => {
    setActionError(null);
    try {
      action();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, []);

  // Put the code in the URL so a reload rejoins and the link can be shared.
  useEffect(() => {
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    history.replaceState(null, "", url);
  }, [code]);

  if (fatal || !state) {
    return (
      <div className="home">
        <div className="home-stack">
          {fatal ? (
            <div className="home-card panel">
              <p className="error">{fatal}</p>
              <button className="btn btn-yellow" onClick={onExit}>
                Voltar ao início
              </button>
            </div>
          ) : (
            <p className="tagline">{connected ? "Entrando na sala…" : "Conectando ao servidor…"}</p>
          )}
        </div>
      </div>
    );
  }

  const { room, players, rounds, cuts } = state;
  const round = rounds.at(-1) ?? null;
  const isHost = room.host_id === userId;

  return (
    <>
      {round ? (
        <RoundStage key={round.id} round={round} userId={userId} cuts={cuts} cut={cut} onError={setActionError} />
      ) : (
        <GameCanvas />
      )}
      <div className="hud">
        <header className="hud-top">
          <button className="btn btn-small" onClick={onExit}>
            ← Sair
          </button>
          <h1 className="hud-title">Sala {room.code}</h1>
          {round && room.status !== "lobby" && (
            <ItemBadge kind={round.kind} extra={`rodada ${round.number}/${room.total_rounds}`} />
          )}
        </header>

        {room.status === "lobby" && (
          <Lobby room={room} players={players} userId={userId} onStart={() => run(start)} />
        )}
        {room.status !== "lobby" && round?.status === "cutting" && (
          <RoundStatus round={round} players={players} userId={userId} cuts={cuts} />
        )}
        {round?.status === "scored" && room.status === "playing" && (
          <RoundResults
            room={room}
            round={round}
            players={players}
            cuts={cuts}
            userId={userId}
            isHost={isHost}
            onNext={() => run(start)}
          />
        )}
        {room.status === "finished" && round?.status === "scored" && (
          <FinalScoreboard round={round} players={players} cuts={cuts} userId={userId} onExit={onExit} />
        )}
        {(actionError ?? error) && <div className="toast error">{actionError ?? error}</div>}
        {!connected && <div className="toast">Reconectando…</div>}
      </div>
    </>
  );
}

/** The player's own object for this round, the knife, and the server round trip. */
function RoundStage({
  round,
  userId,
  cuts,
  cut,
  onError,
}: {
  round: Round;
  userId: string;
  cuts: { round_id: string; user_id: string; plane: Plane }[];
  cut(round: number, plane: Plane): Promise<CutResult>;
  onError(message: string | null): void;
}) {
  const seed = playerSeed(round.seed, userId);
  // Ding when a fresh round opens (not when reloading into a finished one).
  useEffect(() => {
    if (round.status === "cutting") sfx.ding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const object = useMemo(() => generateObject(round.kind, seed), [round.kind, seed]);
  const look = useMemo(() => appearanceFor(seed), [seed]);
  const span = useMemo(() => objectSpan(object), [object]);
  const [local, setLocal] = useState<CutOutcome | null>(null);

  // After a reload the cut only exists on the server; rebuild the halves from it.
  const savedPlane = cuts.find((c) => c.round_id === round.id && c.user_id === userId)?.plane;
  const outcome = useMemo(
    () => local ?? (savedPlane ? evaluateCut(object, savedPlane) : null),
    [local, savedPlane, object],
  );

  const timeUp = useDeadlinePassed(round);

  const handleCut = useCallback(
    (plane: Plane) => {
      setLocal(evaluateCut(object, plane));
      onError(null);
      cut(round.number, plane).then(
        () => undefined,
        (e: Error) => onError(e.message),
      );
    },
    [object, round.number, cut, onError],
  );

  return (
    <GameCanvas span={span}>
      <SliceStage
        object={object}
        skinColor={look.skinColor}
        stemTilt={look.stemTilt}
        outcome={outcome}
        onCut={handleCut}
        locked={round.status === "scored" || timeUp}
        revealIdeal={round.status === "scored"}
      />
    </GameCanvas>
  );
}

function useDeadlinePassed(round: Round): boolean {
  const deadline = new Date(round.deadline).getTime();
  const [passed, setPassed] = useState(() => Date.now() >= deadline);
  useEffect(() => {
    if (passed) return;
    const id = setTimeout(() => setPassed(true), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(id);
  }, [deadline, passed]);
  return passed;
}
