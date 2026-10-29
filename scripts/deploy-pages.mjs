// Builds the web app and publishes it to the gh-pages branch, which GitHub
// Pages serves at https://<owner>.github.io/slice-even/.
// Needs apps/web/.env.production.local (VITE_SERVER_URL of the Worker) for multiplayer.
import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "apps", "web", "dist");
const run = (cmd, cwd = root, env = process.env) => execSync(cmd, { cwd, env, stdio: "inherit" });
const read = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();

if (!existsSync(join(root, "apps", "web", ".env.production.local"))) {
  console.warn("warning: apps/web/.env.production.local is missing; the site will only have practice mode");
}

const remote = read("git remote get-url origin");
const commit = read("git rev-parse --short HEAD");

run("npm run build -w @slice-even/web", root, { ...process.env, BASE_PATH: "/slice-even/" });
// Jekyll would skip files starting with an underscore.
writeFileSync(join(dist, ".nojekyll"), "");

rmSync(join(dist, ".git"), { recursive: true, force: true });
run("git init -q -b gh-pages", dist);
run("git add -A", dist);
run(`git commit -q -m "Deploy ${commit}"`, dist);
run(`git push -f -q ${remote} gh-pages`, dist);
rmSync(join(dist, ".git"), { recursive: true, force: true });
console.log(`Deployed ${commit} to gh-pages`);
