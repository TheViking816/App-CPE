const LABELS = [
  ["parte", /^parte:?$/i],
  ["fecha", /^fecha:?$/i],
  ["jornada", /^jornada:?$/i],
  ["especialidad", /^especialidad:?$/i],
  ["tipo", /^tipo:?$/i],
  ["empresa", /^empresa:?$/i],
  ["muelle", /^muelle:?$/i],
  ["buque", /^buque:?$/i],
  ["operacion", /^operaci.n:?$/i],
  ["mercancia", /^mercanc.a:?$/i],
  ["observaciones", /^observaciones:?$/i]
];

function normalizeCell(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
    const assignment = {};
    rows.forEach((row) => {
      for (let index = 0; index < row.length - 1; index += 1) {
        const key = findLabel(row[index]);
        if (!key || assignment[key]) continue;
        const value = normalizeCell(row[index + 1]);
        if (value && !findLabel(value)) assignment[key] = value;
      }
    });

    if (assignment.parte && (assignment.fecha || assignment.jornada)) assignments.push(assignment);
  });

  const unique = new Map();
  assignments.forEach((assignment) => {
    const key = [assignment.parte, assignment.fecha, assignment.jornada].join("|");
    unique.set(key, assignment);
  });

  return { recognized, rows: [...unique.values()] };
}
