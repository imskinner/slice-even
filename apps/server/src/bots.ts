import { findPlaneAtFraction, generateObject, objectSeed, ruleTarget, type Plane } from "@slice-even/core";
import { LIMITS } from "./protocol.ts";
import { RoomError, submitCut, type PlayerRecord, type RoomData, type RoundRecord } from "./room.ts";

/**
 * Computer players. A bot is an ordinary player record with a skill level;
 * when a round starts it gets a moment to cut, and its cut is a real plane
 * scored by the same code as everyone else's, just aimed with some noise.
 */

export type BotLevel = "easy" | "medium" | "hard";

/** Typical error (same 0..1 scale as cutError) for each level. */
export const BOT_SKILL: Record<BotLevel, number> = { easy: 0.07, medium: 0.03, hard: 0.012 };

const BOT_NAMES = ["Chef Byte", "Robô Tomate", "Dona Balança", "Lâmina 3000", "Fatiador", "Mestre Cuca", "Cortex", "Faquinha"];

/** Public rooms are topped up to this many players when they start. */
export const PUBLIC_TABLE_SIZE = 4;

export function isBot(player: PlayerRecord): boolean {
  return player.bot !== undefined;
}

/** Adds a bot. Only the host may do this by hand; null means the room is filling a public table. */
export function addBot(
  data: RoomData,
  requesterId: string | null,
  level: BotLevel,
  now: number,
  random: () => number,
): PlayerRecord {
  if (requesterId !== null && requesterId !== data.hostId) throw new RoomError("Só quem criou a sala pode chamar bots.");
  if (data.status === "finished") throw new RoomError("Essa partida já acabou.");
  if (data.players.length >= LIMITS.maxPlayers) throw new RoomError(`A sala está cheia (máximo ${LIMITS.maxPlayers}).`);
  if (!(level in BOT_SKILL)) throw new RoomError("Nível de bot inválido.");

  const taken = new Set(data.players.map((p) => p.name));
  const free = BOT_NAMES.filter((n) => !taken.has(`🤖 ${n}`));
  const name = `🤖 ${free[Math.floor(random() * free.length)] ?? `Bot ${data.players.length + 1}`}`;
  const bot: PlayerRecord = {
    id: `bot-${crypto.randomUUID()}`,
    token: "",
    name,
    wins: 0,
    score: 0,
    lastCutRound: 0,
    joinedAt: now,
    bot: { level },
  };
  data.players.push(bot);
  data.lastActivity = now;
  return bot;
}

export function removeBot(data: RoomData, requesterId: string, botId: string): void {
  if (requesterId !== data.hostId) throw new RoomError("Só quem criou a sala pode tirar bots.");
  if (data.status !== "lobby") throw new RoomError("Bots só saem antes de a partida começar.");
  const index = data.players.findIndex((p) => p.id === botId && isBot(p));
  if (index >= 0) data.players.splice(index, 1);
}

/** Gives each bot in the round a moment to cut: somewhere between 30% and 85% of the clock. */
export function planBotCuts(data: RoomData, round: RoundRecord, random: () => number): void {
  const duration = round.deadline - LIMITS.graceMs - round.startedAt;
  round.botPlans = data.players
    .filter((p) => isBot(p) && round.participants.includes(p.id))
    .map((p) => ({ playerId: p.id, at: round.startedAt + duration * (0.3 + 0.55 * random()) }));
}

/** Once the last person has cut, the bots still thinking wrap up within this long. */
export const BOT_HURRY_MS = { min: 400, max: 1500 } as const;

/**
 * Nobody should sit waiting for a bot: when every person in the round has
 * cut, bring the remaining bots' moments forward. Returns whether any moved.
 */
export function hurryBots(data: RoomData, now: number, random: () => number): boolean {
  const round = data.rounds.at(-1);
  if (!round || round.status !== "cutting" || !round.botPlans?.length) return false;
  const waitingOnPeople = data.players.some(
    (p) => !isBot(p) && round.participants.includes(p.id) && p.lastCutRound < round.number,
  );
  if (waitingOnPeople) return false;
  let moved = false;
  for (const plan of round.botPlans) {
    const soon = now + BOT_HURRY_MS.min + (BOT_HURRY_MS.max - BOT_HURRY_MS.min) * random();
    if (plan.at > soon) {
      plan.at = soon;
      moved = true;
    }
  }
  return moved;
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** A bot's aim: the plane that leaves target ± noise on one side, at a random angle. */
export function botPlane(round: RoundRecord, bot: PlayerRecord, random: () => number): Plane {
  const object = generateObject(round.kind, objectSeed(round.seed, bot.id, round.rule));
  const harder = round.rule.type === "blind" ? 1.4 : round.rule.type === "blitz" ? 1.2 : 1;
  const error = Math.abs(gaussian(random)) * BOT_SKILL[bot.bot!.level] * harder;
  const target = ruleTarget(round.rule);
  // cutError = 2·|fraction − target|, so half the error goes into the fraction.
  const fraction = Math.min(0.98, Math.max(0.02, target + (random() < 0.5 ? -1 : 1) * (error / 2)));
  const angle = random() * Math.PI;
  return findPlaneAtFraction(object.mesh, [Math.cos(angle), 0, Math.sin(angle)], random() < 0.5 ? fraction : 1 - fraction);
}

/** Lets every bot whose moment has come make its cut. Returns whether anything changed. */
export function runDueBots(data: RoomData, now: number, random: () => number): boolean {
  const round = data.rounds.at(-1);
  if (!round || round.status !== "cutting" || !round.botPlans?.length) return false;
  const due = round.botPlans.filter((plan) => plan.at <= now);
  if (!due.length) return false;
  round.botPlans = round.botPlans.filter((plan) => plan.at > now);
  for (const plan of due) {
    const bot = data.players.find((p) => p.id === plan.playerId);
    if (!bot || round.status !== "cutting") continue;
    submitCut(data, bot.id, round.number, botPlane(round, bot, random), Math.min(now, round.deadline));
  }
  return true;
}

/** Public tables: once the countdown ends, fill empty seats with bots so nobody plays alone. */
export function fillPublicTable(data: RoomData, now: number, random: () => number): void {
  const levels: BotLevel[] = ["easy", "medium", "medium", "hard"];
  while (data.players.length < PUBLIC_TABLE_SIZE) {
    addBot(data, null, levels[Math.floor(random() * levels.length)]!, now, random);
  }
}
