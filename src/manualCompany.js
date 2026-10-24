const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

const aliases = [
  ['CSP', /\bCSP\b|COSCO SHIPPING PORTS/],
  ['APM', /\bAPM\b|\bTCV\b|TERMINALES? DE CONTENEDORES DE VALENCIA/],
  ['MSC', /\bMSC\b|MEDITERRANEAN SHIPPING/],
  ['VTEU', /\bVTEU\b|VALENCIA TERMINAL EUROPA|GRIMALDI/],
  ['ERH', /\bERH\b|ERSHIP|EUROPEA DE HANDLING/],
  ['BALEARIA', /BALEARIA/],
  ['TRASMED', /TRASMED/],
  ['CPE', /\bCPE\b|SEVASA|CENTRO PORTUARIO DE EMPLEO/]
];

export function companySelectValue(value) {
  const raw = String(value || '').trim();
  const name = normalize(raw);
  return aliases.find(([, pattern]) => pattern.test(name))?.[0] || raw;
}
