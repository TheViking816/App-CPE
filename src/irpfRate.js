export function normalizeIrpfRate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 60) : null;
}

export function initialIrpfRate(remoteValue, chapa, storage = globalThis.localStorage) {
  const remoteRate = normalizeIrpfRate(remoteValue);
  if (remoteRate !== null) return remoteRate;

  try {
    const normalizedChapa = String(chapa || "").trim();
    const localRate = normalizedChapa
      ? normalizeIrpfRate(storage?.getItem(`app-cpe-irpf-${normalizedChapa}`))
      : null;
    return localRate ?? 0;
  } catch {
    return 0;
  }
}
