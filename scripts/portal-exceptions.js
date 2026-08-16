function cleanText(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value = "") {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function normalizePortalDate(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (/^20\d{6}$/.test(digits)) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  const match = cleanText(value).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
}

function parseRows(html = "") {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => (
    [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) => ({
      html: cellMatch[0],
      value: cleanText(cellMatch[1])
    }))
  ));
}

export const EXCEPTION_RULES = [
  "Puedes solicitar hasta 15 excepciones de jornada al año sin necesidad de justificarlas.",
  "En un mismo día se pueden solicitar como máximo dos jornadas, manteniendo otras dos jornadas hábiles alrededor.",
  "No se pueden solicitar en sábados, domingos, festivos ni en días sin las cuatro jornadas principales.",
  "Se deben solicitar, modificar o eliminar con al menos dos días laborables de antelación desde que se publique la contratación."
];

export function parseExceptions(html = "") {
  const source = String(html || "");
  const pageText = cleanText(source);
  const rows = parseRows(source);
  const headerIndex = rows.findIndex((row) => {
    const values = row.map((cell) => comparable(cell.value));
    return values.some((value) => value === "chapa")
      && values.some((value) => value.includes("jornada"))
      && values.some((value) => value.includes("situacion"));
  });
  const recognized = /bolsa\s+de\s+excepciones|excepciones\s+solicitadas|solicitud\s+excepci[oó]n/i.test(pageText)
    || headerIndex !== -1;

  if (headerIndex === -1) {
    const usedTotal = Number(pageText.match(/ha\s+usado\s+un\s+total\s+de\s*:?\s*(\d+)/i)?.[1] || 0);
    const maxAnnual = Number(pageText.match(/total\s+de\s+(\d+)\s+excepciones\s+de\s+jornada\s+al\s+a[nñ]o/i)?.[1] || 15);
    return { recognized, year: new Date().getFullYear(), maxAnnual, usedTotal, remaining: Math.max(0, maxAnnual - usedTotal), rows: [], rules: EXCEPTION_RULES };
  }

  const headers = rows[headerIndex].map((cell) => comparable(cell.value));
  const findIndex = (pattern, fallback) => {
    const index = headers.findIndex((value) => pattern.test(value));
    return index === -1 ? fallback : index;
  };
  const chapaIndex = findIndex(/^chapa$/, 0);
  const workerIndex = findIndex(/trabajador/, 1);
  const dateIndex = findIndex(/^fecha$/, 2);
  const shiftIndex = findIndex(/jornada/, 3);
  const requestedIndex = findIndex(/pedida|solicitud/, 4);
  const statusIndex = findIndex(/situacion|estado/, 5);
  const usedIndex = findIndex(/utilizada|usada/, 6);

  const parsedRows = rows.slice(headerIndex + 1)
    .filter((row) => /^\d{4,6}$/.test(String(row[chapaIndex]?.value || "").replace(/\D/g, "")))
    .map((row) => {
      const usedCell = row[usedIndex] || { html: "", value: "" };
      const used = /data-app-cpe-checked=["']true|<input\b[^>]*\bchecked(?:\s|=|>)/i.test(usedCell.html)
        || /\b(?:si|sí|usada|utilizada|x)\b/i.test(usedCell.value);
      return {
        chapa: String(row[chapaIndex]?.value || "").replace(/\D/g, ""),
        worker: cleanText(row[workerIndex]?.value || ""),
        date: normalizePortalDate(row[dateIndex]?.value || ""),
        shift: cleanText(row[shiftIndex]?.value || ""),
        requestedAt: normalizePortalDate(row[requestedIndex]?.value || ""),
        status: cleanText(row[statusIndex]?.value || ""),
        used
      };
    })
    .filter((row) => row.date || row.shift || row.status);

  const countedUsed = parsedRows.filter((row) => row.used).length;
  const usedTotal = Number(pageText.match(/ha\s+usado\s+un\s+total\s+de\s*:?\s*(\d+)/i)?.[1] || countedUsed);
  const maxAnnual = Number(pageText.match(/total\s+de\s+(\d+)\s+excepciones\s+de\s+jornada\s+al\s+a[nñ]o/i)?.[1] || 15);
  const year = Number(parsedRows.find((row) => row.date)?.date.slice(0, 4)) || new Date().getFullYear();

  return {
    recognized,
    year,
    maxAnnual,
    usedTotal,
    remaining: Math.max(0, maxAnnual - usedTotal),
    rows: parsedRows,
    rules: EXCEPTION_RULES
  };
}
