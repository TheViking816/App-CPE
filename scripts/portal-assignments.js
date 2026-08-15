const LABELS = [
  ["parte", /^parte:?$/i],
  ["fecha", /^fecha:?$/i],
  ["jornada", /^jornada:?$/i],
  ["especialidad", /^especialidad:?$/i],
  ["tipo", /^tipo:?$/i],
  ["empresa", /^empresa:?$/i],
  ["muelle", /^muelle:?$/i],
  ["buque", /^buque:?$/i],
  ["operacion", /^operaci.*n:?$/i],
  ["mercancia", /^mercanc.*a:?$/i],
  ["observaciones", /^observaciones:?$/i]
];

const WINDOWS_1252_BYTES = new Map([
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84], ["…", 0x85],
  ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88], ["‰", 0x89], ["Š", 0x8a],
  ["‹", 0x8b], ["Œ", 0x8c], ["Ž", 0x8e], ["‘", 0x91], ["’", 0x92],
  ["“", 0x93], ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97],
  ["˜", 0x98], ["™", 0x99], ["š", 0x9a], ["›", 0x9b], ["œ", 0x9c],
  ["ž", 0x9e], ["Ÿ", 0x9f]
]);

export function repairPortalEncoding(value = "") {
  const source = String(value || "");
  if (!/[ÃÂâ]/.test(source)) return source;

  const bytes = [];
  for (const character of source) {
    const code = character.codePointAt(0);
    const byte = code <= 0xff ? code : WINDOWS_1252_BYTES.get(character);
    if (byte === undefined) return source;
    bytes.push(byte);
  }

  const decoded = Buffer.from(bytes).toString("utf8");
  return decoded.includes("\uFFFD") ? source : decoded;
}

function normalizeCell(value) {
  return repairPortalEncoding(value).replace(/\s+/g, " ").trim();
}

function findLabel(value) {
  const normalized = normalizeCell(value);
  return LABELS.find(([, pattern]) => pattern.test(normalized))?.[0] || "";
}

export function parseAssignmentsFromTables(tables = [], pageText = "") {
  const recognized = /(?:donde|dónde)\s+voy|orden\s+servicio/i.test(pageText)
    || tables.some((rows) => rows.some((row) => row.some((cell) => /^parte:?$/i.test(normalizeCell(cell)))));
  const assignments = [];

  tables.forEach((rows) => {
    let assignment = {};

    const saveAssignment = () => {
      if (assignment.parte && (assignment.fecha || assignment.jornada)) {
        assignments.push(assignment);
      }
      assignment = {};
    };

    rows.forEach((row) => {
      const startsAssignment = row.some((cell, index) => (
        findLabel(cell) === "parte" && normalizeCell(row[index + 1])
      ));
      if (startsAssignment && assignment.parte) saveAssignment();

      for (let index = 0; index < row.length - 1; index += 1) {
        const key = findLabel(row[index]);
        if (!key || assignment[key]) continue;
        const value = normalizeCell(row[index + 1]);
        if (value && !findLabel(value)) assignment[key] = value;
      }
    });

    saveAssignment();
  });

  const unique = new Map();
  assignments.forEach((assignment) => {
    const key = [assignment.parte, assignment.fecha, assignment.jornada].join("|");
    unique.set(key, assignment);
  });

  return { recognized, rows: [...unique.values()] };
}

const DETAIL_FIELDS = [
  ["parte", /^parte:?$/i],
  ["fecha", /^fecha:?$/i],
  ["jornada", /^jornada:?$/i],
  ["empresa", /^empresa:?$/i],
  ["buque", /^buque:?$/i],
  ["muelle", /^muelle:?$/i],
  ["operacion", /^operaci.*n:?$/i],
  ["mercancia", /^mercanc.*a:?$/i],
  ["observaciones", /^observaciones:?$/i]
];

function parseWorkers(value = "") {
  const text = normalizeCell(value);
  const workers = [];
  const pattern = /([A-Z]?\d{5})\s*-\s*(.*?)(?=\s+(?:[A-Z]?\d{5}\s*-|00000\b)|$)/gi;
  for (const match of text.matchAll(pattern)) {
    workers.push({ code: match[1], name: normalizeCell(match[2]) });
  }
  return workers;
}

export function parseAssignmentDetailFromTables(tables = [], pageText = "") {
  const detail = {};
  const specialties = [];

  tables.forEach((rows) => {
    let currentSpecialty = null;
    rows.forEach((row) => {
      for (let index = 0; index < row.length - 1; index += 1) {
        const normalized = normalizeCell(row[index]);
        const field = DETAIL_FIELDS.find(([, pattern]) => pattern.test(normalized))?.[0];
        if (!field || detail[field]) continue;
        detail[field] = normalizeCell(row[index + 1]);
      }

      const name = normalizeCell(row[0]);
      const requested = Number(normalizeCell(row[1]));
      if (!name || !Number.isFinite(requested) || requested <= 0
        || /^especialidad:?$/i.test(name)
        || DETAIL_FIELDS.some(([, pattern]) => pattern.test(name))) {
        if (!currentSpecialty) return;
        const continuationText = row.join(" ");
        const continuationWorkers = parseWorkers(continuationText);
        const knownCodes = new Set(currentSpecialty.workers.map((worker) => worker.code.toUpperCase()));
        continuationWorkers.forEach((worker) => {
          if (!knownCodes.has(worker.code.toUpperCase())) {
            currentSpecialty.workers.push(worker);
            knownCodes.add(worker.code.toUpperCase());
          }
        });
        currentSpecialty.bolsa = Math.min(
          currentSpecialty.bolsa + (continuationText.match(/\b00000\b/g) || []).length,
          currentSpecialty.requested
        );
        currentSpecialty.unnamed = Math.max(
          currentSpecialty.requested - currentSpecialty.workers.length - currentSpecialty.bolsa,
          0
        );
        return;
      }
      const workerText = row.slice(2).join(" ");
      const workers = parseWorkers(workerText);
      const bolsa = Math.min((workerText.match(/\b00000\b/g) || []).length, requested);
      currentSpecialty = {
        name,
        requested,
        workers,
        bolsa,
        unnamed: Math.max(requested - workers.length - bolsa, 0)
      };
      specialties.push(currentSpecialty);
    });
  });

  const recognized = Boolean(detail.parte && specialties.length)
    || /centro\s+portuario\s+de\s+empleo/i.test(pageText) && specialties.length > 0;
  return { recognized, ...detail, specialties };
}

export function assignmentDetailScore(detail = {}) {
  const specialties = Array.isArray(detail.specialties) ? detail.specialties : [];
  const resolvedWorkers = specialties.reduce((total, specialty) => (
    total + (specialty.workers?.length || 0) + Number(specialty.bolsa || 0)
  ), 0);
  return specialties.length * 1_000_000 + resolvedWorkers;
}

export function isAssignmentDetailComplete(detail = {}) {
  const specialties = Array.isArray(detail.specialties) ? detail.specialties : [];
  return Boolean(detail.recognized && specialties.length) && specialties.every((specialty) => (
    (specialty.workers?.length || 0) + Number(specialty.bolsa || 0) >= Number(specialty.requested || 0)
  ));
}
