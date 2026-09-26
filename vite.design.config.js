import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^\.\/supabaseClient\.js$/, replacement: fileURLToPath(new URL("./src/design-preview/client.js", import.meta.url)) }] },
  define: {
    "import.meta.env.VITE_DEPLOYMENT_ENV": JSON.stringify("preview"),
    "import.meta.env.VITE_GITHUB_SYNC_REF": JSON.stringify("codex/exchange-conversations"),
    "import.meta.env.VITE_EXCHANGE_PREVIEW_WRITES": JSON.stringify("false")
  },
  build: { outDir: "design-dist", rollupOptions: { input: fileURLToPath(new URL("./design.html", import.meta.url)) } }
});
