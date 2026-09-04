// A rejected premium key does not invalidate the successful portal login or journals.
export function isPremiumCredentialNotice(message) {
  return /clave de seguridad de (?:primas|n[oó]mina electr[oó]nica) (?:es incorrecta|no fue validada)/i.test(String(message || ""));
}

export function syncOutcome(sync) {
  const notices = [...(sync?.notices || []), ...(sync?.warnings || [])];
  const errors = sync?.errors || [];
  return {
    failed: !sync || Boolean(sync.inProgress) || Boolean(sync.failed) || errors.length > 0,
    errorMessage: errors.join(" ") || sync?.error || "La sincronizacion no ha finalizado.",
    message: notices.length ? "Portal sincronizado con avisos: " + notices.join(" ") : "Portal sincronizado"
  };
}

export function isExplicitSectionFailure(message) {
  if (isPremiumCredentialNotice(message)) return false;
  return /timeout|timed out|net::|ECONN|HTTP\s*[45]\d\d|no termin[oó] de cargar|calendario no incluye|no devolvi[oó].*(?:PDF|tabla reconocible)/i.test(String(message || ""));
}
