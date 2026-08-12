const VALENCIA_HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-06", "2026-01-22", "2026-03-19", "2026-04-03",
  "2026-04-06", "2026-04-13", "2026-05-01", "2026-06-24", "2026-07-16",
  "2026-08-15", "2026-10-09", "2026-10-12", "2026-11-01", "2026-12-06",
  "2026-12-08", "2026-12-25"
]);

export const SALARY_TABLE = {
  ESTIBA: {
    I: {
      LABORABLE: { "02-08": 216.19, "08-14": 102.19, "14-20": 102.19, "20-02": 153.32 },
      SABADO: { "02-08": 216.19, "08-14": 118.66, "14-20": 183.96, "20-02": 270.55 },
      FESTIVO: { "02-08": 389.23, "08-14": 183.96, "14-20": 260.50, "20-02": 350.68 },
      FESTIVO_TO_LABORABLE: { "02-08": 247.72, "20-02": 310.65 },
      FESTIVO_TO_FESTIVO: { "02-08": 424.44, "20-02": 350.68 },
      LABORABLE_TO_FESTIVO: { "20-02": 194.16 }
    },
    II: {
      LABORABLE: { "02-08": 223.27, "08-14": 105.53, "14-20": 105.53, "20-02": 158.36 },
      SABADO: { "02-08": 223.27, "08-14": 122.02, "14-20": 189.98, "20-02": 279.42 },
      FESTIVO: { "02-08": 401.99, "08-14": 189.98, "14-20": 269.05, "20-02": 362.16 },
      FESTIVO_TO_LABORABLE: { "02-08": 261.16, "20-02": 320.77 },
      FESTIVO_TO_FESTIVO: { "02-08": 438.26, "20-02": 362.16 },
      LABORABLE_TO_FESTIVO: { "20-02": 200.51 }
    },
    III: {
      LABORABLE: { "02-08": 225.82, "08-14": 106.56, "14-20": 106.56, "20-02": 159.91 },
      SABADO: { "02-08": 225.82, "08-14": 131.81, "14-20": 191.77, "20-02": 282.10 },
      FESTIVO: { "02-08": 405.86, "08-14": 191.66, "14-20": 271.51, "20-02": 365.52 },
      FESTIVO_TO_LABORABLE: { "02-08": 269.62, "20-02": 323.86 },
      FESTIVO_TO_FESTIVO: { "20-02": 365.62 },
      LABORABLE_TO_FESTIVO: { "20-02": 159.91 }
    },
    IV: {
      LABORABLE: { "02-08": 238.98, "08-14": 122.17, "14-20": 122.17, "20-02": 169.25 },
      SABADO: { "02-08": 238.98, "08-14": 138.49, "14-20": 203.00, "20-02": 298.55 },
      FESTIVO: { "02-08": 429.56, "08-14": 202.88, "14-20": 287.36, "20-02": 386.88 },
      FESTIVO_TO_LABORABLE: { "02-08": 294.81, "20-02": 342.76 },
      FESTIVO_TO_FESTIVO: { "20-02": 386.98 },
      LABORABLE_TO_FESTIVO: { "20-02": 169.25 }
    }
  },
  RECEPCION_ENTREGA: {
    I: {
      LABORABLE: { "02-08": 291.41, "08-14": 148.63, "14-20": 148.63, "20-02": 222.91 },
      SABADO: { "02-08": 291.41, "08-14": 165.13, "14-20": 267.50, "20-02": 393.35 },
      FESTIVO: { "02-08": 524.52, "08-14": 267.50, "14-20": 378.82, "20-02": 509.96 },
      FESTIVO_TO_LABORABLE: { "02-08": 333.73, "20-02": 451.76 },
      FESTIVO_TO_FESTIVO: { "02-08": 572.01, "20-02": 509.96 },
      LABORABLE_TO_FESTIVO: { "20-02": 282.35 }
    },
    II: {
      LABORABLE: { "02-08": 297.97, "08-14": 151.92, "14-20": 151.92, "20-02": 227.93 },
      SABADO: { "02-08": 297.97, "08-14": 168.39, "14-20": 273.51, "20-02": 402.20 },
      FESTIVO: { "02-08": 536.26, "08-14": 273.51, "14-20": 387.29, "20-02": 521.37 },
      FESTIVO_TO_LABORABLE: { "02-08": 348.54, "20-02": 461.81 },
      FESTIVO_TO_FESTIVO: { "02-08": 584.93, "20-02": 521.37 },
      LABORABLE_TO_FESTIVO: { "20-02": 288.69 }
    },
    III: {
      LABORABLE: { "02-08": 297.53, "08-14": 151.74, "14-20": 151.74, "20-02": 227.62 },
      SABADO: { "02-08": 297.53, "08-14": 167.80, "14-20": 273.08, "20-02": 401.64 },
      FESTIVO: { "02-08": 535.51, "08-14": 273.08, "14-20": 386.78, "20-02": 520.67 },
      FESTIVO_TO_LABORABLE: { "02-08": 355.88, "20-02": 461.19 },
      FESTIVO_TO_FESTIVO: { "02-08": 584.07, "20-02": 520.67 },
      LABORABLE_TO_FESTIVO: { "20-02": 288.32 }
    },
    IV: {
      LABORABLE: { "02-08": 309.70, "08-14": 157.90, "14-20": 157.90, "20-02": 236.91 },
      SABADO: { "02-08": 309.70, "08-14": 173.96, "14-20": 284.30, "20-02": 418.06 },
      FESTIVO: { "02-08": 557.42, "08-14": 284.30, "14-20": 402.56, "20-02": 541.99 },
      FESTIVO_TO_LABORABLE: { "02-08": 382.71, "20-02": 480.01 },
      FESTIVO_TO_FESTIVO: { "02-08": 607.79, "20-02": 541.99 },
      LABORABLE_TO_FESTIVO: { "20-02": 300.04 }
    }
  }
};

const CONDUCTOR_1A_COMPLEMENT = 7.38;
const CONDUCTOR_2A_COMPLEMENT = 6.94;
const TRINCADOR_COMPLEMENT = 48.21;

const MONTHS_ES = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseLocalDate(dateString) {
  const [year, month, day] = String(dateString || "").split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toYmd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isHoliday(dateString, holidaySet = VALENCIA_HOLIDAYS_2026) {
  const date = parseLocalDate(dateString);
  return date.getDay() === 0 || holidaySet.has(dateString);
}

function isConfiguredHoliday(dateString, holidaySet = VALENCIA_HOLIDAYS_2026) {
  const date = parseLocalDate(dateString);
  return date.getDay() !== 0 && holidaySet.has(dateString);
}

function getDayType(dateString, holidaySet) {
  if (isHoliday(dateString, holidaySet)) return "FESTIVO";
  return parseLocalDate(dateString).getDay() === 6 ? "SABADO" : "LABORABLE";
}

function getAdjacentDay(dateString, delta) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + delta);
  return toYmd(date);
}

function parseShift(jornada = "") {
  const text = String(jornada).toUpperCase();
  if (/\b0?2\D+0?8\b/.test(text)) return "02-08";
  if (/\b0?8\D+14\b/.test(text)) return "08-14";
  if (/\b14\D+20\b/.test(text)) return "14-20";
  if (/\b20\D+0?2\b/.test(text)) return "20-02";
  return "";
}

const SHIFT_ORDER = {
  "02-08": 0,
  "08-14": 1,
  "14-20": 2,
  "20-02": 3
};

export function compareJornalesDescending(a, b) {
  const dateComparison = String(b.payroll?.date || "").localeCompare(String(a.payroll?.date || ""));
  if (dateComparison !== 0) return dateComparison;

  const aShift = a.payroll?.shift || parseShift(a.jornada);
  const bShift = b.payroll?.shift || parseShift(b.jornada);
  return (SHIFT_ORDER[bShift] ?? -1) - (SHIFT_ORDER[aShift] ?? -1);
}

function parseMonthLabel(monthLabel = "") {
  const match = String(monthLabel).toLowerCase().match(/([a-záéíóúñ]+)\s+de\s+(\d{4})/i);
  if (!match) return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
  const normalized = match[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return { month: MONTHS_ES[normalized] || new Date().getMonth() + 1, year: Number(match[2]) };
}

function parseAmount(value = "") {
  const matches = String(value).match(/\d+(?:[.,]\d{1,2})/g);
  if (!matches?.length) return 0;
  return Number(matches[matches.length - 1].replace(",", ".")) || 0;
}

function normalizeSpecialty(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.\-_/\\,;:()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOperationType(operation = "") {
  const normalized = normalizeSpecialty(operation);
  return /RECEPCION\s*(?:Y|\/)?\s*ENTREGA/.test(normalized)
    ? "RECEPCION_ENTREGA"
    : "ESTIBA";
}

function getGroup(specialty = "") {
  const normalized = normalizeSpecialty(specialty);
  if (/CONDUCTOR(?:\s+DE)?\s*[12]\s*A\b/.test(normalized)) return "II";
  return "II";
}

function getSpecialtyKey(specialty = "") {
  const normalized = normalizeSpecialty(specialty);
  if (/CONDUCTOR(?:\s+DE)?\s*1\s*A\b/.test(normalized)) return "CONDUCTOR_1A";
  if (/CONDUCTOR(?:\s+DE)?\s*2\s*A\b/.test(normalized)) return "CONDUCTOR_2A";
  if (/TRINCADOR|CAPATAZ\s+DE\s+O\s*P/.test(normalized)) return "TRINCADOR";
  return normalized.replace(/\s+/g, "_");
}

function getComplement(specialty = "", complementLookup = new Map()) {
  const specialtyKey = getSpecialtyKey(specialty);
  const configured = complementLookup.get(specialtyKey);
  if (Number.isFinite(configured)) return configured;
  if (specialtyKey === "CONDUCTOR_1A") return CONDUCTOR_1A_COMPLEMENT;
  if (specialtyKey === "CONDUCTOR_2A") return CONDUCTOR_2A_COMPLEMENT;
  if (specialtyKey === "TRINCADOR") return TRINCADOR_COMPLEMENT;
  return 0;
}

function getRateKey(dateString, shift, holidaySet) {
  const dayType = getDayType(dateString, holidaySet);
  const todayIsConfiguredHoliday = isConfiguredHoliday(dateString, holidaySet);
  if (shift === "02-08" && isConfiguredHoliday(getAdjacentDay(dateString, -1), holidaySet)) {
    return todayIsConfiguredHoliday ? "FESTIVO_TO_FESTIVO" : "FESTIVO_TO_LABORABLE";
  }
  if (shift === "20-02") {
    const nextDayIsHoliday = isConfiguredHoliday(getAdjacentDay(dateString, 1), holidaySet);
    if (todayIsConfiguredHoliday) {
      return nextDayIsHoliday ? "FESTIVO_TO_FESTIVO" : "FESTIVO_TO_LABORABLE";
    }
    if (nextDayIsHoliday) return "LABORABLE_TO_FESTIVO";
  }
  if (dayType === "SABADO" && shift === "02-08") return "LABORABLE";
  return dayType;
}

function findMatchingPrima(jornal, primas = []) {
  const parte = String(jornal.parte || "").trim();
  if (!parte) return null;

  const row = primas.find((item) => String(item.parte || item.values?.[1] || "").trim() === parte);
  if (!row) return null;

  const amount = parseAmount(row.produccion || row.values?.[9] || "");
  return amount > 0 ? amount : null;
}

export function enrichJornales(jornales = [], primas = [], monthLabel = "", payrollConfig = null) {
  const { month, year } = parseMonthLabel(monthLabel);
  const configuredHolidays = payrollConfig?.holidays
    ?.filter((item) => item.enabled !== false)
    .map((item) => item.holiday_date || item.holidayDate)
    .filter(Boolean);
  const holidaySet = payrollConfig?.holidays
    ? new Set(configuredHolidays)
    : VALENCIA_HOLIDAYS_2026;
  const rateLookup = new Map((payrollConfig?.rates || []).map((item) => [
    [item.operation_type, item.worker_group, item.rate_key, item.shift_key].join("|"),
    item.amount == null ? null : Number(item.amount)
  ]));
  const complementLookup = new Map((payrollConfig?.complements || []).map((item) => [
    item.specialty_key,
    item.amount == null ? null : Number(item.amount)
  ]));
  return jornales.map((jornal) => {
    const day = Number(jornal.dia);
    const date = `${year}-${pad(month)}-${pad(day || 1)}`;
    const shift = parseShift(jornal.jornada);
    const group = getGroup(jornal.especialidad);
    const operationType = getOperationType(jornal.operacion);
    const rateKey = getRateKey(date, shift, holidaySet);
    const operationTable = SALARY_TABLE[operationType] || SALARY_TABLE.ESTIBA;
    const table = operationTable[group] || operationTable.II;
    const configuredRate = rateLookup.get([operationType, group, rateKey, shift].join("|"));
    const fallbackRate = table[rateKey]?.[shift] ?? table[getDayType(date, holidaySet)]?.[shift] ?? 0;
    const base = Number((Number.isFinite(configuredRate) ? configuredRate : fallbackRate).toFixed(2));
    const complement = Number(getComplement(jornal.especialidad, complementLookup).toFixed(2));
    const production = operationType === "RECEPCION_ENTREGA"
      ? 0
      : Number(parseAmount(jornal.produccion).toFixed(2));
    const primaAmount = operationType === "RECEPCION_ENTREGA"
      ? null
      : findMatchingPrima(jornal, primas);
    const prima = primaAmount == null ? null : Number(primaAmount.toFixed(2));
    const total = Number((base + complement + production + (prima || 0)).toFixed(2));

    return {
      ...jornal,
      payroll: {
        date,
        shift,
        group,
        operationType,
        rateKey,
        base,
        complement,
        production,
        prima,
        primaPending: operationType !== "RECEPCION_ENTREGA" && prima == null,
        total
      }
    };
  });
}

export function summarizePayroll(items = []) {
  return items.reduce((acc, item) => {
    const day = Number(item.dia);
    const total = Number(item.payroll?.total || 0);
    acc.total += total;
    if (day <= 15) acc.firstHalf += total;
    else acc.secondHalf += total;
    return acc;
  }, { total: 0, firstHalf: 0, secondHalf: 0 });
}

export function formatEuro(value = 0) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}
