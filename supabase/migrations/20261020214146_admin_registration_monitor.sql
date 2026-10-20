-- Registration history comes from accounts, independently of usage tracking.
create function public.app_cpe_admin_registration_monitor(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin public.app_cpe_users;
  v_rows jsonb;
  v_total bigint;
  v_recent bigint;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa is distinct from '72683' then
    raise exception 'Acceso de administrador requerido';
  end if;
  select count(*), count(*) filter (where created_at >= now() - interval '24 hours')
    into v_total, v_recent from public.app_cpe_users where chapa <> '72683';
  select coalesce(jsonb_agg(to_jsonb(registration) order by registration.created_at desc, registration.chapa desc), '[]'::jsonb)
    into v_rows from (
      select chapa, display_name, created_at
      from public.app_cpe_users where chapa <> '72683'
      order by created_at desc, chapa desc limit 100
    ) registration;
  return jsonb_build_object('total', v_total, 'last24h', v_recent, 'registrations', v_rows);
end;
$$;
revoke all on function public.app_cpe_admin_registration_monitor(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_registration_monitor(text) to anon, authenticated;
