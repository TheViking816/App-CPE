// The Git preview shares the production database until an isolated preview DB is attached.
// Keep every exchange action read-only in that state.
export const EXCHANGE_PREVIEW_READ_ONLY =
  import.meta.env.VITE_DEPLOYMENT_ENV === "preview"
  && import.meta.env.VITE_GITHUB_SYNC_REF === "codex/exchange-conversations"
  && import.meta.env.VITE_EXCHANGE_PREVIEW_WRITES !== "true";
