const PREFIX = 'APP_CPE_MANUAL_V1:';

export function unpackManualNotes(value = '') {
  const text = String(value || '');
  if (!text.startsWith(PREFIX)) return { company: '', vessel: '', part: '', notes: text };
  try {
    const data = JSON.parse(text.slice(PREFIX.length));
    const result = { company: String(data.company || ''), vessel: String(data.vessel || ''), part: String(data.part || ''), notes: String(data.notes || '') };
    if (data.source === 'portal_paste') Object.assign(result, { source: 'portal_paste', portalType: String(data.portalType || ''), operation: String(data.operation || ''), premiumKnown: data.premiumKnown !== false });
    return result;
  } catch {
    return { company: '', vessel: '', part: '', notes: text };
  }
}

export function packManualNotes({ company = '', vessel = '', part = '', notes = '', source = '', portalType = '', operation = '', premiumKnown = true }) {
  const partNumber = String(part).trim();
  if (partNumber && !/^\d{1,12}$/.test(partNumber)) throw new Error('Introduce un número de parte válido.');
  const data = { company: String(company).trim(), vessel: String(vessel).trim(), part: partNumber, notes: String(notes).trim() };
  if (source === 'portal_paste') Object.assign(data, { source, portalType: String(portalType).trim(), operation: String(operation).trim(), premiumKnown: Boolean(premiumKnown) });
  const text = PREFIX + JSON.stringify(data);
  if (text.length > 500) throw new Error('Acorta el nombre del buque o el número de parte.');
  return text;
}
