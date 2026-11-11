import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateObject, objectSeed, ruleTarget, type CutResult, type Plane } from "@slice-even/core";
import { GameCanvas } from "../scene/GameCanvas.tsx";
import { SliceStage } from "../scene/SliceStage.tsx";
import { appearanceFor, BLIND_AFTER_MS, evaluateCut, objectSpan, type CutOutcome } from "../game.ts";
import { ItemBadge } from "../ui/Hud.tsx";
import { useRoom, type Ghost, type Round } from "../net/rooms.ts";
import { Lobby, RoundStatus, RuleCard } from "./RoomPanels.tsx";
import { RoundResults } from "./RoundResults.tsx";
import { displayName, rankPlayers, seatColor } from "./players.tsx";
import { NO_SHIFT, type SceneShift } from "../ui/ResultDock.tsx";
import { ReactionBar, ReactionLayer } from "./Reactions.tsx";
import { recordCut, recordGameWin, recordRoundWin } from "../progress/stats.ts";

interface RoomGameProps {
  code: string;
  name: string;
  onExit(): void;
}

export function RoomGame({ code, name, onExit }: RoomGameProps) {
  const {
    state,
    error,
    fatal,
    connected,
    start,
    rematch,
    cut,
    react,
    reactions,
    addBot,
    removeBot,
    sendAim,
    ghosts,
    playerId: userId,
  } = useRoom(code, name);
  const [actionError, setActionError] = useState<string | null>(null);
  // How far the scene slides to stay visible beside the results panel.
  const [shift, setShift] = useState<SceneShift>(NO_SHIFT);

  const run = useCallback((action: () => void) => {
    setActionError(null);
    try {
      action();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, []);

  // Personal progress: round and game wins, counted once each per visit.
  const counted = useRef(new Set<string>());
  const lastRound = state?.rounds.at(-1);
  useEffect(() => {
    if (!state || !lastRound || lastRound.status !== "scored" || counted.current.has(lastRound.id)) return;
    counted.current.add(lastRound.id);
    if (lastRound.winner_id === userId) recordRoundWin();
    if (state.room.status === "finished") {
      const champion = rankPlayers(state.players, state.rounds, state.cuts)[0];
      if (champion?.user_id === userId) recordGameWin();
    }
  }, [state, lastRound, userId]);

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
        <RoundStage
          key={round.id}
          round={round}
          userId={userId}
          players={players}
          cuts={cuts}
          cut={cut}
          sendAim={sendAim}
          ghosts={ghosts}
          onError={setActionError}
          shift={shift}
        />
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
          <Lobby
            room={room}
            players={players}
            userId={userId}
            onStart={() => run(start)}
            onAddBot={(level) => run(() => addBot(level))}
            onRemoveBot={(id) => run(() => removeBot(id))}
          />
        )}
        {room.status !== "lobby" && round?.status === "cutting" && (
          <>
            <RuleCard key={round.id} round={round} total={room.total_rounds} />
            <RoundStatus round={round} players={players} userId={userId} cuts={cuts} />
          </>
        )}
        {round?.status === "scored" && (
          <RoundResults
            key={round.id}
            room={room}
            round={round}
            rounds={rounds}
            players={players}
            cuts={cuts}
            userId={userId}
            isHost={isHost}
            onNext={() => run(start)}
            onExit={onExit}
            onRematch={() => run(rematch)}
            onReact={react}
            onShift={setShift}
          />
        )}
        {(actionError ?? error) && <div className="toast error">{actionError ?? error}</div>}
        {!connected && <div className="toast">Reconectando…</div>}
      </div>
      <ReactionLayer reactions={reactions} userId={userId} />
      {/* While results are up the reactions live inside that panel. */}
      {round?.status !== "scored" && <ReactionBar onReact={react} />}
    </>
  );
}

/** The player's own object for this round, the knife, and the server round trip. */
function RoundStage({
  round,
  userId,
  players,
  cuts,
  cut,
  sendAim,
  ghosts,
  onError,
  shift,
}: {
  round: Round;
  userId: string;
  players: { user_id: string; name: string; bot: boolean; last_cut_round: number }[];
  cuts: { round_id: string; user_id: string; plane: Plane }[];
  cut(round: number, plane: Plane): Promise<CutResult>;
  sendAim(x: number, z: number, angle: number): void;
  ghosts: React.RefObject<Map<string, Ghost>>;
  onError(message: string | null): void;
  shift: SceneShift;
}) {
  const seed = objectSeed(round.seed, userId, round.rule);
  const target = ruleTarget(round.rule);
  const object = useMemo(() => generateObject(round.kind, seed), [round.kind, seed]);
  const look = useMemo(() => appearanceFor(seed), [seed]);
  const span = useMemo(() => objectSpan(object), [object]);
  const [local, setLocal] = useState<CutOutcome | null>(null);

  // After a reload the cut only exists on the server; rebuild the halves from it.
  const savedPlane = cuts.find((c) => c.round_id === round.id && c.user_id === userId)?.plane;
  const outcome = useMemo(
    () => local ?? (savedPlane ? evaluateCut(object, savedPlane, target) : null),
    [local, savedPlane, object, target],
  );

  const timeUp = useDeadlinePassed(round);

  // Live ghost knives: send our aim ~10 times a second, show the others still aiming.
  const lastSent = useRef(0);
  const aim = useCallback(
    (x: number, z: number, angle: number) => {
      const now = performance.now();
      if (now - lastSent.current < 100) return;
      lastSent.current = now;
      sendAim(x, z, angle);
    },
    [sendAim],
  );
  const ghostPlayers = useMemo(
    () =>
      players
        .filter((p) => p.user_id !== userId && !p.bot && round.participants.includes(p.user_id))
        .filter((p) => p.last_cut_round < round.number)
        .map((p) => ({ id: p.user_id, name: p.name, color: seatColor(players, p.user_id) })),
    [players, userId, round],
  );

  // Same object for everyone: after the round, show where each player cut it.
  const otherCuts = useMemo(
    () =>
      round.rule.type === "twin" && round.status === "scored"
        ? cuts
            .filter((c) => c.round_id === round.id && c.user_id !== userId)
            .map((c) => ({
              plane: c.plane,
              color: seatColor(players, c.user_id),
              name: displayName(players.find((p) => p.user_id === c.user_id) ?? { name: "?", bot: false }),
            }))
        : [],
    [round, cuts, players, userId],
  );
  const playing = round.participants.includes(userId);
  // Blind rounds: the object vanishes a few seconds after the round starts.
  const [hideAfterMs] = useState(() =>
    round.rule.type === "blind"
      ? Math.max(0, new Date(round.started_at).getTime() + BLIND_AFTER_MS - Date.now())
      : undefined,
  );

  const handleCut = useCallback(
    (plane: Plane) => {
      setLocal(evaluateCut(object, plane, target));
      onError(null);
      cut(round.number, plane).then(
        (score) => recordCut({ kind: round.kind, error: score.error, rule: round.rule }),
        (e: Error) => onError(e.message),
      );
    },
    [object, target, round.number, round.kind, round.rule, cut, onError],
  );

  return (
    <GameCanvas span={span} shift={shift}>
      <SliceStage
        object={object}
        skinColor={look.skinColor}
        stemTilt={look.stemTilt}
        outcome={outcome}
        onCut={handleCut}
        locked={round.status === "scored" || timeUp || !playing}
        revealIdeal={round.status === "scored"}
        hideAfterMs={round.status === "cutting" ? hideAfterMs : undefined}
        otherCuts={otherCuts}
        onAim={round.status === "cutting" ? aim : undefined}
        ghosts={round.status === "cutting" ? { positions: ghosts, players: ghostPlayers } : undefined}
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
