import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function norayPilotLocalData() {
  return {
    name: "noray-pilot-local-data",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        if (!pathname.endsWith("/__local/noray-pilot-72683.json")) return next();
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) {
          response.writeHead(403).end();
          return;
        }
        try {
          const payload = await readFile(resolve(".local/noray-pilot-72683.json"));
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(payload);
        } catch (error) {
          response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
        }
      });
    }
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || (process.env.VERCEL ? "/" : "/App-CPE/"),
  define: {
    "import.meta.env.VITE_GITHUB_SYNC_REF": JSON.stringify(
      process.env.VITE_GITHUB_SYNC_REF
      || process.env.VERCEL_GIT_COMMIT_REF
      || "main"
    )
  },
  plugins: [react(), norayPilotLocalData()]
});
