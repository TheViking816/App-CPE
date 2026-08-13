const maxIdleMs = Math.max(60_000, Number(process.env.CPE_PORTAL_SESSION_MAX_IDLE_MS || 7_200_000));

async function runJob(jobId) {
  process.env.CPE_PORTAL_SYNC_JOB_ID = jobId;
  try {
    const module = await import(`./sync-portal-oficial-job.js?job=${encodeURIComponent(jobId)}-${Date.now()}`);
    await module.main();
    process.send?.({ jobId, ok: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Error desconocido");
    process.send?.({ jobId, ok: false });
  }
}

process.on("message", (message) => {
  if (message?.type === "run" && message.jobId) void runJob(message.jobId);
});

setInterval(async () => {
  const sessions = globalThis.__cpePortalContextStore;
  if (!sessions) return;
  const now = Date.now();
  for (const [chapa, session] of sessions) {
    if (now - session.lastUsedAt < maxIdleMs) continue;
    await session.context.close().catch(() => {});
    sessions.delete(chapa);
  }
}, 60_000).unref();
