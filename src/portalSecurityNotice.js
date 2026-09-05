export function needsPortalSecurityKey(payload) {
  const sync = payload?.sync || {};
  const messages = [...(sync.notices || []), ...(sync.warnings || []), ...(sync.errors || []), sync.error || ""];
  return Boolean(payload?.primas?.locked || payload?.nominas?.locked) || messages.some(message =>
    /clave de primas incorrecta|clave de seguridad.*(?:incorrecta|no fue validada)|(?:primas|nominas|nóminas).*pendientes de introducir la clave de seguridad/i.test(String(message))
  );
}
