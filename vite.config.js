import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || (process.env.VERCEL ? "/" : "/App-CPE/"),
  define: {
    "import.meta.env.VITE_GITHUB_SYNC_REF": JSON.stringify(
      process.env.VITE_GITHUB_SYNC_REF
      || process.env.VERCEL_GIT_COMMIT_REF
      || "main"
    )
  },
  plugins: [react()]
});
