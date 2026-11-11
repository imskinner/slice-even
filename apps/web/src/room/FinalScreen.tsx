import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Cut, Player, Room, Round } from "../net/rooms.ts";
import { sfx } from "../audio/sfx.ts";
import { Avatar, displayName, rankPlayers, seatColor } from "./players.tsx";
import { matchAwards } from "./awards.ts";
import { ReactionBar } from "./Reactions.tsx";
import "./final.css";

const MEDALS = ["🥇", "🥈", "🥉"];
const CONFETTI = ["#ffc93c", "#ff6b57", "#4cc3f0", "#4cd964", "#b28dff", "#ffffff"];
const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

function shareText(room: Room, ranked: Player[], userId: string): string {
  const lines = [
    `🔪 Slice Even · ${room.total_rounds} rodadas`,
    ...ranked.slice(0, 3).map((p, i) => `${MEDALS[i]} ${displayName(p)} · ${pts(p.score)}`),
  ];
  const mine = ranked.findIndex((p) => p.user_id === userId);
  if (mine >= 3) lines.push(`Eu: ${mine + 1}º · ${pts(ranked[mine]!.score)}`);
  lines.push(`${location.origin}${location.pathname}`);
  return lines.join("\n");
}

/**
 * Game over: the top three on a podium, a few superlatives so more than the
 * champion gets a mention, everyone else below, and a way straight back
 * into another game with the same people.
 */
export function FinalScreen({
  room,
  rounds,
  players,
  cuts,
  userId,
  onRematch,
  onExit,
  onReact,
}: {
  room: Room;
  rounds: Round[];
  players: Player[];
  cuts: Cut[];
  userId: string;
  onRematch(): void;
  onExit(): void;
  onReact(emoji: string): void;
}) {
  const ranked = rankPlayers(players, rounds, cuts);
  const champion = ranked[0]!;
  const awards = useMemo(() => matchAwards(players, rounds, cuts), [players, rounds, cuts]);
  const [copied, setCopied] = useState(false);
  const [confetti] = useState(() =>
    Array.from({ length: 36 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.6,
      duration: 2.4 + Math.random() * 1.8,
      color: CONFETTI[i % CONFETTI.length]!,
      spin: Math.random() * 360,
    })),
  );

  useEffect(() => {
    sfx.fanfare();
  }, []);

  const share = async () => {
    const text = shareText(room, ranked, userId);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  // Second, first, third: the champion stands in the middle.
  const steps = [ranked[1], ranked[0], ranked[2]].filter((p): p is Player => !!p);

  return (
    <>
      <div className="confetti" aria-hidden>
        {confetti.map((c, i) => (
          <i
            key={i}
            style={
              {
                left: `${c.left}%`,
                background: c.color,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.duration}s`,
                "--spin": `${c.spin}deg`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="final panel">
        <div className="dock-head">
          <div className="dock-title">
            {champion.user_id === userId ? "Você é o campeão! 🏆" : `${displayName(champion)} é o campeão! 🏆`}
          </div>
        </div>

        <div className="dock-body">
          <div className="podium">
            {steps.map((p) => {
              const place = ranked.indexOf(p) + 1;
              return (
                <div key={p.user_id} className={`podium-step place-${place}`}>
                  <Avatar player={p} color={seatColor(players, p.user_id)} big />
                  <div className="podium-name">
                    {displayName(p)}
                    {p.user_id === userId ? " (você)" : ""}
                  </div>
                  <div className="podium-block">
                    <span className="podium-medal">{MEDALS[place - 1]}</span>
                    <b>{pts(p.score)}</b>
                  </div>
                </div>
              );
            })}
          </div>

          {awards.length > 0 && (
            <ul className="awards">
              {awards.map((a) => {
                const who = players.find((p) => p.user_id === a.playerId);
                return (
                  <li key={a.title} className={a.playerId === userId ? "award me" : "award"}>
                    <span className="award-emoji">{a.emoji}</span>
                    <span>
                      <b>{a.title}</b>
                      <br />
                      {who ? displayName(who) : "?"} · {a.detail}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {ranked.length > 3 && (
            <ul className="standings">
              {ranked.slice(3).map((p, i) => (
                <li key={p.user_id} className={p.user_id === userId ? "srow final-row me" : "srow final-row"}>
                  <span className="srow-rank">{i + 4}º</span>
                  <Avatar player={p} color={seatColor(players, p.user_id)} />
                  <span className="srow-name">
                    <span>
                      {displayName(p)}
                      {p.user_id === userId ? " (você)" : ""}
                    </span>
                  </span>
                  <span className="srow-total">{pts(p.score)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dock-foot">
          <ReactionBar onReact={onReact} inline />
          <div className="actions">
            <button className="btn btn-yellow" onClick={onRematch}>
              Jogar de novo
            </button>
            <button className="btn btn-green" onClick={share}>
              {copied ? "Copiado! ✓" : "Compartilhar"}
            </button>
            <button className="btn" onClick={onExit}>
              Sair
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
