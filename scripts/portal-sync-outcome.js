// A rejected premium key does not invalidate the successful portal login or journals.
export function isPremiumCredentialNotice(message) {
  return /clave de seguridad de (?:primas|n[oó]mina electr[oó]nica) (?:es incorrecta|no fue validada)/i.test(String(message || ""));
}

export function isExpectedEmptySectionNotice(message) {
  return /contratacion actual no se pudo actualizar\. No se pudo leer la contratacion actual|vacaciones no devolvio datos; se conserva la ultima lectura disponible/i.test(String(message || ""));
}

export function syncOutcome(sync) {
  const notices = [...(sync?.notices || []), ...(sync?.warnings || [])]
    .filter((message) => !isExpectedEmptySectionNotice(message));
  const errors = (sync?.errors || []).filter((message) => !isExpectedEmptySectionNotice(message));
  const effectivelyPartial = Boolean(sync?.partial) && notices.length > 0;
  const completedPartial = effectivelyPartial && Number(sync?.freshSections) > 0 && !sync?.inProgress;
  const syncErrors = sync?.error && !isExpectedEmptySectionNotice(sync.error) ? [sync.error] : [];
  const details = [...new Set([...notices, ...errors, ...syncErrors])];
  return {
    failed: !sync || Boolean(sync.inProgress) || (!completedPartial && (Boolean(sync.failed) || errors.length > 0)),
    errorMessage: errors.join(" ") || syncErrors[0] || "La sincronizacion no ha finalizado.",
    message: completedPartial
      ? "Lectura parcial completada: " + (details.join(" ") || "Se conservan las secciones anteriores no actualizadas.")
      : details.length ? "Portal sincronizado con avisos: " + details.join(" ") : "Portal sincronizado"
  };
}

export function isExplicitSectionFailure(message) {
  if (isPremiumCredentialNotice(message)) return false;
  return /timeout|timed out|net::|ECONN|HTTP\s*[45]\d\d|no termin[oó] de cargar|calendario no incluye|no devolvi[oó].*(?:PDF|tabla reconocible)/i.test(String(message || ""));
}
