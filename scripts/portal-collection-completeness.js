import { normalizePortalPart } from "../src/portalRowIdentity.js";

function clean(value) {
  return String(value || "").trim();
}

function rowKey(row) {
  return [
    Number(row?.dia),
    normalizePortalPart(row?.parte),
    clean(row?.jornada).replace(/\s+/g, "").toLocaleUpperCase("es")
  ].join("|");
}

export function containsAllSavedPortalRows(nextRows = [], savedRows = [], { premiumOnly = false } = {}) {
  const relevantSavedRows = savedRows.filter((row) => {
    if (normalizePortalPart(row?.parte) === "CA") return false;
    return !premiumOnly || /[1-9]/.test(String(row?.produccion || ""));
  });
  const nextKeys = new Set(nextRows.map(rowKey));
  return relevantSavedRows.every((row) => nextKeys.has(rowKey(row)));
}
