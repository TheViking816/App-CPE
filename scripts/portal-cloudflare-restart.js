export const CLOUDFLARE_RESTART_EXIT_CODE = 75;

export class PortalCloudflareRestartError extends Error {
  constructor() {
    super("Cloudflare solicita verificacion; se detiene esta tanda para reanudar los trabajos pendientes en un proceso nuevo.");
    this.name = "PortalCloudflareRestartError";
    this.code = "CLOUDFLARE_RESTART";
  }
}

export function isVisiblePortalChallenge(text = "") {
  const normalized = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /Verificacion de seguridad en curso|Verifique que es un ser humano|Just a moment|Un momento\.\.\.|Ray ID/i.test(normalized);
}
