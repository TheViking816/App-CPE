-- Saved vacation and training sources for the annual salary extract.
create or replace function public.app_cpe_get_saved_salary_history(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_payload jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select payload into v_payload from public.app_cpe_portal_snapshots where chapa=v_user.chapa;
  return jsonb_build_object('payload',jsonb_build_object(
    'jornales',coalesce(v_payload->'jornales','{}'::jsonb),
    'primas',coalesce(v_payload->'primas','{}'::jsonb),
    'descansos',coalesce(v_payload->'descansos','{}'::jsonb),
    'vacaciones',coalesce(v_payload->'vacaciones','{}'::jsonb),
    'disponibilidad',coalesce(v_payload->'disponibilidad','{}'::jsonb)
  ));
end $$;
revoke all on function public.app_cpe_get_saved_salary_history(text) from public, anon, authenticated;
grant execute on function public.app_cpe_get_saved_salary_history(text) to anon, authenticated;
