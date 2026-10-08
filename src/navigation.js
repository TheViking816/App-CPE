export const DEFAULT_TAB = "inicio";

export const VALID_TABS = new Set([
  "inicio",
  "contratacion",
  "sueldometro",
  "descansos",
  "excepciones",
  "vacaciones",
  "nominas",
  "novedades",
  "estado",
  "puertas",
  "censo",
  "portal",
  "tablon",
  "foro",
  "enlaces",
  "monitor"
]);

export function tabFromHash(hash = "") {
  const tab = String(hash).replace(/^#\/?/, "").split(/[/?&]/, 1)[0].toLowerCase();
  return VALID_TABS.has(tab) ? tab : DEFAULT_TAB;
}

export function hashForTab(tab) {
  const safeTab = VALID_TABS.has(tab) ? tab : DEFAULT_TAB;
  return `#/${safeTab}`;
}

const EXCHANGE_OFFER_HASH = /^#\/(descansos|vacaciones)\/oferta\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function exchangeOfferFromHash(hash = "") {
  const match = String(hash).match(EXCHANGE_OFFER_HASH);
  return match ? { tab: match[1].toLowerCase(), offerId: match[2].toLowerCase() } : null;
}

export function hashForExchangeOffer(tab, offerId) {
  const safeId = String(offerId || "").toLowerCase();
  return EXCHANGE_OFFER_HASH.test(`#/${tab}/oferta/${safeId}`)
    ? `#/${tab}/oferta/${safeId}` : hashForTab(tab);
}
