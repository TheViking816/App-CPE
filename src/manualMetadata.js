const PREFIX = 'APP_CPE_MANUAL_V1:';

export function unpackManualNotes(value = '') {
  const text = String(value || '');
  if (!text.startsWith(PREFIX)) return { company: '', vessel: '', notes: text };
  try {
    const data = JSON.parse(text.slice(PREFIX.length));
    return { company: String(data.company || ''), vessel: String(data.vessel || ''), notes: String(data.notes || '') };
  } catch {
    return { company: '', vessel: '', notes: text };
  }
}

export function packManualNotes({ company = '', vessel = '', notes = '' }) {
  const text = PREFIX + JSON.stringify({ company: String(company).trim(), vessel: String(vessel).trim(), notes: String(notes).trim() });
  if (text.length > 500) throw new Error('Acorta las notas o el nombre del buque.');
  return text;
}
