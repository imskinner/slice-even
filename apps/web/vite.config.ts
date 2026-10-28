import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under /<repo>/; scripts/deploy-pages.mjs sets this.
  base: process.env.BASE_PATH ?? "/",
  server: { port: 5173 },
});
