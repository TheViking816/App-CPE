function cleanText(value = "") {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function finitePositiveAmount(value) {
  const parsed = typeof value === "number"
    ? value
    : Number.parseFloat(String(value ?? "").replace(/\s|\u00a0|EUR|€/gi, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

export function normalizeNorayDate(value, fallbackYear, fallbackMonth) {
  const text = cleanText(value);
  if (/^20\d{2}-\d{2}-\d{2}$/.test(text)) return text;
  let match = text.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  match = text.match(/^(\d{1,2})$/);
  if (match && positiveInteger(fallbackYear) && positiveInteger(fallbackMonth)) {
    return `${fallbackYear}-${String(fallbackMonth).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  return null;
}

export function normalizeNorayShift(value) {
  const match = cleanText(value).match(/(\d{1,2})\s*(?:A|-|–|\/)\s*(\d{1,2})/i);
  return match ? `${match[1].padStart(2, "0")}${match[2].padStart(2, "0")}` : null;
}

export function norayPremium(liquidacion) {
  if (!liquidacion || typeof liquidacion !== "object") return null;
  const amount = finitePositiveAmount(liquidacion.produccion_cpe)
    ?? finitePositiveAmount(liquidacion.produccion_cap);
  if (amount === null) return null;
  return {
    amount,
    status: liquidacion.en_historico === false ? "pending" : "verified"
  };
}

export function mergeNorayJornales(...collections) {
  const rows = new Map();
  for (const collection of collections) {
    for (const row of Array.isArray(collection) ? collection : []) {
      const year = positiveInteger(row?.anyo);
      const part = positiveInteger(row?.parte);
      const key = part
        ? `${year || ""}:${part}`
        : `${cleanText(row?.fecha)}:${cleanText(row?.jornada)}:${cleanText(row?.especialidad)}`;
      const previous = rows.get(key);
      rows.set(key, previous
        ? { ...previous, ...row, liquidacion: row?.liquidacion ?? previous.liquidacion, pdf: row?.pdf ?? previous.pdf }
        : { ...row });
    }
  }
  return [...rows.values()];
}

export function mergeNorayLiquidations(jornales, liquidaciones, fallbackYear) {
  const byPart = new Map();
  for (const row of Array.isArray(liquidaciones) ? liquidaciones : []) {
    const part = positiveInteger(row?.parte);
    const year = positiveInteger(row?.anyo) ?? positiveInteger(fallbackYear);
    if (part && year && row?.liquidacion) byPart.set(`${year}:${part}`, row.liquidacion);
  }
  return (Array.isArray(jornales) ? jornales : []).map((row) => {
    if (row?.liquidacion) return row;
    const part = positiveInteger(row?.parte);
    const year = positiveInteger(row?.anyo) ?? positiveInteger(fallbackYear);
    return part && year && byPart.has(`${year}:${part}`)
      ? { ...row, liquidacion: byPart.get(`${year}:${part}`) }
      : row;
  });
}

export function sanitizeNorayPartDetail(detail, fallback = {}) {
  if (!detail || typeof detail !== "object") return null;
  const groups = Array.isArray(detail.grupos) ? detail.grupos : [];
  const specialties = groups.map((group) => ({
    name: cleanText(group?.especialidad) || "Sin especialidad",
    requested: Math.max(0, Number(group?.solicitados) || 0),
    workers: (Array.isArray(group?.trabajadores) ? group.trabajadores : [])
      .map((worker) => ({
        code: cleanText(worker?.chapa).replace(/\D/g, ""),
        name: cleanText(worker?.nombre),
        type: cleanText(worker?.tipo),
        category: cleanText(worker?.categoria)
      }))
      .filter((worker) => worker.code && worker.name)
  })).filter((group) => group.workers.length || group.requested > 0);

  if (!specialties.length) return null;
  const fecha = cleanText(detail.fecha || fallback.fecha).replace(/\D/g, "");
  return {
    recognized: true,
    parte: cleanText(detail.parte || fallback.parte),
    fecha: /^20\d{6}$/.test(fecha) ? fecha : cleanText(detail.fecha || fallback.fecha),
    jornada: cleanText(detail.jornada || fallback.jornada),
    empresa: cleanText(detail.empresa || fallback.empresa),
    buque: cleanText(detail.buque || fallback.buque),
    muelle: cleanText(detail.muelle || fallback.muelle),
    operacion: cleanText(detail.operacion || fallback.operacion),
    mercancia: cleanText(detail.mercancia || fallback.mercancia),
    observaciones: cleanText(detail.observaciones || fallback.observaciones),
    specialties
  };
}

export function norayObservation(jornal, detail, context) {
  const parte = String(positiveInteger(jornal?.parte) || "");
  // The live Jornales API identifies the day with `dia`; older captured
  // responses used `fecha`. Accept both so a valid live row is not discarded.
  const fecha = normalizeNorayDate(jornal?.fecha ?? jornal?.dia, context.year, context.month);
  const jornada = cleanText(jornal?.jornada);
  const jornadaKey = normalizeNorayShift(jornada);
  if (!parte || !fecha || !jornadaKey) return null;
  const premium = context.premiumsVerified ? norayPremium(jornal?.liquidacion) : null;
  const partDetail = detail?.recognized === true && Array.isArray(detail?.specialties)
    ? detail
    : sanitizeNorayPartDetail(detail, jornal);
  return {
    source_chapa: context.sourceChapa,
    source_registro: context.registro,
    year: Number(context.year),
    month: Number(context.month),
    fecha,
    parte,
    jornada,
    jornada_key: jornadaKey,
    source_role: cleanText(jornal?.especialidad),
    premium_amount: premium?.amount ?? null,
    premium_status: premium?.status ?? null,
    part_detail: partDetail || {},
    observed_at: context.observedAt
  };
}

export function previousMonths(count, now = new Date()) {
  const months = [];
  const safeCount = Math.max(1, Math.min(24, Number(count) || 1));
  for (let offset = 0; offset < safeCount; offset += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }
  return months;
}
