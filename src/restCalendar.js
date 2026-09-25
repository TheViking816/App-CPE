// Transcription of the company calendar supplied for 2026.
export const COMPANY_REST_2026 = {
  9: {
    a: [12, 13, 15, 24], an: [8, 11, 23], av: [10, 14, 29],
    b: [19, 20, 22, 30], bn: [3, 9, 18], bv: [1, 2, 21],
    c: [5, 6, 26, 27], cn: [7, 17, 25], cv: [4, 16, 28]
  },
  10: {
    a: [9], b: [12], cn: [23],
    v: [3, 4, 17, 18, 31], n: [10, 11, 24, 25]
  },
  11: {
    an: [6], bn: [20], cn: [13],
    v: [1, 14, 15, 28, 29], n: [7, 8, 21, 22]
  },
  12: {
    a: [5, 6, 8, 26, 27], an: [7, 28], av: [4, 9],
    b: [12, 13, 24], bn: [14, 15, 16, 29], bv: [10, 11, 22, 23],
    c: [2, 19, 20, 31], cn: [1, 17, 18], cv: [3, 21, 30],
    holiday: [25]
  }
};

export function parseRestGroup(value) {
  const match = String(value || "").toUpperCase().match(/\b([ABC])\s*[-–]?\s*([VN])\b/);
  return match ? { letter: match[1].toLowerCase(), week: match[2].toLowerCase(), label: `${match[1]}-${match[2]}` } : null;
}

export function companyRestType(year, month, day, group) {
  const calendar = Number(year) === 2026 ? COMPANY_REST_2026[Number(month)] : null;
  if (!calendar) return "";
  if (calendar.holiday?.includes(day)) return "holiday";
  if (!group) return "";
  if (calendar[group.letter]?.includes(day) || calendar[`${group.letter}${group.week}`]?.includes(day)) return "rest";
  if (calendar[group.week]?.includes(day)) return "rest";
  return "";
}

export function vacationDateKeys(vacaciones) {
  const dates = new Set();
  for (const period of vacaciones?.rows || []) {
    const parse = (value) => {
      const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
    };
    const start = parse(period.inicio);
    const end = parse(period.fin);
    if (!start || !end || end < start) continue;
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      dates.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
    }
  }
  return dates;
}

export function buildPersonalRestMonths(descansos, vacaciones, now = new Date()) {
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const group = parseRestGroup(descansos?.worker?.group);
  const monthByKey = new Map();
  for (const month of descansos?.months || []) {
    const key = `${month.year}-${String(month.month).padStart(2, "0")}`;
    if (key >= currentKey) monthByKey.set(key, { year: month.year, month: month.month, portal: month });
  }
  if (now.getFullYear() === 2026) {
    for (let month = now.getMonth() + 1; month <= 12; month += 1) {
      const key = `2026-${String(month).padStart(2, "0")}`;
      if (COMPANY_REST_2026[month]) monthByKey.set(key, { ...(monthByKey.get(key) || {}), year: 2026, month });
    }
  }
  const vacationDays = vacationDateKeys(vacaciones);
  return [...monthByKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, month]) => {
    const total = new Date(month.year, month.month, 0).getDate();
    const portalByDay = new Map((month.portal?.days || []).map((day) => [Number(day.day), day]));
    const days = Array.from({ length: total }, (_, index) => {
      const day = index + 1;
      const dateKey = `${key}-${String(day).padStart(2, "0")}`;
      const portal = portalByDay.get(day);
      const companyType = companyRestType(month.year, month.month, day, group);
      const portalCode = String(portal?.code || "").toUpperCase();
      const code = month.portal ? portalCode : companyType === "rest" ? "DS" : "";
      const type = portalCode ? ({ DS: "rest", FS: "festive", FH: "holiday", VA: "portal-vacation", SL: "requested", PA: "permission", FM: "training" }[portalCode] || "other")
        : month.portal ? "" : companyType;
      return { day, dateKey, code, type, vacation: vacationDays.has(dateKey), position: "" };
    });
    return { key, year: month.year, month: month.month, days, source: month.portal ? "portal" : "company" };
  });
}
