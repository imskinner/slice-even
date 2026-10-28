import { useState, type FormEvent } from "react";
import { supabaseConfigured } from "./net/supabase.ts";

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

export function Home({ initialCode, busy, error, onCreate, onJoin, onPractice }: HomeProps) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(initialCode);
  const [rounds, setRounds] = useState(5);
  const trimmed = name.trim();

  const submit = (e: FormEvent, action: "create" | "join") => {
    e.preventDefault();
    if (!trimmed) return;
    saveName(trimmed);
    if (action === "create") onCreate(trimmed, rounds);
    else onJoin(trimmed, code);
  };

  return (
    <div className="home">
      <div className="home-card">
        <h1 className="title">Slice Even</h1>
        <p className="tagline">Corte exatamente no meio. A balança não mente.</p>

        {supabaseConfigured ? (
          <>
            <label className="field">
              <span>Seu nome</span>
              <input
                value={name}
                maxLength={24}
                placeholder="Como te chamam?"
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>

            <form className="row" onSubmit={(e) => submit(e, "join")}>
              <input
                className="code-input"
                value={code}
                maxLength={5}
                placeholder="CÓDIGO"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button type="submit" disabled={busy || !trimmed || code.trim().length < 5}>
                Entrar
              </button>
            </form>

            <form className="row" onSubmit={(e) => submit(e, "create")}>
              <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} aria-label="Rodadas">
                {[3, 5, 7, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} rodadas
                  </option>
                ))}
              </select>
              <button type="submit" className="primary" disabled={busy || !trimmed}>
                Criar sala
              </button>
            </form>
          </>
        ) : (
          <p className="notice">
            Multiplayer desligado: configure o Supabase em <code>apps/web/.env.local</code>.
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <button className="link" onClick={onPractice}>
          Treinar sozinho →
        </button>
      </div>
    </div>
  );
}
