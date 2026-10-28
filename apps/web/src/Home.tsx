import { useState, type FormEvent } from "react";
import { supabaseConfigured } from "./net/supabase.ts";
import { HomeBackground } from "./home/HomeBackground.tsx";

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

export function Home({ initialCode, busy, error, onCreate, onJoin, onPractice }: HomeProps) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(initialCode);
  const [rounds, setRounds] = useState(5);
  const [slices, setSlices] = useState(0);
  const [bump, setBump] = useState(false);
  const trimmed = name.trim();

  const submit = (e: FormEvent, action: "create" | "join") => {
    e.preventDefault();
    if (!trimmed) return;
    saveName(trimmed);
    if (action === "create") onCreate(trimmed, rounds);
    else onJoin(trimmed, code);
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
            {supabaseConfigured ? (
              <>
                <span className="field-label">Seu nome</span>
                <input
                  value={name}
                  maxLength={24}
                  placeholder="Como te chamam?"
                  onChange={(e) => setName(e.target.value)}
                />

                <form className="row" onSubmit={(e) => submit(e, "create")}>
                  <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} aria-label="Rodadas">
                    {[3, 5, 7, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} rodadas
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-yellow" disabled={busy || !trimmed}>
                    Criar sala
                  </button>
                </form>

                <div className="divider">ou entre numa sala</div>

                <form className="row" onSubmit={(e) => submit(e, "join")}>
                  <input
                    className="code-input"
                    value={code}
                    maxLength={5}
                    placeholder="CÓDIGO"
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                  <button type="submit" className="btn btn-blue" disabled={busy || !trimmed || code.trim().length < 5}>
                    Entrar
                  </button>
                </form>
              </>
            ) : (
              <p className="muted">
                Multiplayer desligado: configure o Supabase em <code>apps/web/.env.local</code>.
              </p>
            )}

            {error && <p className="error">{error}</p>}

            <button className="btn btn-green" onClick={onPractice}>
              🔪 Treinar sozinho
            </button>
          </div>

          <div className="home-hint">Passe o mouse rápido pelas frutas para fatiar!</div>
        </div>
      </div>
    </>
  );
}
