import { isHoliday } from "../src/payroll.js";

// These readers run inside Noray's iframe through Playwright frame.evaluate.
// Keep them self-contained: functions sent to the browser cannot use imports.
export function readNorayDoublesCalendarDom() {
  const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const heading = document.querySelector("h2")?.textContent?.trim() || "";
  const match = heading.toLocaleLowerCase("es").match(/^([a-záéíóúñ]+)\s+(\d{4})$/i);
  const month = match ? monthNames.indexOf(match[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "")) + 1 : 0;
  const year = match ? Number(match[2]) : 0;
  const days = [...document.querySelectorAll("div.cursor-pointer")].map((cell, index) => {
    const day = Number(cell.querySelector(":scope > div:first-child > span:first-child")?.textContent?.trim());
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    const code = [...cell.querySelectorAll(":scope > div:first-child > span")]
      .map((span) => span.textContent?.trim().toUpperCase())
      .find((value) => ["DS", "SL", "VA", "FS"].includes(value)) || "";
    const badges = [...cell.querySelectorAll(":scope > div:last-child > span[title]")].map((badge) => ({
      title: badge.getAttribute("title")?.trim() || "",
      count: Number(badge.textContent?.trim()) || 0
    }));
    return { day, code, status: cell.getAttribute("title")?.trim() || "", badges, domIndex: index };
  }).filter(Boolean);
  return { monthLabel: heading, month, year, days };
}

export function readNorayDoublesModalDom() {
  const heading = [...document.querySelectorAll("h3")]
    .map((element) => element.textContent?.trim() || "")
    .find((value) => /^dobles\s*[-–]\s*\d{1,2}\/\d{1,2}\/\d{4}$/i.test(value)) || "";
  const dateParts = heading.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = dateParts
    ? `${dateParts[1].padStart(2, "0")}/${dateParts[2].padStart(2, "0")}/${dateParts[3]}`
    : "";
  const table = [...document.querySelectorAll("table")]
    .find((element) => /especialidad/i.test(element.querySelector("thead")?.textContent || ""));
  if (!date || !table) return { recognized: false, date, rows: [], relay: { meal: false, dinner: false } };
  const headerRows = [...table.querySelectorAll("thead tr")];
  const shiftHeaders = [...(headerRows.at(-1)?.querySelectorAll("th") || [])].slice(1).map((cell) => {
    const hours = cell.textContent?.match(/(\d{1,2})\s*A\s*(\d{1,2})\s*H\.?/i);
    return hours ? `${hours[1].padStart(2, "0")}/${hours[2].padStart(2, "0")}` : "";
  });
  const rows = [];
  const addChecked = (cells, specialty) => {
    [...cells].slice(1).forEach((cell, index) => {
      if (cell.querySelector('input[type="checkbox"]')?.checked && shiftHeaders[index]) {
        rows.push({ specialty, journey: shiftHeaders[index] });
      }
    });
  };
  if (headerRows.length > 1) addChecked(headerRows[0].querySelectorAll("th"), "SOLO OPERACIÓN");
  for (const row of table.querySelectorAll("tbody tr")) {
    const cells = row.querySelectorAll("td");
    const specialty = cells[0]?.textContent?.trim() || "";
    if (specialty) addChecked(cells, specialty);
  }
  const hourChecked = (label) => [...document.querySelectorAll("label")]
    .some((element) => element.textContent?.trim().toLocaleLowerCase("es") === label
      && element.querySelector('input[type="checkbox"]')?.checked);
  return {
    recognized: shiftHeaders.some(Boolean), date, rows,
    relay: { meal: hourChecked("comida"), dinner: hourChecked("cena") }
  };
}

export function mapNorayDoublesMonth(calendar, details = []) {
  if (!calendar?.month || !calendar?.year || !Array.isArray(calendar.days)) {
    throw new Error("Calendario de dobles no reconocido");
  }
  const totalDays = new Date(calendar.year, calendar.month, 0).getDate();
  const dates = new Set(calendar.days.map((item) => item.day));
  if (dates.size !== totalDays || [...dates].some((day) => day < 1 || day > totalDays)) {
    throw new Error("Calendario de dobles incompleto");
  }
  const detailByDate = new Map(details.map((item) => [item.date, item]));
  const rows = [];
  const relayHours = [];
  const calendarDays = [];
  const queriedDates = [];
  for (const day of [...calendar.days].sort((left, right) => left.day - right.day)) {
    const date = `${String(day.day).padStart(2, "0")}/${String(calendar.month).padStart(2, "0")}/${calendar.year}`;
    queriedDates.push(date);
    calendarDays.push({ date, code: day.code || "", status: day.status || "" });
    const unknownBadges = (day.badges || []).filter((badge) => badge.count > 0
      && !/\d{1,2}\s*A\s*\d{1,2}\s*H/i.test(badge.title)
      && !/^(?:comida|cena)$/i.test(badge.title));
    if (unknownBadges.length) throw new Error(`Dobles: indicador desconocido para ${date}`);
    const doubleCount = (day.badges || []).filter((badge) => /\d{1,2}\s*A\s*\d{1,2}\s*H/i.test(badge.title))
      .reduce((sum, badge) => sum + badge.count, 0);
    const relayCount = (day.badges || []).filter((badge) => /^(?:comida|cena)$/i.test(badge.title))
      .reduce((sum, badge) => sum + badge.count, 0);
    if (!doubleCount && !relayCount) continue;
    const detail = detailByDate.get(date);
    if (!detail?.recognized || detail.date !== date) throw new Error(`Dobles: detalle incompleto para ${date}`);
    const foundRelay = Number(Boolean(detail.relay?.meal)) + Number(Boolean(detail.relay?.dinner));
    if (detail.rows.length !== doubleCount || foundRelay !== relayCount) {
      throw new Error(`Dobles: los indicadores y casillas no coinciden para ${date}`);
    }
    const holiday = isHoliday(`${calendar.year}-${String(calendar.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`);
    for (const row of detail.rows) rows.push({ date, specialty: row.specialty, journey: row.journey, holiday });
    if (detail.relay.meal) relayHours.push({ date, period: "Comida", journey: "14/15", holiday });
    if (detail.relay.dinner) relayHours.push({ date, period: "Cena", journey: "20/21", holiday });
  }
  return {
    recognized: true, complete: true, month: calendar.month, year: calendar.year,
    monthLabel: calendar.monthLabel, windowDays: totalDays,
    startDate: queriedDates[0], endDate: queriedDates.at(-1), queriedDates,
    rows, relayHours, calendarDays
  };
}
