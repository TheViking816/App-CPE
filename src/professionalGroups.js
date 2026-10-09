export const PROFESSIONAL_GROUPS = Object.freeze([
  { code: 'G-IV', label: 'G-IV · Capataces' },
  { code: 'G-III', label: 'G-III · Clasificadores' },
  { code: 'G-A', label: 'G-A · Gruístas' },
  { code: 'G-B', label: 'G-B · Móvil, pico y RTT' },
  { code: 'G-C', label: 'G-C · Pala, MAFFI y RTT' },
  { code: 'G-D', label: 'G-D · Containera y RTT' },
  { code: 'G-DA', label: 'G-DA · Solo RTT' },
  { code: 'G-DB', label: 'G-DB · Solo containera' },
  { code: 'G-E', label: 'G-E · Auxiliares de vehículos' },
  { code: 'G-I', label: 'G-I · Estibadores' },
  { code: 'SIN-F', label: 'SIN-F · Pendiente de formación' }
]);

export function professionalGroupCode(value) {
  const text = String(value || '').trim().toUpperCase();
  return (text.match(/^\(\s*([A-Z0-9-]+)\s*\)/)?.[1] || text).trim();
}

export function professionalGroupLabel(value) {
  const code = professionalGroupCode(value);
  return PROFESSIONAL_GROUPS.find((group) => group.code === code)?.label || code;
}
