// Shared by the redirect API and Monitor; no personal URLs or credentials.
export const personalLinkLabels = Object.freeze({
  'donde-voy': 'Mi contratación',
  vacaciones: 'Vacaciones',
  dobles: 'Dobles y HS',
  jornales: 'Jornales y primas',
  descansos: 'Descansos',
  'descansos-permuta': 'Cambio de descansos',
  'excepciones-pedidas': 'Excepciones',
  'calendario-base': 'Calendario',
  'mis-especialidades': 'Mis especialidades',
  'solicito-formacion': 'Solicitar formación',
  disponibilidad12m: 'Disponibilidad · últimos 12 meses',
  chapero: 'Chapero',
  'chapero-especialidades': 'Chapero por especialidades',
  puertas: 'Puertas',
  'jornada-contratada': 'Jornada contratada',
  'situacion-trabajador': 'Jornada flexible'
});

export function personalLinkCounts(sections = []) {
  const counts = new Map(sections.map(item => [item.section, item.opens]));
  return Object.keys(personalLinkLabels).map(section => ({ section, opens: counts.get(section) || 0 }));
}
