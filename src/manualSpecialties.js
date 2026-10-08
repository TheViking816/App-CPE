export const SPECIALTIES_BY_GROUP = Object.freeze({
  I: ['ESTIBADOR', 'TRINCADOR', 'ESPECIALISTA'],
  II: [
    'CONDUCTOR 1a', 'CONDUCTOR 2a', 'TRASTAINERS RTT', 'CONTAINERA',
    'GRUAS', 'ELEVADORAS', 'MAFI', 'MANIPULADOR OPERACION UNICA',
    'APOYO OPERACION', 'GARAJISTA RO-RO', 'FURGONETERO RO-RO'
  ],
  III: ['CLASIFICADOR'],
  IV: ['CAPATAZ', 'SOBORDISTA']
});

export function optionsForGroup(group, current = '') {
  const options = SPECIALTIES_BY_GROUP[group] || [];
  return current && !options.includes(current) ? [...options, current] : options;
}
