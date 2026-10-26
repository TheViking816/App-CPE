import { validateUpcomingReading, UPCOMING_PREVIEW_CHANNEL } from '../src/upcomingAssignments.js';
import { supabaseAdminHeaders } from './supabase-admin.js';

export async function publishUpcomingPreview(reading, key, { fetcher = fetch } = {}) {
  if (!key) throw new Error('Falta la credencial local para guardar el canal de revisión.');
  const valid = validateUpcomingReading(reading);
  const record = { channel: UPCOMING_PREVIEW_CHANNEL, chapa: '72683', source: 'personal-noray-upcoming-preview', payload: { upcomingAssignments: valid }, updated_at: valid.updatedAt };
  const response = await fetcher('https://wvwdiywtlbffumshbboa.supabase.co/rest/v1/app_cpe_portal_preview_snapshots?on_conflict=channel,chapa', {
    method: 'POST', headers: supabaseAdminHeaders(key, { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(record)
  });
  if (!response.ok) throw new Error(`No se guardó el canal de revisión: HTTP ${response.status}`);
}
