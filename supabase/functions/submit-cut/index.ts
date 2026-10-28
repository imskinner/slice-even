// Scores a player's cut for the current round. The client only sends the
// plane; the object is regenerated here from the round seed and the score is
// computed with the same core code the client uses, so it cannot be faked.
//
// `./core` is a copy of packages/core/src made by `npm run functions:sync`.
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateObject, parseCutPlane, playerSeed, scoreCut, type ObjectKind } from "./core/index.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Accept cuts that arrive this long after the deadline (network latency). */
const GRACE_MS = 2000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const user = auth.user;
  if (!user) return json(401, { error: "not signed in" });

  let body: { roundId?: unknown; plane?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  if (typeof body.roundId !== "string") return json(400, { error: "roundId is required" });
  const parsed = parseCutPlane(body.plane);
  if ("error" in parsed) return json(400, { error: parsed.error });

  const { data: round } = await admin
    .from("rounds")
    .select("id, room_id, number, kind, seed, status, deadline")
    .eq("id", body.roundId)
    .maybeSingle();
  if (!round) return json(404, { error: "round not found" });
  if (round.status !== "cutting") return json(409, { error: "round is over" });
  if (Date.now() > new Date(round.deadline).getTime() + GRACE_MS) return json(409, { error: "time is up" });

  const { data: member } = await admin
    .from("room_players")
    .select("user_id")
    .eq("room_id", round.room_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json(403, { error: "not a member of this room" });

  const object = generateObject(round.kind as ObjectKind, playerSeed(round.seed, user.id));
  const score = scoreCut(object.mesh, parsed.plane, object.density);

  const { error: insertError } = await admin.from("cuts").insert({
    round_id: round.id,
    room_id: round.room_id,
    user_id: user.id,
    plane: parsed.plane,
    mass_front: score.massFront,
    mass_back: score.massBack,
    error: score.error,
  });
  if (insertError) {
    // Primary key (round_id, user_id): one cut per player per round.
    if (insertError.code === "23505") return json(409, { error: "already cut this round" });
    console.error(insertError);
    return json(500, { error: "could not save the cut" });
  }

  await admin
    .from("room_players")
    .update({ last_cut_round: round.number })
    .eq("room_id", round.room_id)
    .eq("user_id", user.id);

  // Last one in closes the round.
  const [{ count: cuts }, { count: players }] = await Promise.all([
    admin.from("cuts").select("*", { count: "exact", head: true }).eq("round_id", round.id),
    admin.from("room_players").select("*", { count: "exact", head: true }).eq("room_id", round.room_id),
  ]);
  if (cuts !== null && players !== null && cuts >= players) {
    const { error } = await admin.rpc("_finalize_round", { p_round: round.id });
    if (error) console.error(error);
  }

  return json(200, { score });
});
