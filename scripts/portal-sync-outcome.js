// A rejected premium key does not invalidate the successful portal login or journals.
export function isPremiumCredentialNotice(message) {
  return /clave de seguridad de (?:primas|n[oó]mina electr[oó]nica) (?:es incorrecta|no fue validada)/i.test(String(message || ""));
}

export function syncOutcome(sync) {
  const warnings = (sync?.warnings || []).filter(message => !isPremiumCredentialNotice(message));
  const notices = [...(sync?.notices || []), ...(sync?.warnings || []).filter(isPremiumCredentialNotice)];
  return {
    failed: !sync || Boolean(sync.inProgress) || Boolean(sync.partial && warnings.length),
    message: notices.length ? "Portal sincronizado con avisos: " + notices.join(" ") : "Portal sincronizado"
  };
}
