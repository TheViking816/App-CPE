create or replace function public.app_cpe_get_current_user(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return public.app_cpe_public_user(v_user, p_token);
end;
$$;

revoke all on function public.app_cpe_get_current_user(text) from public;
grant execute on function public.app_cpe_get_current_user(text) to anon, authenticated;
