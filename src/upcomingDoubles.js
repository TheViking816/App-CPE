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
    holiday: requests.some((request) => request.holiday),
    contractedCount: requests.filter((request) => request.contracted).length
  }));
}

function normalizeDoubleShift(value) {
  const hours = String(value || "").match(/(\d{1,2})\s*(?:A|\/|-|–)\s*(\d{1,2})/i);
  return hours ? `${hours[1].padStart(2, "0")}-${hours[2].padStart(2, "0")}` : "";
}

function normalizeDoubleSpecialty(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\s*\d+\s*[-–.]\s*/, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("es");
}

export function markContractedUpcomingDoubles(rows = [], assignments = []) {
  const requestedSlotCounts = rows.reduce((counts, request) => {
    const slot = `${String(request?.date || "").trim()}|${normalizeDoubleShift(request?.journey || request?.jornada)}`;
    counts.set(slot, (counts.get(slot) || 0) + 1);
    return counts;
  }, new Map());
  const assignmentSlots = assignments.map((assignment) => ({
    assignment,
    date: String(assignment?.fecha || assignment?.date || "").trim(),
    shift: normalizeDoubleShift(assignment?.jornada || assignment?.journey),
    specialty: normalizeDoubleSpecialty(assignment?.especialidad || assignment?.specialty)
  }));

  return rows.map((request) => {
    const date = String(request?.date || "").trim();
    const shift = normalizeDoubleShift(request?.journey || request?.jornada);
    const specialty = normalizeDoubleSpecialty(request?.specialty || request?.especialidad);
    const requestSlot = `${date}|${shift}`;
    const sameSlot = assignmentSlots.filter((candidate) => candidate.date === date && candidate.shift === shift);
    const exact = sameSlot.find((candidate) => candidate.specialty && candidate.specialty === specialty);
    const contractedBy = exact || (sameSlot.length === 1 && requestedSlotCounts.get(requestSlot) === 1 ? sameSlot[0] : null);
    return contractedBy ? { ...request, contracted: true, contractedAssignment: contractedBy.assignment } : request;
  });
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
