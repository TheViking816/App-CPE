-- Master-password sessions are support sessions, not user activity. Keep their
-- navigation and app opens out of both the usage table and the admin monitor.
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

  v_is_support_session := v_is_support_password;
  v_token := public.app_cpe_create_session(v_user.id);

  if v_is_support_session then
    update public.app_cpe_sessions
    set is_support = true
    where token_hash = encode(digest(v_token, 'sha256'), 'hex');
  end if;

  v_response := public.app_cpe_public_user(v_user, v_token);
  if v_is_support_session then
    return v_response || jsonb_build_object('supportAccess', true);
  end if;

  return v_response;
end;
$$;

revoke all on function public.app_cpe_login(text, text) from public;
grant execute on function public.app_cpe_login(text, text) to anon, authenticated;

create or replace function public.app_cpe_touch_portal_activity(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_is_support_session boolean := false;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select coalesce(s.is_support, false)
  into v_is_support_session
  from public.app_cpe_sessions s
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now();

  if v_is_support_session then
    return jsonb_build_object(
      'ok', true,
      'tracked', false,
      'reason', 'support_session',
      'syncStatus', 'support_session',
      'reactivated', false,
      'refreshQueued', false
    );
  end if;

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa
  for update;

  if v_config.chapa is null then
    return jsonb_build_object(
      'ok', true,
      'syncStatus', 'not_configured',
      'reactivated', false,
      'refreshQueued', false
    );
  end if;

  update public.app_cpe_portal_auto_sync
  set last_app_seen_at = now(),
      updated_at = now()
  where chapa = v_user.chapa
  returning * into v_config;

  return jsonb_build_object(
    'ok', true,
    'syncStatus', v_config.sync_status,
    'lastAppSeenAt', v_config.last_app_seen_at,
    'pausedAt', v_config.paused_at,
    'pauseReason', v_config.pause_reason,
    'reactivated', false,
    'refreshQueued', false,
    'jobId', null
  );
end;
$$;

revoke all on function public.app_cpe_touch_portal_activity(text) from public, anon, authenticated;
grant execute on function public.app_cpe_touch_portal_activity(text) to anon, authenticated;

delete from public.app_cpe_usage_events
where event_type = 'support_login';
