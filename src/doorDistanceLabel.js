export function doorDistanceLabel(value, { compact = false, estimated = false } = {}) {
  if (value == null) return compact ? '--' : 'Sin dato';
  if (value === 0 && !estimated) return 'Estás en puerta';
  return `${estimated ? '≈' : ''}${value}${compact ? '' : ' posiciones'}`;
}
