// A rejected premium key does not invalidate the successful portal login or journals.
export function isPremiumCredentialNotice(message) {
  return /clave de seguridad de (?:primas|n[oó]mina electr[oó]nica) (?:es incorrecta|no fue validada)/i.test(String(message || ""));
}

export function syncOutcome(sync) {
  const notices = [...(sync?.notices || []), ...(sync?.warnings || [])];
  const errors = sync?.errors || [];
  const completedPartial = Boolean(sync?.partial) && Number(sync?.freshSections) > 0 && !sync?.inProgress;
  const details = [...new Set([...notices, ...errors, ...(sync?.error ? [sync.error] : [])])];
  return {
    failed: !sync || Boolean(sync.inProgress) || (!completedPartial && (Boolean(sync.failed) || errors.length > 0)),
    errorMessage: errors.join(" ") || sync?.error || "La sincronizacion no ha finalizado.",
    message: completedPartial
      ? "Lectura parcial completada: " + (details.join(" ") || "Se conservan las secciones anteriores no actualizadas.")
      : details.length ? "Portal sincronizado con avisos: " + details.join(" ") : "Portal sincronizado"
  };
}

export function isExplicitSectionFailure(message) {
  if (isPremiumCredentialNotice(message)) return false;
  return /timeout|timed out|net::|ECONN|HTTP\s*[45]\d\d|no termin[oó] de cargar|calendario no incluye|no devolvi[oó].*(?:PDF|tabla reconocible)/i.test(String(message || ""));
}
