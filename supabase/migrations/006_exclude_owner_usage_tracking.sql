create or replace function public.app_cpe_track_event(
  p_event_type text,
  p_chapa text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_chapa text := nullif(regexp_replace(coalesce(p_chapa, ''), '\D', '', 'g'), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if v_event_type not in ('app_open', 'login', 'register', 'specialties_update') then
    raise exception 'Evento no permitido';
  end if;

  if v_chapa is not null and length(v_chapa) > 5 then
    v_chapa := right(v_chapa, 5);
  end if;

  if v_chapa = '72683' then
    return jsonb_build_object('ok', true, 'tracked', false);
  end if;

  insert into public.app_cpe_usage_events (event_type, chapa, metadata)
  values (v_event_type, v_chapa, v_metadata);

  return jsonb_build_object('ok', true, 'tracked', true);
end;
$$;

create or replace function public.app_cpe_login(
  p_chapa text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_cpe_users;
  v_support_hash text;
  v_chapa text;
  v_token text;
  v_is_user_password boolean := false;
  v_is_support_password boolean := false;
  v_response jsonb;
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);

  select value_hash into v_support_hash
  from public.app_cpe_support_settings
  where key = 'master_password';

  v_is_support_password := v_support_hash is not null
    and v_support_hash = crypt(coalesce(p_password, ''), v_support_hash);

  select * into v_user
  from public.app_cpe_users
  where chapa = v_chapa;

  if v_user.id is null and v_is_support_password then
    insert into public.app_cpe_users (chapa, password_hash, specialties)
    values (v_chapa, crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), '{}'::text[])
    returning * into v_user;
  end if;

  if v_user.id is null then
    raise exception 'Chapa o contrasena incorrecta';
  end if;

  v_is_user_password := v_user.password_hash = crypt(coalesce(p_password, ''), v_user.password_hash);

  if not v_is_user_password and not v_is_support_password then
    raise exception 'Chapa o contrasena incorrecta';
  end if;

  v_token := public.app_cpe_create_session(v_user.id);
  v_response := public.app_cpe_public_user(v_user, v_token);

  if v_is_support_password and not v_is_user_password then
    if v_user.chapa <> '72683' then
      insert into public.app_cpe_usage_events (event_type, chapa, metadata)
      values ('support_login', v_user.chapa, jsonb_build_object('mode', 'master_password'));
    end if;

    return v_response || jsonb_build_object('supportAccess', true);
  end if;

  return v_response;
end;
$$;

grant execute on function public.app_cpe_login(text, text) to anon, authenticated;

delete from public.app_cpe_usage_events
where chapa = '72683';
