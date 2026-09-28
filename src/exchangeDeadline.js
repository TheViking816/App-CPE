// Exchange requests close at the start of either relevant day in Madrid.
export function madridTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function restOfferExpired(offer, today = madridTodayKey()) {
  return Boolean((offer.offeredDate && offer.offeredDate <= today)
    || (offer.wantedDate && offer.wantedDate <= today));
}

export function vacationOfferExpired(offer, today = madridTodayKey()) {
  return Boolean(offer.offeredStart <= today || offer.wantedStart <= today);
}
