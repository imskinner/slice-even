// Copies packages/core/src into each Edge Function that scores cuts, so the
// server runs exactly the same generator and slicing code as the client.
// Edge Functions are bundled from their own folder, hence a copy rather than
// an import across the repo. Run before serving or deploying functions.
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const source = join(root, "packages", "core", "src");
for (const fn of ["submit-cut"]) {
  const target = join(root, "supabase", "functions", fn, "core");
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`core -> supabase/functions/${fn}/core`);
}
