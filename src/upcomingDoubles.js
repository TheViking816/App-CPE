export function groupUpcomingDoubles(rows = []) {
  const grouped = new Map();
  rows.forEach((request) => {
    const dateKey = String(request?.date || "");
    if (!dateKey) return;
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey).push(request);
  });

  return [...grouped.entries()].map(([dateKey, requests]) => ({
    dateKey,
    requests,
    startsAt: requests[0].startsAt,
    holiday: requests.some((request) => request.holiday)
  }));
}

export function upcomingDoubleDayLabel(startsAt, currentTime = Date.now()) {
  const today = new Date(currentTime);
  today.setHours(0, 0, 0, 0);
  const date = new Date(startsAt);
  date.setHours(0, 0, 0, 0);
  const difference = Math.round((date - today) / 86_400_000);
  if (difference === 0) return "Hoy";
  if (difference === 1) return "Mañana";
  const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "long" }).format(date);
  return weekday.charAt(0).toLocaleUpperCase("es") + weekday.slice(1);
}
