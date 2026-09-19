export async function readPortalSectionWithRetry(reader, {
  attempts = 2,
  isAcceptable = () => true,
  shouldRetry = () => true,
  onRetry = async () => {}
} = {}) {
  let lastValue;
  let lastError;
  const totalAttempts = Math.max(1, Number(attempts) || 1);

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      lastValue = await reader();
      lastError = null;
      if (isAcceptable(lastValue)) return { ok: true, value: lastValue, attempts: attempt };
    } catch (error) {
      lastError = error;
    }

    if (attempt >= totalAttempts || !shouldRetry(lastError, lastValue)) break;
    await onRetry({ attempt, error: lastError, value: lastValue });
  }

  return { ok: false, value: lastValue, error: lastError, attempts: totalAttempts };
}
