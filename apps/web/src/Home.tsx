import { useRef, useState, type FormEvent } from "react";
import { multiplayerConfigured } from "./net/rooms.ts";
import { HomeBackground } from "./home/HomeBackground.tsx";
import { isTouchDevice } from "./ui/TouchControls.tsx";

const NAME_KEY = "slice-even:name";

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode: the name just won't be remembered.
  }
}

interface HomeProps {
  initialCode: string;
  busy: boolean;
  error: string | null;
  onCreate(name: string, rounds: number): void;
  onJoin(name: string, code: string): void;
  onPractice(): void;
  onDaily(): void;
  onSurvival(): void;
  onRecords(): void;
  onQuickPlay(name: string): void;
}

export function Logo() {
  // Two clipped copies of the word, offset along a diagonal "cut".
  const word = (
    <>
      SLICE <span className="even">EVEN</span>
    </>
  );
  return (
    <h1 className="logo" aria-label="Slice Even">
      <span className="logo-half top" aria-hidden>
        {word}
      </span>
      <span className="logo-half bottom" aria-hidden>
        {word}
      </span>
      <span className="logo-cut" aria-hidden />
    </h1>
  );
}

export function Home({
  initialCode,
  busy,
  error,
  onCreate,
  onJoin,
  onPractice,
  onDaily,
  onSurvival,
  onRecords,
  onQuickPlay,
}: HomeProps) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(initialCode);
  const [rounds, setRounds] = useState(5);
  const [slices, setSlices] = useState(0);
  const [bump, setBump] = useState(false);
  /** What a tap could not go ahead without: shown as a hint, with the field focused. */
  const [missing, setMissing] = useState<"name" | "code" | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  /**
   * Playing with others needs a name. The buttons stay enabled and say what
   * is missing when tapped, rather than sitting there greyed out.
   */
  const withName = (action: (name: string) => void) => {
    if (!trimmed) {
      setMissing("name");
      nameInput.current?.focus();
      return;
    }
    setMissing(null);
    saveName(trimmed);
    action(trimmed);
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    withName((n) => onCreate(n, rounds));
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    withName((n) => {
      if (code.trim().length < 5) {
        setMissing("code");
        codeInput.current?.focus();
        return;
      }
      onJoin(n, code);
    });
  };

  const onSlice = () => {
    setSlices((n) => n + 1);
    setBump(true);
    setTimeout(() => setBump(false), 150);
  };

  return (
    <>
      <HomeBackground onSlice={onSlice} />
      {slices > 0 && <div className={bump ? "slice-counter bump" : "slice-counter"}>🔪 {slices}</div>}

      <div className="home">
        <div className="home-stack">
          <Logo />
          <p className="tagline">Corte exatamente no meio. A balança não mente.</p>

          <div className="home-card panel">
            {multiplayerConfigured ? (
              <>
                <span className="field-label">Seu nome</span>
                <input
                  ref={nameInput}
                  value={name}
                  maxLength={24}
                  placeholder="Como te chamam?"
                  onChange={(e) => {
                    setName(e.target.value);
                    if (missing === "name") setMissing(null);
                  }}
                />
                {missing === "name" && <p className="error">Diga seu nome para jogar com outras pessoas.</p>}

                {/* The one main action: straight into a game. */}
                <button className="btn btn-yellow btn-main" disabled={busy} onClick={() => withName(onQuickPlay)}>
                  ⚡ Jogar agora
                  <small>mesa rápida com quem estiver online</small>
                </button>

                <div className="divider">ou com amigos</div>

                <form className="row" onSubmit={create}>
                  <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} aria-label="Rodadas">
                    {[3, 5, 7, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} rodadas
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn" disabled={busy}>
                    Criar sala
                  </button>
                </form>

                <form className="row" onSubmit={join}>
                  <input
                    ref={codeInput}
                    className="code-input"
                    value={code}
                    maxLength={5}
                    placeholder="CÓDIGO"
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      if (missing === "code") setMissing(null);
                    }}
                  />
                  <button type="submit" className="btn" disabled={busy}>
                    Entrar
                  </button>
                </form>
                {missing === "code" && <p className="error">O código da sala tem 5 letras.</p>}
              </>
            ) : (
              <p className="muted">
                Multiplayer desligado: configure <code>VITE_SERVER_URL</code> em <code>apps/web/.env.local</code>.
              </p>
            )}

            {error && <p className="error">{error}</p>}

            <div className="divider">ou sozinho</div>

            <div className="solo-row">
              {multiplayerConfigured && (
                <button className="btn btn-pink tile" onClick={onDaily}>
                  <span>🗓️</span>
                  Desafio do dia
                </button>
              )}
              <button className="btn btn-blue tile" onClick={onSurvival}>
                <span>❤️</span>
                Sobrevivência
              </button>
              <button className="btn btn-green tile" onClick={onPractice}>
                <span>🔪</span>
                Treino
              </button>
            </div>
          </div>

          <button className="btn btn-small" onClick={onRecords}>
            🏅 Recordes e conquistas
          </button>
          <div className="home-hint">Passe o {isTouchDevice() ? "dedo" : "mouse"} rápido pelas frutas para fatiar!</div>
        </div>
      </div>
    </>
  );
}
