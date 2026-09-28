function monthKey(month) {
  const year = Number(month?.year);
  const number = Number(month?.month);
  if (!Number.isInteger(year) || !Number.isInteger(number) || number < 1 || number > 12) return "";
  return `${year}-${String(number).padStart(2, "0")}`;
}

export function mergeTrainingHistory(previous = null, fresh = null, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const currentMonthKey = `${parts.year}-${parts.month}`;
  const daysByMonth = new Map();

  const addMonth = (month) => {
    const key = monthKey(month);
    if (!key) return;
    const [year, number] = key.split("-").map(Number);
    const days = daysByMonth.get(key) || new Set();
    for (const entry of month?.days || []) {
      const day = Number(entry?.day);
      if (String(entry?.code || "").trim().toUpperCase() !== "FM") continue;
      if (!Number.isInteger(day) || day < 1 || day > new Date(year, number, 0).getDate()) continue;
      days.add(day);
    }
    if (days.size) daysByMonth.set(key, days);
  };

  for (const month of [...(previous?.trainingHistory || []), ...(previous?.months || [])]) {
    if (monthKey(month) < currentMonthKey) addMonth(month);
  }
  for (const month of fresh?.months || []) addMonth(month);

  return [...daysByMonth].sort(([left], [right]) => left.localeCompare(right)).map(([key, days]) => {
    const [year, month] = key.split("-").map(Number);
    return { year, month, days: [...days].sort((left, right) => left - right).map((day) => ({ day, code: "FM" })) };
  });
}
