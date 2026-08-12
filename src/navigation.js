export const DEFAULT_TAB = "inicio";

export const VALID_TABS = new Set([
  "inicio",
  "puertas",
  "censo",
  "portal",
  "tablon",
  "enlaces"
]);

export function tabFromHash(hash = "") {
  const tab = String(hash).replace(/^#\/?/, "").split(/[/?&]/, 1)[0].toLowerCase();
  return VALID_TABS.has(tab) ? tab : DEFAULT_TAB;
}

export function hashForTab(tab) {
  const safeTab = VALID_TABS.has(tab) ? tab : DEFAULT_TAB;
  return `#/${safeTab}`;
}
