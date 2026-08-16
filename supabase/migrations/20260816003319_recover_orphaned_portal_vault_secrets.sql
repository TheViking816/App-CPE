create or replace function public.app_cpe_set_portal_auto_sync(
  p_token text,
  p_enabled boolean,
  p_portal_password text default '',
  p_security_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password_secret_id uuid;
  v_security_secret_id uuid;
  v_password_secret_name text;
  v_security_secret_name text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_password_secret_name := 'app_cpe_portal_password_' || v_user.chapa;
  v_security_secret_name := 'app_cpe_portal_security_' || v_user.chapa;

  -- A missing config row cannot be locked with SELECT FOR UPDATE. Serialize by
  -- chapa so two first-time requests cannot create the same named Vault secret.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_cpe_portal_auto_sync:' || v_user.chapa, 0)
  );

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa
  for update;

  if not coalesce(p_enabled, false) then
    -- Delete by both stored IDs and deterministic names so old orphaned
    -- secrets are cleaned up even when the config row has disappeared.
    delete from vault.secrets
    where id = v_config.portal_password_secret_id
       or id = v_config.security_key_secret_id
       or name = v_password_secret_name
       or name = v_security_secret_name;

    delete from public.app_cpe_portal_auto_sync where chapa = v_user.chapa;
    return jsonb_build_object('ok', true, 'enabled', false);
  end if;

  if length(coalesce(p_portal_password, '')) < 1 then
    raise exception 'Introduce la contrasena del portal para activar la sincronizacion automatica';
  end if;

  -- Prefer the configured secret, but recover a same-name orphan left behind
  -- by an older config row before attempting to create a new one.
  select id into v_password_secret_id
  from vault.secrets
  where id = v_config.portal_password_secret_id;

  if v_password_secret_id is null then
    select id into v_password_secret_id
    from vault.secrets
    where name = v_password_secret_name;
  end if;

  if v_password_secret_id is null then
    v_password_secret_id := vault.create_secret(
      p_portal_password,
      v_password_secret_name,
      'Credencial cifrada para la sincronizacion automatica de App CPE'
    );
  else
    perform vault.update_secret(v_password_secret_id, p_portal_password);
  end if;

  select id into v_security_secret_id
  from vault.secrets
  where id = v_config.security_key_secret_id;

  if v_security_secret_id is null then
    select id into v_security_secret_id
    from vault.secrets
    where name = v_security_secret_name;
  end if;

  if length(coalesce(p_security_key, '')) > 0 then
    if v_security_secret_id is null then
      v_security_secret_id := vault.create_secret(
        p_security_key,
        v_security_secret_name,
        'Clave de primas cifrada para la sincronizacion automatica de App CPE'
      );
    else
      perform vault.update_secret(v_security_secret_id, p_security_key);
    end if;
  end if;

  insert into public.app_cpe_portal_auto_sync (
    chapa,
    portal_password_secret_id,
    security_key_secret_id,
    enabled,
    updated_at
  ) values (
    v_user.chapa,
    v_password_secret_id,
    v_security_secret_id,
    true,
    now()
  )
  on conflict (chapa) do update set
    portal_password_secret_id = excluded.portal_password_secret_id,
    security_key_secret_id = excluded.security_key_secret_id,
    enabled = true,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'enabled', true,
    'updatedAt', now()
  );
end;
$$;

revoke all on function public.app_cpe_set_portal_auto_sync(text, boolean, text, text) from public;
grant execute on function public.app_cpe_set_portal_auto_sync(text, boolean, text, text) to anon, authenticated;
