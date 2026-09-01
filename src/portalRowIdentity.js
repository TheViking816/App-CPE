function normalizedToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizePortalPart(value) {
  const normalized = normalizedToken(value);
  if (normalized === "CA" || normalized.includes("CONTRATACIONANTICIPADA")) return "CA";
  return normalized;
}

export function canonicalPortalPart(row) {
  const part = normalizePortalPart(row?.parte);
  const operation = normalizedToken(row?.operacion);
  const specialty = normalizedToken(row?.especialidad);
  const isReserveGroup = operation.includes("RESERVAIIIYIV")
    || /^RESERVAG(?:III|IV)$/.test(specialty);

  if (isReserveGroup && (part === "CA" || part === "RESERVA")) {
    return "RESERVAIIIYIV";
  }
  return part;
}

export function normalizeReservePortalRow(row) {
  const operation = normalizedToken(row?.operacion);
  const specialty = normalizedToken(row?.especialidad);
  if (!operation.includes("RESERVAIIIYIV")) return row;
  if (specialty === "RESERVAGIII") {
    return { ...row, especialidad: "CLASIFICADOR", payrollGroup: "III" };
  }
  if (specialty === "RESERVAGIV") {
    return { ...row, payrollGroup: "IV" };
  }
  return row;
}
