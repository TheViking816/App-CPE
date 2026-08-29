export function generalBoardPortalDates(now = new Date()) {
  const format = (date, locale) => new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric"
  }).format(date);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const noon = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", weekday: "short"
  }).format(noon);
  const portalDates = [noon, new Date(noon.getTime() + 86400000)];
  if (weekday === "Sat") portalDates.push(new Date(noon.getTime() + 2 * 86400000));

  return {
    portalDates: portalDates.map((date) => format(date, "en-GB")),
    todayIso: format(noon, "en-CA")
  };
}
