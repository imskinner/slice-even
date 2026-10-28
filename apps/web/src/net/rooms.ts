import { useCallback, useEffect, useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { CutResult, ObjectKind, Plane } from "@slice-even/core";
import { supabase } from "./supabase.ts";

export interface Room {
  id: string;
  code: string;
  host_id: string;
  status: "lobby" | "playing" | "finished";
  total_rounds: number;
  round_seconds: number;
  current_round: number;
}

export interface Player {
  room_id: string;
  user_id: string;
  name: string;
  wins: number;
  last_cut_round: number;
  joined_at: string;
}

export interface Round {
  id: string;
  room_id: string;
  number: number;
  kind: ObjectKind;
  seed: string;
  status: "cutting" | "scored";
  started_at: string;
  deadline: string;
  winner_id: string | null;
}

export interface Cut {
  round_id: string;
  user_id: string;
  plane: Plane;
  mass_front: number;
  mass_back: number;
  error: number;
}

export interface RoomState {
  room: Room;
  players: Player[];
  rounds: Round[];
  /** RLS returns your own cuts, plus everyone's for scored rounds. */
  cuts: Cut[];
}

const MESSAGES: Record<string, string> = {
  "room not found": "Sala não encontrada.",
  "game already started": "Essa partida já começou.",
  "room is full": "A sala está cheia (máximo 8).",
  "only the host can start a round": "Só quem criou a sala pode começar.",
  "current round is still running": "A rodada atual ainda não terminou.",
  "game is over": "A partida acabou.",
  "round still running": "A rodada ainda está rolando.",
  "round is over": "A rodada já acabou.",
  "time is up": "O tempo acabou!",
  "already cut this round": "Você já cortou nesta rodada.",
};

const translate = (message: string) => MESSAGES[message] ?? message;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(translate(error.message));
  return data as T;
}

export const createRoom = (name: string, totalRounds: number) =>
  rpc<string>("create_room", { p_name: name, p_total_rounds: totalRounds });

export const joinRoom = (code: string, name: string) => rpc<string>("join_room", { p_code: code, p_name: name });

export const startRound = (roomId: string) => rpc<string>("start_round", { p_room: roomId });

export const finalizeRound = (roundId: string) => rpc<null>("finalize_round", { p_round: roundId });

/** The server regenerates the object from the seed and scores the plane. */
export async function submitCut(roundId: string, plane: Plane): Promise<CutResult> {
  const { data, error } = await supabase().functions.invoke<{ score: CutResult }>("submit-cut", {
    body: { roundId, plane },
  });
  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body?.error) message = body.error;
    }
    throw new Error(translate(message));
  }
  return data!.score;
}

async function fetchRoomState(roomId: string): Promise<RoomState> {
  const db = supabase();
  const [room, players, rounds, cuts] = await Promise.all([
    db.from("rooms").select("*").eq("id", roomId).single(),
    db.from("room_players").select("*").eq("room_id", roomId).order("joined_at"),
    db.from("rounds").select("*").eq("room_id", roomId).order("number"),
    db.from("cuts").select("round_id, user_id, plane, mass_front, mass_back, error").eq("room_id", roomId),
  ]);
  const failed = room.error ?? players.error ?? rounds.error ?? cuts.error;
  if (failed) throw new Error(failed.message);
  return { room: room.data, players: players.data ?? [], rounds: rounds.data ?? [], cuts: cuts.data ?? [] };
}

/**
 * Live room state. Any change to the room's rows triggers a refetch; the data
 * is tiny, so this is simpler and safer than patching state per event.
 */
export function useRoom(roomId: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    // Coalesce bursts (a cut touches cuts, room_players and rounds at once).
    timer.current = setTimeout(() => {
      fetchRoomState(roomId).then(
        (next) => {
          setState(next);
          setError(null);
        },
        (e: Error) => setError(e.message),
      );
    }, 80);
  }, [roomId]);

  useEffect(() => {
    refresh();
    const byRoom = `room_id=eq.${roomId}`;
    const channel = supabase()
      .channel(`room:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: byRoom }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: byRoom }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cuts", filter: byRoom }, refresh)
      .subscribe((status) => {
        // Catch up on anything missed while (re)connecting.
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      clearTimeout(timer.current);
      supabase().removeChannel(channel);
    };
  }, [roomId, refresh]);

  return { state, error, refresh };
}
