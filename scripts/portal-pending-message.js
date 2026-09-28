export const PORTAL_PENDING_MESSAGE_EXIT_CODE = 76;

export class PortalPendingMessageError extends Error {
  constructor() {
    super("El portal muestra un mensaje pendiente de aceptar por el usuario; esta lectura se deja para la proxima sincronizacion.");
    this.name = "PortalPendingMessageError";
    this.code = "PORTAL_PENDING_MESSAGE";
  }
}

export function hasPendingPortalMessageHeading(text = "") {
  const normalized = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\bTIENE\s+\d+\s+MENSAJES?\s+NUEVOS?\b/i.test(normalized);
}
