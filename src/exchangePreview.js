// The Git preview shares the production database until an isolated preview DB is attached.
// Keep every exchange action read-only in that state.
export const EXCHANGE_PREVIEW_READ_ONLY =
  typeof window !== "undefined"
  && /^app-cpe-sueldometro-preview(?:-|\.)/.test(window.location.hostname);
