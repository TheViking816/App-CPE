const DATE_PATTERN = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})/;

function cleanText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function textFromHtml(html = "") {
  return cleanText(String(html)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " "));
}

function rowsFromHtml(html = "") {
  const rows = [];
  for (const rowMatch of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => textFromHtml(match[1]).replace(/\|/g, " ").trim())
      .filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function normalizePortalDate(value = "") {
  const match = cleanText(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${year}`;
}

export function cleanMessageBodyText(value = "", { title = "", signature = "" } = {}) {
  return String(value)
    .split(/\r?\n/)
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => line !== cleanText(title) && line !== cleanText(signature))
    .filter((line) => !/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\b.*(?:CPEV|LE[IÍ]DO)/i.test(line))
    .filter((line) => !/^(?:Eliminar|Borrar)$/i.test(line))
    .join("\n")
    .replace(/^\d+\s+/, "")
    .trim();
}

export function extractAddedMessageText(before = "", after = "", options = {}) {
  const existing = new Map();
  String(before).split(/\r?\n/).map(cleanText).filter(Boolean).forEach((line) => {
    existing.set(line, (existing.get(line) || 0) + 1);
  });

  const added = String(after).split(/\r?\n/).map(cleanText).filter(Boolean).filter((line) => {
    const count = existing.get(line) || 0;
    if (!count) return true;
    existing.set(line, count - 1);
    return false;
  });

  return cleanMessageBodyText(added.join("\n"), options);
}

export function parseMessagesHtml(html = "") {
  const pageText = textFromHtml(html);
  const recognized = /Consultas\s+Mensajes|\bMensajes\b/i.test(pageText);
  const messages = [];

  for (const cells of rowsFromHtml(html)) {
    const text = cleanText(cells.join(" "));
    const dateMatch = text.match(DATE_PATTERN);
    if (!dateMatch) continue;

    const beforeDate = cleanText(text.slice(0, dateMatch.index)).replace(/^\d+\s*/, "");
    const afterDate = cleanText(text.slice((dateMatch.index || 0) + dateMatch[0].length)).replace(/^[-–—]\s*/, "");
    if (!beforeDate || !afterDate) continue;

    const readMatch = afterDate.match(/\bLE[IÍ]DO\s+EL\s+(.+)$/i);
    const sender = cleanText(afterDate.replace(/\bLE[IÍ]DO\s+EL\s+.+$/i, "").replace(/[\s,.-]+$/, ""));
    messages.push({
      id: `${normalizePortalDate(dateMatch[1])}-${dateMatch[2]}-${beforeDate}`,
      title: beforeDate,
      date: normalizePortalDate(dateMatch[1]),
      time: dateMatch[2].padStart(5, "0"),
      sender,
      read: Boolean(readMatch),
      readAt: cleanText(readMatch?.[1] || "")
    });
  }

  // En la vista GWT real el titulo y los metadatos pueden quedar en filas
  // anidadas distintas. Recuperamos tambien ese formato desde el texto visible.
  const lines = pageText.split("\n").map(cleanText).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const dateMatch = line.match(DATE_PATTERN);
    if (!dateMatch) continue;
    const inlineTitle = cleanText(line.slice(0, dateMatch.index)).replace(/^\s*\|?\s*\d*\s*\|?\s*/, "");
    const previousTitle = cleanText(lines[index - 1] || "").replace(/^\s*\|?\s*\d*\s*\|?\s*/, "");
    const title = inlineTitle || previousTitle;
    const afterDate = cleanText(line.slice((dateMatch.index || 0) + dateMatch[0].length))
      .replace(/^[-–—]\s*/, "")
      .replace(/\s*\|\s*$/, "");
    if (!title || !afterDate || /^(Consultas|Mensajes)$/i.test(title)) continue;
    const readMatch = afterDate.match(/\bLE[IÍ]DO\s+EL\s+(.+)$/i);
    const sender = cleanText(afterDate.replace(/\bLE[IÍ]DO\s+EL\s+.+$/i, "").replace(/[\s,.-]+$/, ""));
    messages.push({
      id: `${normalizePortalDate(dateMatch[1])}-${dateMatch[2]}-${title}`,
      title,
      date: normalizePortalDate(dateMatch[1]),
      time: dateMatch[2].padStart(5, "0"),
      sender,
      read: Boolean(readMatch),
      readAt: cleanText(readMatch?.[1] || "")
    });
  }

  const unique = new Map(messages.map((message) => [message.id, message]));
  return { recognized, rows: [...unique.values()] };
}

export function parsePayrollsHtml(html = "") {
  const pageText = textFromHtml(html);
  const recognized = /N[oó]mina\s+electr[oó]nica|Cerrar\s+modo\s+seguro/i.test(pageText);
  const inlineTitles = [...pageText.matchAll(/(?:Mensual|Anticipo(?:\s+1-15)?|Paga\s+extra|Revisi[oó]n\s+salarial)[^|\n]{0,80}?(?<!\/)\b(?:0[1-9]|1[0-2])\s*\/\s*\d{2}\b/gi)]
    .map((match) => cleanText(match[0]));
  const rows = rowsFromHtml(html)
    .flatMap((cells) => cells.map(cleanText))
    .concat(pageText.split("\n").map(cleanText))
    .concat(inlineTitles)
    .map((title) => title.replace(/^\d+\s*/, ""))
    .filter((title) => title.length <= 160 && /(?<!\/)\b(?:0[1-9]|1[0-2])\s*\/\s*\d{2}\b/.test(title) && !/\d{1,2}:\d{2}/.test(title))
    .map((value) => {
      const title = cleanText(value.replace(/^\|\s*|\s*\|$/g, ""));
      const rawPeriod = title.match(/(?<!\/)\b((?:0[1-9]|1[0-2])\s*\/\s*\d{2})\b/)?.[1] || "";
      const period = rawPeriod.replace(/\s/g, "");
      const type = cleanText(title.replace(rawPeriod, ""));
      return { id: `${period}-${type}`, title, type, period };
    });

  return { recognized, locked: !/Cerrar\s+modo\s+seguro/i.test(pageText), rows: [...new Map(rows.map((row) => [row.id, row])).values()] };
}

export function buildRequestedDoubles(date, selections = []) {
  const normalizedDate = normalizePortalDate(date);
  return selections
    .map((selection) => ({
      date: normalizedDate,
      specialty: cleanText(selection?.specialty).replace(/^[-–—]\s*/, ""),
      journey: cleanText(selection?.journey).replace(/\s+/g, ""),
      holiday: Boolean(selection?.holiday)
    }))
    .filter((selection) => normalizedDate && selection.specialty && /^\d{2}\/\d{2}$/.test(selection.journey));
}

export function currentMadridMonth(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const totalDays = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    label: new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", month: "long", year: "numeric" }).format(now),
    dates: Array.from({ length: totalDays }, (_, index) => `${String(index + 1).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`)
  };
}
