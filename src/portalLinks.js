export const PORTAL_HOME_URL = "https://portal.cpevalencia.com/#User";

export function openPortalSectionWindow(url, browserWindow = window) {
  const portalWindow = browserWindow.open(PORTAL_HOME_URL, "portal-cpe");
  if (!portalWindow) return false;

  // Loading a ViewNoray hash in a brand-new tab can leave the portal blank.
  // Let its shell initialize first, then navigate the same tab to the section.
  try { portalWindow.opener = null; } catch { /* Cross-origin window. */ }
  browserWindow.setTimeout(() => {
    try {
      if (!portalWindow.closed) portalWindow.location.href = url;
    } catch {
      // The portal owns this tab; its own navigation remains available.
    }
  }, 1500);
  return true;
}

const portalSection = (label, route) => ({
  label,
  url: `https://portal.cpevalencia.com/#${route}`
});

// Routes checked against the Portal CPE menu. They are portal routes, not
// authentication links: the user still needs their own portal browser session.
export const PORTAL_LINK_GROUPS = [
  {
    title: "Jornada y retribuciones",
    links: [
      portalSection("¿Dónde voy? · Orden de servicio", "User,ViewNoray,0"),
      portalSection("Contratación de jornada", "User,ViewNoray,7"),
      portalSection("Jornales y primas", "User,ViewNoray,1"),
      portalSection("Puertas", "User,ViewNoray,4"),
      portalSection("Chapero", "User,ViewNoray,5"),
      portalSection("Nómina electrónica", "User,ViewPay,Home")
    ]
  },
  {
    title: "Descansos y vacaciones",
    links: [
      portalSection("Solicitar descansos", "User,ViewNoray,16"),
      portalSection("Consulta de posición SL", "User,ViewNoray,9"),
      portalSection("Solicitud de vacaciones", "User,ViewNoray,20")
    ]
  },
  {
    title: "Solicitudes",
    links: [
      portalSection("Bolsa de excepciones", "User,ViewNoray,21"),
      portalSection("Solicitar dobles por especialidad", "User,ViewNoray,17")
    ]
  },
  {
    title: "Perfil y comunicación",
    links: [
      portalSection("Mis especialidades", "User,ViewNoray,2"),
      portalSection("Mensajes", "User,viewMessages,Home")
    ]
  }
];
