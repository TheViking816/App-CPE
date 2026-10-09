import { supabase } from './supabaseClient.js';

async function rpc(name, args) {
  if (!supabase) throw new Error('Falta la configuración de la base de datos.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function getPersonalRestCalendar(token) {
  const [overrides, paidDays] = await Promise.all([
    rpc('app_cpe_list_rest_day_overrides', { p_token: token }),
    listManualPaidDays(token)
  ]);
  return { overrides: overrides || [], paidDays: paidDays || [] };
}

export const listManualPaidDays = (token) =>
  rpc('app_cpe_list_manual_paid_days', { p_token: token });

export const saveManualVacationDay = (token, date) =>
  rpc('app_cpe_save_manual_paid_day', { p_token: token, p_id: null, p_work_date: date, p_concept_type: 'VA' });

export const deleteManualPaidDay = (token, id) =>
  rpc('app_cpe_delete_manual_paid_day', { p_token: token, p_id: id });

export const addManualVacationRange = (token, start, end) =>
  rpc('app_cpe_add_manual_vacation_range', { p_token: token, p_start: start, p_end: end });

export const saveRestDayOverride = (token, date, type) =>
  rpc('app_cpe_save_rest_day_override', { p_token: token, p_work_date: date, p_day_type: type });

export const deleteRestDayOverride = (token, date) =>
  rpc('app_cpe_delete_rest_day_override', { p_token: token, p_work_date: date });
