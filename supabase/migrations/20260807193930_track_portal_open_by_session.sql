create or replace function public.app_cpe_track_portal_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if v_user.chapa = '72683' then
    return jsonb_build_object('ok', true, 'tracked', false);
  end if;

  insert into public.app_cpe_usage_events (event_type, chapa, metadata)
  values ('portal_open', v_user.chapa, jsonb_build_object('source', 'bottom_nav'));

  return jsonb_build_object('ok', true, 'tracked', true);
end;
$$;

revoke all on function public.app_cpe_track_portal_open(text) from public;
grant execute on function public.app_cpe_track_portal_open(text) to anon, authenticated;
