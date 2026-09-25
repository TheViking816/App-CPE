import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The HTML bundle and the uncached version endpoint must carry the same ID.
// A new build of the same commit is still a new deployment.
const appBuildId = `${process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local"}-${Date.now()}`;

export default defineConfig({
  base: process.env.VITE_BASE_PATH || (process.env.VERCEL ? "/" : "/App-CPE/"),
  define: {
    __APP_CPE_BUILD_ID__: JSON.stringify(appBuildId),
    "import.meta.env.VITE_DEPLOYMENT_ENV": JSON.stringify(process.env.VERCEL_ENV || "local"),
    "import.meta.env.VITE_GITHUB_SYNC_REF": JSON.stringify(
      process.env.VITE_GITHUB_SYNC_REF
      || process.env.VERCEL_GIT_COMMIT_REF
      || "main"
    )
  },
  plugins: [
    react(),
    {
      name: "app-cpe-version",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "app-version.json",
          source: JSON.stringify({ version: appBuildId })
        });
      }
    }
  ]
});
