import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Multiplayer needs Supabase; practice mode works without it. */
export const supabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!supabaseConfigured) throw new Error("Supabase não configurado (veja apps/web/.env.example)");
  client ??= createClient(url!, key!, {
    auth: {
      // One anonymous player per browser tab: reloads keep you in your room,
      // and opening a second tab gives a second player (handy for testing).
      storage: window.sessionStorage,
      persistSession: true,
    },
  });
  return client;
}

/** Signs in anonymously if needed and returns the user id. */
export async function ensureSignedIn(): Promise<string> {
  const auth = supabase().auth;
  const { data } = await auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signedIn, error } = await auth.signInAnonymously();
  if (error || !signedIn.user) {
    throw new Error(
      error?.message.includes("Anonymous sign-ins are disabled")
        ? "Login anônimo desativado no Supabase (Authentication > Sign In / Providers)."
        : `Não foi possível entrar: ${error?.message ?? "erro desconhecido"}`,
    );
  }
  return signedIn.user.id;
}
