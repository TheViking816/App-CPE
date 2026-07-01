create table if not exists public.app_cpe_support_settings (
  key text primary key,
  value_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_cpe_support_settings enable row level security;

revoke all on public.app_cpe_support_settings from anon, authenticated;

create or replace function public.app_cpe_login(p_chapa text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_token text;
  v_chapa text;
  v_support_hash text;
  v_is_user_password boolean;
  v_is_support_password boolean;
  v_response jsonb;
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);

  select * into v_user
  from public.app_cpe_users
  where chapa = v_chapa;

  if v_user.id is null then
    raise exception 'Chapa o contrasena incorrecta';
  end if;

  select value_hash into v_support_hash
  from public.app_cpe_support_settings
  where key = 'master_password';

  v_is_user_password := v_user.password_hash = crypt(coalesce(p_password, ''), v_user.password_hash);
  v_is_support_password := v_support_hash is not null
    and v_support_hash = crypt(coalesce(p_password, ''), v_support_hash);

  if not v_is_user_password and not v_is_support_password then
    raise exception 'Chapa o contrasena incorrecta';
  end if;

  v_token := public.app_cpe_create_session(v_user.id);
  v_response := public.app_cpe_public_user(v_user, v_token);

  if v_is_support_password and not v_is_user_password then
    insert into public.app_cpe_usage_events (event_type, chapa, metadata)
    values ('support_login', v_user.chapa, jsonb_build_object('mode', 'master_password'));

    return v_response || jsonb_build_object('supportAccess', true);
  end if;

  return v_response;
end;
$$;

grant execute on function public.app_cpe_login(text, text) to anon, authenticated;
