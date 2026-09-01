import REMATE_SALARY_DATA from "../assets/remates-salariales.json" with { type: "json" };
import { canonicalPortalPart, normalizeReservePortalRow } from "./portalRowIdentity.js";

const VALENCIA_HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-06", "2026-01-22", "2026-03-19", "2026-04-03",
  "2026-04-06", "2026-04-13", "2026-05-01", "2026-06-24", "2026-07-16",
  "2026-08-15", "2026-10-09", "2026-10-12", "2026-11-01", "2026-12-06",
  "2026-12-08", "2026-12-25"
]);

export const SALARY_TABLE = {
  ESTIBA: {
    I: {
      LABORABLE: { "02-08": 216.19, "08-14": 102.19, "14-20": 102.19, "18-00": 144.83, "19-01": 144.83, "20-02": 153.32 },
      SABADO: { "02-08": 216.19, "08-14": 118.66, "14-20": 183.96, "18-00": 255.47, "19-01": 255.47, "20-02": 270.55 },
      FESTIVO: { "02-08": 389.23, "08-14": 183.96, "14-20": 260.50, "20-02": 350.68 },
      FESTIVO_TO_LABORABLE: { "02-08": 247.72, "18-00": 329.01, "19-01": 329.01, "20-02": 310.65 },
      FESTIVO_TO_FESTIVO: { "02-08": 424.44, "18-00": 349.05, "19-01": 349.05, "20-02": 350.68 },
      LABORABLE_TO_FESTIVO: { "18-00": 165.20, "19-01": 165.20, "20-02": 194.16 }
    },
    II: {
      LABORABLE: { "02-08": 223.27, "08-14": 105.53, "14-20": 105.53, "18-00": 149.54, "19-01": 149.54, "20-02": 158.36 },
      SABADO: { "02-08": 223.27, "08-14": 122.02, "14-20": 189.98, "18-00": 263.85, "19-01": 263.85, "20-02": 279.42 },
      FESTIVO: { "02-08": 401.99, "08-14": 189.98, "14-20": 269.05, "20-02": 362.16 },
      FESTIVO_TO_LABORABLE: { "02-08": 261.16, "18-00": 339.70, "19-01": 339.70, "20-02": 320.77 },
      FESTIVO_TO_FESTIVO: { "02-08": 438.26, "18-00": 360.46, "19-01": 360.46, "20-02": 362.16 },
      LABORABLE_TO_FESTIVO: { "18-00": 170.61, "19-01": 170.61, "20-02": 200.51 }
    },
    III: {
      LABORABLE: { "02-08": 225.82, "08-14": 106.56, "14-20": 106.56, "18-00": 155.04, "19-01": 155.04, "20-02": 159.91 },
      SABADO: { "02-08": 225.82, "08-14": 131.81, "14-20": 191.77, "18-00": 273.58, "19-01": 273.58, "20-02": 282.10 },
      FESTIVO: { "02-08": 405.86, "08-14": 191.66, "14-20": 271.51, "20-02": 365.52 },
      FESTIVO_TO_LABORABLE: { "02-08": 269.62, "18-00": 352.28, "19-01": 352.28, "20-02": 323.86 },
      FESTIVO_TO_FESTIVO: { "18-00": 373.73, "19-01": 373.73, "20-02": 365.62 },
      LABORABLE_TO_FESTIVO: { "18-00": 176.90, "19-01": 176.90, "20-02": 159.91 }
    },
    IV: {
      LABORABLE: { "02-08": 238.98, "08-14": 122.17, "14-20": 122.17, "18-00": 164.07, "19-01": 164.07, "20-02": 169.25 },
      SABADO: { "02-08": 238.98, "08-14": 138.49, "14-20": 203.00, "18-00": 289.51, "19-01": 289.51, "20-02": 298.55 },
      FESTIVO: { "02-08": 429.56, "08-14": 202.88, "14-20": 287.36, "20-02": 386.88 },
      FESTIVO_TO_LABORABLE: { "02-08": 294.81, "18-00": 372.83, "19-01": 372.83, "20-02": 342.76 },
      FESTIVO_TO_FESTIVO: { "18-00": 395.56, "19-01": 395.56, "20-02": 386.98 },
      LABORABLE_TO_FESTIVO: { "18-00": 187.24, "19-01": 187.24, "20-02": 169.25 }
    }
  },
  RECEPCION_ENTREGA: {
    I: {
      LABORABLE: { "02-08": 291.41, "08-14": 148.63, "14-20": 148.63, "19-01": 210.52, "20-02": 222.91 },
      SABADO: { "02-08": 291.41, "08-14": 165.13, "14-20": 267.50, "20-02": 393.35 },
      FESTIVO: { "02-08": 524.52, "08-14": 267.50, "14-20": 378.82, "20-02": 509.96 },
      FESTIVO_TO_LABORABLE: { "02-08": 333.73, "20-02": 451.76 },
      FESTIVO_TO_FESTIVO: { "02-08": 572.01, "20-02": 509.96 },
      LABORABLE_TO_FESTIVO: { "20-02": 282.35 }
    },
    II: {
      LABORABLE: { "02-08": 297.97, "08-14": 151.92, "14-20": 151.92, "19-01": 215.28, "20-02": 227.93 },
      SABADO: { "02-08": 297.97, "08-14": 168.39, "14-20": 273.51, "20-02": 402.20 },
      FESTIVO: { "02-08": 536.26, "08-14": 273.51, "14-20": 387.29, "20-02": 521.37 },
      FESTIVO_TO_LABORABLE: { "02-08": 348.54, "20-02": 461.81 },
      FESTIVO_TO_FESTIVO: { "02-08": 584.93, "20-02": 521.37 },
      LABORABLE_TO_FESTIVO: { "20-02": 288.69 }
    },
    III: {
      LABORABLE: { "02-08": 297.53, "08-14": 151.74, "14-20": 151.74, "19-01": 220.74, "20-02": 227.62 },
      SABADO: { "02-08": 297.53, "08-14": 167.80, "14-20": 273.08, "20-02": 401.64 },
      FESTIVO: { "02-08": 535.51, "08-14": 273.08, "14-20": 386.78, "20-02": 520.67 },
      FESTIVO_TO_LABORABLE: { "02-08": 355.88, "20-02": 461.19 },
      FESTIVO_TO_FESTIVO: { "02-08": 584.07, "20-02": 520.67 },
      LABORABLE_TO_FESTIVO: { "20-02": 288.32 }
    },
    IV: {
      LABORABLE: { "02-08": 309.70, "08-14": 157.90, "14-20": 157.90, "19-01": 229.79, "20-02": 236.91 },
      SABADO: { "02-08": 309.70, "08-14": 173.96, "14-20": 284.30, "20-02": 418.06 },
      FESTIVO: { "02-08": 557.42, "08-14": 284.30, "14-20": 402.56, "20-02": 541.99 },
      FESTIVO_TO_LABORABLE: { "02-08": 382.71, "20-02": 480.01 },
      FESTIVO_TO_FESTIVO: { "02-08": 607.79, "20-02": 541.99 },
      LABORABLE_TO_FESTIVO: { "20-02": 300.04 }
    }
  }
};

const SPECIALTY_COMPLEMENT_FALLBACKS = {
  CAPATAZ: 86.48,
  SOBORDISTA: 74.89,
  TRINCADOR: 48.21,
  CLASIFICADOR: 74.89,
  MAFI: 74.89,
  MANIPULADOR_OP_UNICA: 56.96,
  APOYO_OPERACION: 113.92,
  CONDUCTOR_1A: 7.38,
  GARAJISTA_RO_RO: 181.41,
  FURGONETERO_RO_RO: 47.47,
  CONDUCTOR_2A: 6.94
};

const MANIPULATOR_SPECIALTIES = new Set([
  "TRASTAINERS_RTT",
  "CONTAINER",
  "GRUAS",
  "ELEVADORAS"
]);

const MANIPULATOR_COMPLEMENTS = {
  ESTIBA: {
    "02-08": 84.29,
    "08-14": 60.57,
    "14-20": 60.57,
    "20-02": 83.71
  },
  RECEPCION_ENTREGA: {
    "02-08": 13.26,
    "08-14": 12.15,
    "14-20": 12.15,
    "20-02": 16.90
  },
  FESTIVO: {
    "02-08": 70.26,
    "08-14": 70.26,
    "14-20": 70.26,
    "20-02": 70.26
  }
};

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
  if (/\b0?6\D+12\b/.test(text)) return "06-12";
  if (/\b0?8\D+14\b/.test(text)) return "08-14";
  if (/\b14\D+20\b/.test(text)) return "14-20";
  if (/\b18\D+0?0\b/.test(text)) return "18-00";
  if (/\b19\D+0?1\b/.test(text)) return "19-01";
  if (/\b20\D+0?2\b/.test(text)) return "20-02";
  return "";
}

const SHIFT_ORDER = {
  "02-08": 0,
  "06-12": 1,
  "08-14": 2,
  "14-20": 3,
  "18-00": 4,
  "19-01": 5,
  "20-02": 6
};

export const VACATION_DAY_RATE = 214.11;

export const RELAY_HOUR_RATES = Object.freeze({
  LABORABLE: 66.05,
  FESTIVO: 96.08
});

export const CONTINUOUS_DOUBLE_MEAL_RATE = 22.31;

function continuousDoubleMeals(jornales = []) {
  const rowsByDay = new Map();
  jornales.forEach((jornal, index) => {
    const day = Number(jornal?.dia);
    const shift = parseShift(jornal?.jornada);
    if (!Number.isFinite(day) || !shift) return;
    if (!rowsByDay.has(day)) rowsByDay.set(day, new Map());
    const shifts = rowsByDay.get(day);
    if (!shifts.has(shift)) shifts.set(shift, []);
    shifts.get(shift).push(index);
  });

  const meals = new Map();
  rowsByDay.forEach((shifts) => {
    if (shifts.has("08-14") && shifts.has("14-20")) {
      meals.set(shifts.get("14-20")[0], { type: "COMIDA", hours: "14-15" });
    }
    if (shifts.has("14-20") && shifts.has("20-02")) {
      meals.set(shifts.get("20-02")[0], { type: "CENA", hours: "20-21" });
    }
  });
  return meals;
}

function relayHourKeyPart(value, fallback) {
  return String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
}

export function getRelayHourKey(jornal, date, shift) {
  return [
    date,
    relayHourKeyPart(jornal?.parte, "SIN-PARTE"),
    relayHourKeyPart(jornal?.jornal, "SIN-NUMERO"),
    shift,
    relayHourKeyPart(jornal?.especialidad, "SIN-ESPECIALIDAD")
  ].join("|");
}

export function getRelayHourRate(dateString, shift, holidaySet = VALENCIA_HOLIDAYS_2026) {
  if (shift !== "08-14" && shift !== "14-20") return null;
  const day = parseLocalDate(dateString).getDay();
  const festive = isHoliday(dateString, holidaySet) || (day === 6 && shift === "14-20");
  return {
    rateKey: festive ? "FESTIVO" : "LABORABLE",
    amount: festive ? RELAY_HOUR_RATES.FESTIVO : RELAY_HOUR_RATES.LABORABLE
  };
}

export function compareJornalesDescending(a, b) {
  const dateComparison = String(b.payroll?.date || "").localeCompare(String(a.payroll?.date || ""));
  if (dateComparison !== 0) return dateComparison;

  const aShift = a.payroll?.shift || parseShift(a.jornada);
  const bShift = b.payroll?.shift || parseShift(b.jornada);
  return (SHIFT_ORDER[bShift] ?? -1) - (SHIFT_ORDER[aShift] ?? -1);
}

function parseMonthLabel(monthLabel = "") {
  const numericMatch = String(monthLabel).match(/(\d{1,2})\s*\/\s*(\d{4})/);
  if (numericMatch) return { month: Number(numericMatch[1]), year: Number(numericMatch[2]) };
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

function getGroup(specialty = "", explicitGroup = "") {
  if (/^(?:I|II|III|IV)$/.test(String(explicitGroup || "").trim().toUpperCase())) {
    return String(explicitGroup).trim().toUpperCase();
  }
  const normalized = normalizeSpecialty(specialty);
  if (/CONDUCTOR(?:\s+DE)?\s*[12]\s*A\b/.test(normalized)) return "II";
  return "II";
}

export function getRemateGroup(specialty = "") {
  const normalized = normalizeSpecialty(specialty);
  if (/SOBORDISTA|CAPATAZ/.test(normalized)) return "IV";
  if (/CLASIF(?:ICADOR)?/.test(normalized)) return "III";
  if (/ESPECIALISTA|TRINCADOR/.test(normalized)) return "I";
  return "II";
}

function getSpecialtyKey(specialty = "") {
  const normalized = normalizeSpecialty(specialty);
  if (/CONDUCTOR(?:\s+DE)?\s*1\s*A\b/.test(normalized)) return "CONDUCTOR_1A";
  if (/CONDUCTOR(?:\s+DE)?\s*2\s*A\b/.test(normalized)) return "CONDUCTOR_2A";
  if (normalized === "CAPATAZ") return "CAPATAZ";
  if (/TRINCADOR|CAPATAZ\s+DE\s+O\s*P/.test(normalized)) return "TRINCADOR";
  if (/SOBORDISTA/.test(normalized)) return "SOBORDISTA";
  if (/CLASIF(?:ICADOR)?/.test(normalized)) return "CLASIFICADOR";
  if (/\bMAFIS?\b/.test(normalized)) return "MAFI";
  if (/MANIPULADOR\s+(?:DE\s+)?OP(?:ERACION)?\s+UNICA/.test(normalized)) return "MANIPULADOR_OP_UNICA";
  if (/APOYO\s+OPERACION/.test(normalized)) return "APOYO_OPERACION";
  if (/GARAJISTA(?:\s+RO\s*RO)?/.test(normalized)) return "GARAJISTA_RO_RO";
  if (/FURGONETERO(?:\s+RO\s*RO)?/.test(normalized)) return "FURGONETERO_RO_RO";
  if (/TRASTAINER/.test(normalized) || /\bRTT\b/.test(normalized)) return "TRASTAINERS_RTT";
  if (/CONTAINERA?S?|CONTAINERS?/.test(normalized)) return "CONTAINER";
  if (/\bGRUAS?\b|GRUISTA/.test(normalized)) return "GRUAS";
  if (/ELEVADORAS?/.test(normalized)) return "ELEVADORAS";
  return normalized.replace(/\s+/g, "_");
}

function getMonthKey(monthLabel = "") {
  const { month, year } = parseMonthLabel(monthLabel);
  return `${year}-${pad(month)}`;
}

export function buildVacationPayrollEntries(descansos = null, amount = VACATION_DAY_RATE) {
  const seenDates = new Set();
  const entries = [];

  for (const monthData of descansos?.months || []) {
    const numericTitle = String(monthData?.title || "").match(/(\d{1,2})\s*\/\s*(\d{4})/);
    const month = Number(monthData?.month || numericTitle?.[1]);
    const year = Number(monthData?.year || numericTitle?.[2]);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) continue;

    for (const dayData of monthData?.days || []) {
      if (String(dayData?.code || "").trim().toUpperCase() !== "VA") continue;
      const day = Number(dayData?.day);
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      const date = `${year}-${pad(month)}-${pad(day)}`;
      if (seenDates.has(date)) continue;
      seenDates.add(date);

      entries.push({
        jornal: `VA-${date}`,
        parte: "",
        dia: pad(day),
        tipo: "VA",
        jornada: "VACACIONES",
        especialidad: "VACACIONES",
        empresa: "",
        buque: "",
        operacion: "Día de vacaciones",
        isVacation: true,
        payroll: {
          conceptType: "VACATION",
          date,
          shift: "VA",
          group: "",
          operationType: "VACACIONES",
          rateKey: "VACACIONES",
          base: Number(amount),
          complement: 0,
          prima: null,
          primaPending: false,
          relayHourEligible: false,
          relayHour: 0,
          total: Number(amount)
        }
      });
    }
  }

  return entries;
}

export function vacationPayrollEntriesForMonth(entries = [], monthLabel = "") {
  const monthKey = getMonthKey(monthLabel);
  return entries.filter((item) => String(item?.payroll?.date || "").startsWith(`${monthKey}-`));
}

function getComplement(
  specialty = "",
  { operationType = "ESTIBA", rateKey = "LABORABLE", shift = "" } = {},
  complementLookup = new Map()
) {
  const specialtyKey = getSpecialtyKey(specialty);
  if (MANIPULATOR_SPECIALTIES.has(specialtyKey)) {
    const configuredRow = complementLookup.get(specialtyKey);
    const shiftSuffix = shift.replace("-", "_");
    const configuredKey = rateKey.includes("FESTIVO")
      ? "festivo"
      : `${operationType === "RECEPCION_ENTREGA" ? "recepcion_entrega" : "servicio_publico"}_${shiftSuffix}`;
    const configured = configuredRow?.[configuredKey] == null
      ? null
      : Number(configuredRow[configuredKey]);
    if (Number.isFinite(configured)) return configured;

    const fallbackTable = rateKey.includes("FESTIVO")
      ? MANIPULATOR_COMPLEMENTS.FESTIVO
      : MANIPULATOR_COMPLEMENTS[operationType] || MANIPULATOR_COMPLEMENTS.ESTIBA;
    return fallbackTable[shift] || 0;
  }

  const configuredValue = complementLookup.get(specialtyKey)?.amount;
  const configured = configuredValue == null ? null : Number(configuredValue);
  if (Number.isFinite(configured)) return configured;
  return SPECIALTY_COMPLEMENT_FALLBACKS[specialtyKey] || 0;
}

function getRateKey(dateString, shift, holidaySet) {
  const dayType = getDayType(dateString, holidaySet);
  if (shift === "02-08" && isHoliday(getAdjacentDay(dateString, -1), holidaySet)) {
    return isHoliday(dateString, holidaySet) ? "FESTIVO_TO_FESTIVO" : "FESTIVO_TO_LABORABLE";
  }
  if (shift === "18-00" || shift === "19-01" || shift === "20-02") {
    const nextDay = getAdjacentDay(dateString, 1);
    const nextDayIsConfiguredHoliday = isConfiguredHoliday(nextDay, holidaySet);
    const todayIsHoliday = isHoliday(dateString, holidaySet);
    if (todayIsHoliday) {
      return isHoliday(nextDay, holidaySet) ? "FESTIVO_TO_FESTIVO" : "FESTIVO_TO_LABORABLE";
    }
    if (nextDayIsConfiguredHoliday) return "LABORABLE_TO_FESTIVO";
  }
  if (dayType === "SABADO" && shift === "02-08") return "LABORABLE";
  return dayType;
}

function getRemateRateKey(dateString, shift, holidaySet) {
  if (shift === "06-12") return isHoliday(dateString, holidaySet) ? "FESTIVO" : "LABORABLE";
  if (shift !== "18-00" && shift !== "19-01") return getRateKey(dateString, shift, holidaySet);

  const dayType = getDayType(dateString, holidaySet);
  if (dayType === "SABADO") return "SABADO";
  const nextDay = getAdjacentDay(dateString, 1);
  if (isHoliday(dateString, holidaySet)) {
    return isHoliday(nextDay, holidaySet) ? "FESTIVO_TO_FESTIVO" : "FESTIVO_TO_LABORABLE";
  }
  if (isConfiguredHoliday(nextDay, holidaySet)) return "LABORABLE_TO_FESTIVO";
  return "LABORABLE";
}

const REMATE_RATE_LOOKUP = new Map((REMATE_SALARY_DATA.rows || []).flatMap((row) => (
  Object.entries(row.rates || {}).map(([group, amount]) => [
    [row.shift, row.dayType, group].join("|"),
    Number(amount)
  ])
)));

export function getRemateRate(dateString, shift, specialty, holidaySet = VALENCIA_HOLIDAYS_2026) {
  const group = getRemateGroup(specialty);
  const rateKey = getRemateRateKey(dateString, shift, holidaySet);
  const amount = REMATE_RATE_LOOKUP.get([shift, rateKey, group].join("|"));
  if (!Number.isFinite(amount)) return null;
  return { group, rateKey, amount };
}

function findMatchingPrima(jornal, primas = []) {
  const parte = String(jornal.parte || "").trim();
  if (!parte) return null;

  const row = primas.find((item) => String(item.parte || item.values?.[1] || "").trim() === parte);
  if (!row) return null;

  const amount = parseAmount(row.produccion || row.values?.[9] || "");
  if (amount <= 0) return null;
  return {
    amount,
    verification: row.produccionEstado === "pending"
      ? "pending"
      : row.produccionEstado === "verified" ? "verified"
        : row.produccionEstado === "paid" ? "paid" : "unknown"
  };
}

export function enrichJornales(jornales = [], primas = [], monthLabel = "", payrollConfig = null, relayHours = {}, remateHours = {}, manualPremiums = {}) {
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
    item
  ]));
  const mealByIndex = continuousDoubleMeals(jornales);
  return jornales.map((jornal, index) => {
    const day = Number(jornal.dia);
    const date = `${year}-${pad(month)}-${pad(day || 1)}`;
    const shift = parseShift(jornal.jornada);
    const group = getGroup(jornal.especialidad, jornal.payrollGroup);
    const operationType = getOperationType(jornal.operacion);
    const rateKey = getRateKey(date, shift, holidaySet);
    const operationTable = SALARY_TABLE[operationType] || SALARY_TABLE.ESTIBA;
    const table = operationTable[group] || operationTable.II;
    const configuredRate = rateLookup.get([operationType, group, rateKey, shift].join("|"));
    const fallbackRate = table[rateKey]?.[shift] ?? table[getDayType(date, holidaySet)]?.[shift] ?? 0;
    const base = Number((Number.isFinite(configuredRate) ? configuredRate : fallbackRate).toFixed(2));
    const specialtyKey = getSpecialtyKey(jornal.especialidad);
    const isManipulator = MANIPULATOR_SPECIALTIES.has(specialtyKey);
    const complement = Number(getComplement(
      jornal.especialidad,
      { operationType, rateKey, shift },
      complementLookup
    ).toFixed(2));
    const allowsPrima = operationType !== "RECEPCION_ENTREGA" || isManipulator;
    const manualPremiumEligible = allowsPrima && Boolean(String(jornal.parte || jornal.jornal || "").trim());
    const embeddedPrima = !allowsPrima
      ? null
      : parseAmount(jornal.produccion) || null;
    const matchedPrima = !allowsPrima
      ? null
      : findMatchingPrima(jornal, primas);
    const officialPrimaAmount = matchedPrima?.amount ?? embeddedPrima;
    const portalPrima = officialPrimaAmount == null ? null : Number(officialPrimaAmount.toFixed(2));
    const relayHourRate = getRelayHourRate(date, shift, holidaySet);
    const relayHourKey = getRelayHourKey(jornal, date, shift);
    const relayHourEnabled = Boolean(relayHourRate && relayHours?.[relayHourKey]);
    const relayHour = relayHourEnabled ? relayHourRate.amount : 0;
    const remateRate = getRemateRate(date, shift, jornal.especialidad, holidaySet);
    const remateKey = getRelayHourKey(jornal, date, shift);
    const manualPremiumKey = remateKey;
    const savedManualPremium = manualPremiums?.[manualPremiumKey];
    const parsedManualPremium = Number(savedManualPremium?.amount);
    const hasManualPremium = manualPremiumEligible && savedManualPremium != null && Number.isFinite(parsedManualPremium);
    const manualPrima = hasManualPremium ? Number(parsedManualPremium.toFixed(2)) : null;
    const portalAmountAtEdit = savedManualPremium?.portalAmountAtEdit == null
      ? null
      : Number(Number(savedManualPremium.portalAmountAtEdit).toFixed(2));
    const prima = hasManualPremium ? manualPrima : portalPrima;
    const manualPremiumConflict = hasManualPremium
      && portalPrima != null
      && portalPrima !== manualPrima
      && portalAmountAtEdit !== portalPrima;
    const savedRemateHours = Number(remateHours?.[remateKey] || 0);
    const selectedRemateHours = remateRate && (savedRemateHours === 1 || savedRemateHours === 2)
      ? savedRemateHours
      : 0;
    const remate = Number(((remateRate?.amount || 0) * selectedRemateHours).toFixed(2));
    const continuousDoubleMeal = mealByIndex.has(index) ? CONTINUOUS_DOUBLE_MEAL_RATE : 0;
    const meal = mealByIndex.get(index) || null;
    const total = Number((base + complement + (prima || 0) + relayHour + continuousDoubleMeal + remate).toFixed(2));

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
        production: 0,
        prima,
        portalPrima,
        manualPrima,
        primaSource: hasManualPremium ? "manual" : portalPrima == null ? "pending" : "portal",
        primaEligible: allowsPrima,
        manualPremiumEligible,
        primaPending: allowsPrima && prima == null,
        manualPremiumKey,
        manualPremiumConflict,
        manualPremiumAcknowledged: hasManualPremium && portalPrima != null && portalAmountAtEdit === portalPrima,
        primaVerification: hasManualPremium ? "manual" : matchedPrima?.verification
          || (jornal.produccionEstado === "pending" ? "pending"
            : jornal.produccionEstado === "verified" ? "verified"
              : jornal.produccionEstado === "paid" ? "paid" : "unknown"),
        relayHourEligible: Boolean(relayHourRate),
        relayHourKey,
        relayHourRateKey: relayHourRate?.rateKey || null,
        relayHourRate: relayHourRate?.amount || 0,
        relayHourEnabled,
        relayHour,
        remateEligible: Boolean(remateRate),
        remateKey,
        remateGroup: remateRate?.group || null,
        remateRateKey: remateRate?.rateKey || null,
        remateHourlyRate: remateRate?.amount || 0,
        remateHours: selectedRemateHours,
        remate,
        continuousDoubleMeal,
        continuousDoubleMealType: meal?.type || null,
        continuousDoubleMealHours: meal?.hours || null,
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
    if (item.isVacation) acc.vacationDays += 1;
    else acc.workCount += 1;
    if (day <= 15) acc.firstHalf += total;
    else acc.secondHalf += total;
    return acc;
  }, { total: 0, firstHalf: 0, secondHalf: 0, workCount: 0, vacationDays: 0 });
}

export function filterJornalesByPeriod(items = [], period = "month") {
  if (period === "month") return items;
  return items.filter((item) => {
    const day = Number.parseInt(item?.dia, 10);
    if (!Number.isFinite(day)) return period === "first";
    return period === "first" ? day <= 15 : day > 15;
  });
}

export function selectPortalJornales(jornales = null, primas = null) {
  const portalRows = Array.isArray(jornales?.rows) ? jornales.rows : [];
  if (portalRows.length > 0 || jornales?.recognized) return portalRows;
  return Array.isArray(primas?.rows) ? primas.rows : [];
}

function portalJornalKey(row, day = row?.dia) {
  const part = canonicalPortalPart(row);
  const shift = parseShift(row?.jornada);
  if (part) return `${Number(day)}|${part}|${shift}`;
  return [
    Number(day),
    shift,
    String(row?.empresa || "").trim().toUpperCase(),
    String(row?.buque || "").trim().toUpperCase(),
    String(row?.especialidad || "").trim().toUpperCase()
  ].join("|");
}

export function mergeUpcomingAssignmentsIntoJornales(
  jornales = [],
  assignments = [],
  monthLabel = "",
  today = new Date()
) {
  const rows = Array.isArray(jornales) ? jornales : [];
  const upcoming = Array.isArray(assignments) ? assignments : [];
  const { month, year } = parseMonthLabel(monthLabel);
  if (!month || !year || !Number.isFinite(today?.getTime?.())) return rows;

  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const existingKeys = new Set();
  const merged = [];
  rows.forEach((row) => {
    const key = portalJornalKey(row);
    const duplicateIndex = merged.findIndex((item) => portalJornalKey(item) === key);
    if (duplicateIndex === -1) {
      existingKeys.add(key);
      merged.push(normalizeReservePortalRow(row));
    } else if (merged[duplicateIndex]?.upcomingAssignment && !row?.upcomingAssignment) {
      merged[duplicateIndex] = normalizeReservePortalRow(row);
    }
  });

  upcoming.forEach((assignment) => {
    const match = String(assignment?.fecha || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return;
    const day = Number(match[1]);
    const assignmentMonth = Number(match[2]);
    const assignmentYear = Number(match[3]);
    const assignmentDateKey = `${assignmentYear}-${pad(assignmentMonth)}-${pad(day)}`;
    if (assignmentMonth !== month || assignmentYear !== year || assignmentDateKey < todayKey) return;

    const key = portalJornalKey(assignment, day);
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    merged.push({
      ...assignment,
      dia: pad(day),
      jornal: assignment.jornal || "",
      produccion: assignment.produccion || "",
      produccionEstado: assignment.produccionEstado || "unknown",
      upcomingAssignment: true
    });
  });

  return merged;
}

export function selectPortalJornalesHistory(jornales = null, primas = null) {
  const portalHistory = Array.isArray(jornales?.history) ? jornales.history : [];
  if (portalHistory.length > 0) return portalHistory;
  return Array.isArray(primas?.history) ? primas.history : [];
}

function premiumRowsForMonth(premiumHistory, month) {
  if (!Array.isArray(premiumHistory)) return [];
  const matchingPeriod = premiumHistory.find((period) => (
    Number(period?.year) === Number(month?.year)
    && Number(period?.month) === Number(month?.month)
  )) || premiumHistory.find((period) => (
    String(period?.monthLabel || "").trim().toLocaleLowerCase("es")
    === String(month?.monthLabel || "").trim().toLocaleLowerCase("es")
  ));
  return Array.isArray(matchingPeriod?.rows) ? matchingPeriod.rows : [];
}

export function summarizeAnnualPayroll(
  history = [],
  payrollConfig = null,
  relayHours = {},
  vacationEntries = [],
  premiumHistory = [],
  remateHours = {},
  manualPremiums = {}
) {
  const historyKeys = new Set(history.map((month) => `${month.year}-${pad(month.month)}`));
  const vacationOnlyMonths = vacationEntries.reduce((months, item) => {
    const match = String(item?.payroll?.date || "").match(/^(\d{4})-(\d{2})-/);
    if (!match || historyKeys.has(`${match[1]}-${match[2]}`)) return months;
    if (!months.some((month) => Number(month.year) === Number(match[1]) && Number(month.month) === Number(match[2]))) {
      months.push({
        year: Number(match[1]),
        month: Number(match[2]),
        monthLabel: `${Object.keys(MONTHS_ES).find((name) => MONTHS_ES[name] === Number(match[2])) || match[2]} de ${match[1]}`,
        rows: []
      });
    }
    return months;
  }, []);

  const months = [...history, ...vacationOnlyMonths].map((month) => {
    const monthKey = `${month.year}-${pad(month.month)}`;
    const vacationRows = vacationEntries.filter((item) => String(item?.payroll?.date || "").startsWith(`${monthKey}-`));
    const premiumRows = premiumRowsForMonth(premiumHistory, month);
    const enriched = [
      ...enrichJornales(month.rows || [], premiumRows, month.monthLabel || "", payrollConfig, relayHours, remateHours, manualPremiums),
      ...vacationRows
    ];
    const summary = summarizePayroll(enriched);
    const primaTotal = enriched.reduce((sum, item) => sum + Number(item.payroll?.prima || 0), 0);
    return {
      ...month,
      enriched,
      count: summary.workCount,
      vacationDays: summary.vacationDays,
      total: Number(summary.total.toFixed(2)),
      primaTotal: Number(primaTotal.toFixed(2))
    };
  });

  return {
    months,
    count: months.reduce((sum, month) => sum + month.count, 0),
    vacationDays: months.reduce((sum, month) => sum + month.vacationDays, 0),
    total: Number(months.reduce((sum, month) => sum + month.total, 0).toFixed(2)),
    primaTotal: Number(months.reduce((sum, month) => sum + month.primaTotal, 0).toFixed(2)),
    activeMonths: months.filter((month) => month.count > 0 || month.vacationDays > 0).length
  };
}

export function formatEuro(value = 0) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}
