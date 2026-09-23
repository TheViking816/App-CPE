import { buildPersonalRestMonths } from "./restCalendar.js";

export function confirmedRestExchangeDays(descansos, vacaciones, vacationEntries = [], now = new Date()) {
  const payrollVacationDays = new Set(vacationEntries.map((entry) => String(entry?.payroll?.date || "")));
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const months = buildPersonalRestMonths(descansos, vacaciones, now);
  const rest = [];
  const work = [];
  for (const month of months) {
    if (month.source !== "portal") continue;
    for (const day of month.days) {
      if (day.dateKey < current || day.vacation || payrollVacationDays.has(day.dateKey)) continue;
      if (["DS", "FS"].includes(day.code)) rest.push({ date: day.dateKey, code: day.code });
      else if (!day.code && !day.type) work.push({ date: day.dateKey });
    }
  }
  return { rest, work };
}

export function canRespondToRestOffer(offer, restDates, workDates) {
  if (offer.status !== "open" || offer.isOwn) return false;
  if (offer.offeredDate && !workDates.has(offer.offeredDate)) return false;
  if (offer.wantedDate && !restDates.has(offer.wantedDate)) return false;
  return true;
}
