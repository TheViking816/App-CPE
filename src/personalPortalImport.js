export const PORTAL_LINK_SECTIONS = Object.freeze({
  descansos: 'Descansos', vacaciones: 'Vacaciones', dobles: 'Dobles y HS',
  jornales: 'Jornales y primas', 'donde-voy': 'Mi contratación',
  chapero: 'Chapero', 'chapero-especialidades': 'Chapero por especialidades',
  puertas: 'Puertas', 'jornada-contratada': 'Contratación',
  'mis-especialidades': 'Mis especialidades', 'excepciones-pedidas': 'Excepciones',
  'excluir-jornadas': 'Excluir jornadas', disponibilidad12m: 'Disponibilidad anual',
  'puntos-formacion': 'Puntos de formación', 'situacion-trabajador': 'Situación del trabajador',
  'solicito-formacion': 'Solicitud de formación'
});

export function parsePersonalPortalImport(text, chapa) {
  if (String(chapa) !== '72683') throw new Error('Esta prueba solo está disponible para 72683.');
  if (!text || text.length > 40000) throw new Error('Pega el resultado del marcador (máximo 40.000 caracteres).');
  let input;
  try { input = JSON.parse(text); } catch { throw new Error('El texto no es un JSON válido. Copia el resultado completo del marcador.'); }
  if (input?.version !== 1 || String(input.chapa) !== String(chapa)
      || !Array.isArray(input.enlaces) || !input.enlaces.length || input.enlaces.length > 16) {
    throw new Error('El resultado debe pertenecer a 72683 y contener entre 1 y 16 enlaces.');
  }
  const seen = new Set();
  return { version: 1, chapa: String(chapa), enlaces: input.enlaces.map(entry => {
    let url;
    try { url = new URL(entry.url); } catch { throw new Error('Hay un enlace no válido.'); }
    const section = url.pathname.slice(1), params = url.searchParams;
    if (url.origin !== 'https://norayweb.cpevalencia.com' || url.username || url.password || url.hash
        || !Object.hasOwn(PORTAL_LINK_SECTIONS, section) || entry.seccion !== `/${section}`
        || seen.has(section) || params.get('usr') !== String(chapa)
        || params.get('cal') !== 'gwt' || params.get('mode') !== 'PROD' || params.get('req') !== 'login'
        || !/^[1-9]\d{0,9}$/.test(params.get('rec') || '') || !/^[a-f0-9]{64}$/i.test(params.get('pwd') || '')
        || [...params.keys()].length !== 6 || new Set(params.keys()).size !== 6) {
      throw new Error('Hay un enlace duplicado, de otra cuenta o con parámetros no válidos.');
    }
    seen.add(section);
    const canonical = new URL(`https://norayweb.cpevalencia.com/${section}`);
    for (const key of ['cal','mode','req','usr','rec','pwd']) canonical.searchParams.set(key, params.get(key));
    return { seccion: `/${section}`, url: canonical.href };
  }) };
}
