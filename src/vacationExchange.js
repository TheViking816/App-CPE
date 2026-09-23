function portalDateKey(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function dateRangeKeys(start, end) {
  if (!start || !end || start > end) return [];
  const first = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return [];
  const keys = [];
  for (const day = new Date(first); day <= last && keys.length <= 31; day.setDate(day.getDate() + 1)) {
    keys.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`);
  }
  return keys.length <= 31 ? keys : [];
}

export function assignedVacationDays(vacaciones) {
  const days = new Set();
  for (const period of vacaciones?.rows || []) {
    const start = portalDateKey(period.inicio);
    const end = portalDateKey(period.fin);
    for (const date of dateRangeKeys(start, end)) days.add(date);
  }
  return days;
}

export function canRespondToVacationOffer(offer, assignedDays) {
  if (offer.status !== "open" || offer.isOwn) return false;
  const offered = dateRangeKeys(offer.offeredStart, offer.offeredEnd);
  const wanted = dateRangeKeys(offer.wantedStart, offer.wantedEnd);
  return offered.length > 0 && offered.length === wanted.length
    && wanted.every((date) => assignedDays.has(date))
    && offered.every((date) => !assignedDays.has(date));
}

export function vacationSelectionPatch(dateKey, isVacation) {
  return isVacation
    ? { offeredStart: dateKey, offeredEnd: dateKey }
    : { wantedStart: dateKey, wantedEnd: dateKey };
}
