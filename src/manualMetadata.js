const PREFIX = 'APP_CPE_MANUAL_V1:';

export function unpackManualNotes(value = '') {
  const text = String(value || '');
  if (!text.startsWith(PREFIX)) return { company: '', vessel: '', part: '', notes: text };
  try {
    const data = JSON.parse(text.slice(PREFIX.length));
    return { company: String(data.company || ''), vessel: String(data.vessel || ''), part: String(data.part || ''), notes: String(data.notes || '') };
  } catch {
    return { company: '', vessel: '', part: '', notes: text };
  }
}

export function packManualNotes({ company = '', vessel = '', part = '', notes = '' }) {
  const partNumber = String(part).trim();
  if (partNumber && !/^\d{1,12}$/.test(partNumber)) throw new Error('Introduce un número de parte válido.');
  const text = PREFIX + JSON.stringify({ company: String(company).trim(), vessel: String(vessel).trim(), part: partNumber, notes: String(notes).trim() });
  if (text.length > 500) throw new Error('Acorta el nombre del buque o el número de parte.');
  return text;
}
