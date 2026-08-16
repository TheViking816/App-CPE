function shiftStart(value) {
  return Number(String(value || "").match(/(?:DE\s*)?(\d{1,2})\s*A\s*\d{1,2}/i)?.[1] || -1);
}

export function compareExceptionsDescending(left, right) {
  return String(right?.date || "").localeCompare(String(left?.date || ""))
    || shiftStart(right?.shift) - shiftStart(left?.shift)
    || String(right?.requestedAt || "").localeCompare(String(left?.requestedAt || ""));
}
