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

const INLINE_LABELS = [
  ["parte", /^parte:?\s*(.+)$/i],
  ["fecha", /^fecha:?\s*(.+)$/i],
  ["jornada", /^jornada:?\s*((?:de\s+)?\d{1,2}\s*(?:a|-|–|\/)\s*\d{1,2}\s*h?\.?)$/i],
  ["especialidad", /^especialidad:?\s*(.+)$/i],
  ["tipo", /^tipo:?\s*(.+)$/i],
  ["empresa", /^empresa:?\s*(.+)$/i],
  ["muelle", /^muelle:?\s*(.+)$/i],
  ["buque", /^buque:?\s*(.+)$/i],
  ["operacion", /^operaci[oó]n:?\s*(.+)$/iu],
  ["mercancia", /^mercanc.*a:?\s*(.+)$/i],
  ["observaciones", /^observaciones:?\s*(.+)$/i]
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

function findInlineField(value) {
  const normalized = normalizeCell(value);
  for (const [field, pattern] of INLINE_LABELS) {
    const match = normalized.match(pattern);
    if (!match) continue;
    let fieldValue = normalizeCell(match[1]).replace(/^[-:]+\s*/, "").trim();
    if (field === "parte") fieldValue = fieldValue.replace(/\s+--.*$/, "").trim();
    if (/^(?:--?|sin\s+datos?)$/i.test(fieldValue)) fieldValue = "";
    return { field, value: fieldValue };
  }
  return null;
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
  ["especialidad", /^especialidad:?$/i],
  ["tipo", /^tipo:?$/i],
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
  const matches = [...text.matchAll(/\b([A-Z]?\d{5})\b/gi)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match[1] === "00000") continue;
    const nameStart = Number(match.index) + match[0].length;
    const nameEnd = index + 1 < matches.length ? Number(matches[index + 1].index) : text.length;
    const name = normalizeCell(text.slice(nameStart, nameEnd).replace(/^\s*-\s*/, ""));
    workers.push({ code: match[1], name });
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

export function parseAssignmentDetailFromText(pageText = "") {
  const lines = String(pageText || "")
    .split(/\r?\n/)
    .map(normalizeCell)
    .filter(Boolean);
  const detail = {};

  for (let index = 0; index < lines.length; index += 1) {
    const inline = findInlineField(lines[index]);
    if (inline && !detail[inline.field]) {
      detail[inline.field] = inline.value;
      continue;
    }
    const field = DETAIL_FIELDS.find(([, pattern]) => pattern.test(lines[index]))?.[0];
    if (!field || detail[field]) continue;
    detail[field] = lines[index + 1] || "";
  }

  const specialties = [];
  const teamIndex = lines.findIndex((line) => /equipo\s+del\s+parte/i.test(line));
  const modalIndexes = lines
    .map((line, index) => (/^parte\s+([A-Z0-9-]+)$/i.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const modalIndex = modalIndexes.at(-1) ?? -1;
  if (modalIndex >= 0) {
    const modalPart = lines[modalIndex].match(/^parte\s+([A-Z0-9-]+)$/i)?.[1] || "";
    detail.parte = modalPart;
    const cardIndex = lines
      .slice(0, modalIndex)
      .map((line, index) => ({ index, inline: findInlineField(line) }))
      .filter((item) => item.inline?.field === "parte" && item.inline.value === modalPart)
      .at(-1)?.index ?? -1;
    if (cardIndex >= 0) {
      for (let index = cardIndex; index < modalIndex; index += 1) {
        const inline = findInlineField(lines[index]);
        if (index > cardIndex && inline?.field === "parte") break;
        if (inline) detail[inline.field] = inline.value;
      }
    }
  }
  const start = teamIndex >= 0 ? teamIndex + 1 : modalIndex >= 0 ? modalIndex + 1 : 0;
  let current = null;
  let currentHasDeclaredCount = false;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || "";
    if (modalIndex >= 0) {
      const heading = line.match(/^(.+?)\s*\((\d{1,2})\)$/);
      if (heading && Number(heading[2]) > 0) {
        current = {
          name: normalizeCell(heading[1]),
          requested: Number(heading[2]),
          workers: [],
          bolsa: 0,
          unnamed: Number(heading[2])
        };
        currentHasDeclaredCount = true;
        specialties.push(current);
        continue;
      }
      const worker = line.match(/^([A-Z]?\d{5})(?:\s+(?:TUR|BOLSA|BOL))?(?:\s+(.*))?$/i);
      if (worker && worker[1] !== "00000") {
        if (!current) {
          current = {
            name: detail.especialidad || "EQUIPO",
            requested: 0,
            workers: [],
            bolsa: 0,
            unnamed: 0
          };
          currentHasDeclaredCount = false;
          specialties.push(current);
        }
        const code = worker[1];
        if (!current.workers.some((item) => item.code.toUpperCase() === code.toUpperCase())) {
          current.workers.push({ code, name: normalizeCell(worker[2] || "") });
          if (!currentHasDeclaredCount) current.requested = current.workers.length;
          current.unnamed = Math.max(current.requested - current.workers.length, 0);
        }
        continue;
      }
    }
    if (!/^\d+$/.test(line) && /^\d+$/.test(next)) {
      const requested = Number(next);
      if (requested > 0 && requested < 100) {
        current = { name: line, requested, workers: [], bolsa: 0, unnamed: requested };
        currentHasDeclaredCount = true;
        specialties.push(current);
        index += 1;
        continue;
      }
    }
    if (!current) continue;
    const match = line.match(/^([A-Z]?\d{5})(?:\s+(.*))?$/i);
    if (!match || match[1] === "00000") continue;
    const code = match[1];
    if (current.workers.some((worker) => worker.code.toUpperCase() === code.toUpperCase())) continue;
    current.workers.push({ code, name: normalizeCell(match[2] || "") });
    current.unnamed = Math.max(current.requested - current.workers.length, 0);
  }

  const recognized = Boolean(detail.parte && specialties.length)
    || (teamIndex >= 0 || modalIndex >= 0) && specialties.length > 0;
  return { recognized, ...detail, specialties };
}

export function assignmentDetailScore(detail = {}) {
  const specialties = Array.isArray(detail.specialties) ? detail.specialties : [];
  const namedWorkers = specialties.reduce((total, specialty) => (
    total + (specialty.workers || []).filter((worker) => normalizeCell(worker?.name)).length
  ), 0);
  const resolvedWorkers = specialties.reduce((total, specialty) => (
    total + (specialty.workers?.length || 0) + Number(specialty.bolsa || 0)
  ), 0);
  // Keep completeness as the main signal, but prefer a published chapa/name
  // over an unresolved 00000 when the responsive portal replaces it later.
  return specialties.length * 1_000_000 + resolvedWorkers * 1_000 + namedWorkers;
}

export function parseAssignmentsFromText(pageText = "") {
  const lines = String(pageText || "")
    .split(/\r?\n/)
    .map(normalizeCell)
    .filter(Boolean);
  const assignments = [];
  let assignment = {};

  const saveAssignment = () => {
    if (assignment.parte && (assignment.fecha || assignment.jornada)) assignments.push(assignment);
    assignment = {};
  };

  for (let index = 0; index < lines.length; index += 1) {
    const inline = findInlineField(lines[index]);
    if (inline) {
      if (inline.field === "parte" && assignment.parte) saveAssignment();
      if (inline.value && !assignment[inline.field]) assignment[inline.field] = inline.value;
      continue;
    }
    const key = findLabel(lines[index]);
    if (!key) continue;
    if (key === "parte" && assignment.parte) saveAssignment();
    const value = lines[index + 1] || "";
    if (value && !findLabel(value) && !assignment[key]) assignment[key] = value;
  }
  saveAssignment();

  const unique = new Map(assignments.map((item) => (
    [[item.parte, item.fecha, item.jornada].join("|"), item]
  )));
  return {
    recognized: /jornadas\s+contratadas|(?:donde|dónde)\s+voy|orden\s+servicio/i.test(pageText)
      || unique.size > 0,
    rows: [...unique.values()]
  };
}

export function isAssignmentDetailComplete(detail = {}) {
  const specialties = Array.isArray(detail.specialties) ? detail.specialties : [];
  return Boolean(detail.recognized && specialties.length) && specialties.every((specialty) => (
    (specialty.workers?.length || 0) + Number(specialty.bolsa || 0) >= Number(specialty.requested || 0)
  ));
}
