function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/ª/g, "A")
    .replace(/º/g, "O")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function positionIdentity(value) {
  const normalized = normalizeText(value);
  if (/^CONDUCTOR(?: DE)? 1 ?A$/.test(normalized)) {
    return { key: "CONDUCTOR_1A", name: "CONDUCTOR 1a" };
  }
  return { key: normalized || "SIN_ESPECIALIDAD", name: String(value || "Sin especialidad").trim() || "Sin especialidad" };
}

function workerIdentity(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (/^80\d{3}$/.test(digits)) return digits.slice(2);
  return digits || normalizeText(value);
}

function isZeroPlaceholder(worker) {
  const code = String(worker?.code || "").trim();
  const digits = code.replace(/[^0-9]/g, "");
  return Boolean(digits) && /^0+$/.test(digits)
    || /^C?0+$/i.test(code)
    || normalizeText(worker?.name) === "CERO";
}

export function formatFullPartWorkerCode(value) {
  const rawCode = String(value || "").trim();
  if (!/^\d+$/.test(rawCode)) return rawCode;
  if (/^80\d{3}$/.test(rawCode)) return rawCode;
  if (rawCode.length <= 3) return `80${rawCode.padStart(3, "0")}`;
  return rawCode;
}

function visibleWorkerName(value) {
  const name = String(value || "").trim();
  return /^(SIN NOMBRE PUBLICADO|PERSONAL DE BOLSA)$/i.test(normalizeText(name)) ? "" : name;
}

function cleanWorker(worker) {
  return {
    code: String(worker?.code || worker?.chapa || "").trim(),
    name: visibleWorkerName(worker?.name),
  };
}

export function mergeFullPartSpecialties(detailSpecialties = [], bolsaRows = []) {
  const groups = new Map();
  const knownWorkers = new Set();

  const ensureGroup = (position) => {
    const identity = positionIdentity(position);
    if (!groups.has(identity.key)) {
      groups.set(identity.key, { key: identity.key, name: identity.name, requested: 0, workers: [], bolsa: 0, unnamed: 0 });
    }
    return groups.get(identity.key);
  };

  const addWorker = (group, worker) => {
    const cleaned = cleanWorker(worker);
    const identity = workerIdentity(cleaned.code);
    if (!identity || knownWorkers.has(identity)) return false;
    knownWorkers.add(identity);
    group.workers.push(cleaned);
    return true;
  };

  (Array.isArray(detailSpecialties) ? detailSpecialties : []).forEach((specialty) => {
    const group = ensureGroup(specialty?.name);
    const workers = (Array.isArray(specialty?.workers) ? specialty.workers : []).map(cleanWorker);
    const placeholders = workers.filter(isZeroPlaceholder).length;
    const explicitBolsa = Math.max(0, Number(specialty?.bolsa || 0));
    group.requested += Math.max(0, Number(specialty?.requested || 0));
    group.bolsa += Math.max(placeholders, explicitBolsa);
    group.unnamed += Math.max(0, Number(specialty?.unnamed || 0));
    workers.filter((worker) => !isZeroPlaceholder(worker)).forEach((worker) => addWorker(group, worker));
  });

  (Array.isArray(bolsaRows) ? bolsaRows : []).forEach((row) => {
    const group = ensureGroup(row?.puesto || "Personal de bolsa");
    if (!addWorker(group, { ...row, code: formatFullPartWorkerCode(row?.code || row?.chapa) })) return;
    if (group.bolsa > 0) group.bolsa -= 1;
  });

  return [...groups.values()].map(({ key: _key, ...group }) => ({
    ...group,
    requested: Math.max(group.requested, group.workers.length + group.bolsa + group.unnamed),
  }));
}

export function findPartBolsaWorkers(board, assignment) {
  const targetPart = String(assignment?.parte || "").trim();
  const targetDate = String(assignment?.fecha || "").trim();
  const targetShift = String(assignment?.jornada || "").match(/(\d{1,2})\s*(?:A|-|–)\s*(\d{1,2})/i);
  const normalizedShift = targetShift ? `${targetShift[1].padStart(2, "0")}-${targetShift[2].padStart(2, "0")}` : targetShift;
  const dateMatch = targetDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const normalizedDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}` : targetDate;
  const journey = (board?.journeys || []).find((item) => item.fecha === normalizedDate && item.jornada === normalizedShift);
  if (!journey) return [];

  const rows = [];
  journey.companies.forEach((company) => company.groups.forEach((group) => {
    if (String(group.parte || "").trim() !== targetPart) return;
    group.specialties.forEach((specialty) => specialty.bolsa.forEach((worker) => rows.push({
      code: formatFullPartWorkerCode(worker.chapa),
      name: visibleWorkerName(worker.name),
      puesto: specialty.name,
    })));
  }));
  return rows;
}
