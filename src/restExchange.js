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
      else if (["", "SL"].includes(day.code)) work.push({ date: day.dateKey, code: day.code });
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

export function restPortalProcedure(offer, proposal) {
  const isSwap = offer.kind === "swap";
  const shouldSubmit = isSwap || (offer.kind === "give" ? offer.isOwn : proposal.isOwn);
  const portalDate = (value) => {
    const [year, month, day] = String(value || "").split("-");
    return year && month && day ? `${day}/${month}/${year}` : "—";
  };
  if (isSwap) {
    return {
      url: "https://portal.cpevalencia.com/#User,ViewNoray,15",
      label: "Abrir intercambio de descansos",
      instruction: `En el portal, indica TENGO: ${portalDate(offer.isOwn ? offer.offeredDate : proposal.offeredDate)}; CAMBIO CON: chapa ${proposal.counterpartChapa}; TIENE: ${portalDate(offer.isOwn ? proposal.offeredDate : offer.offeredDate)}.`
    };
  }
  return {
    url: "https://portal.cpevalencia.com/#User,ViewNoray,24",
    label: "Abrir cesión de descansos",
    instruction: shouldSubmit
      ? `Quien cede el descanso debe indicar en el portal TENGO: ${portalDate(offer.kind === "give" ? offer.offeredDate : proposal.offeredDate)}; CEDO A: chapa ${proposal.counterpartChapa}.`
      : "El compañero que cede el descanso debe presentar la petición en el portal oficial. La app no realiza la cesión."
  };
}
