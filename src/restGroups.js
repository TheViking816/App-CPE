export const REST_GROUPS = Object.freeze(['A - N', 'A - V', 'B - N', 'B - V', 'C - N', 'C - V']);

export function restGroupCode(value) {
  const match = String(value || '').toUpperCase().match(/\b([ABC])\s*[-–]?\s*([VN])\b/);
  return match ? `${match[1]} - ${match[2]}` : String(value || '').trim();
}
