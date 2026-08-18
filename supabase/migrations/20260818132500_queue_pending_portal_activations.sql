create or replace function public.app_cpe_queue_pending_portal_activation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.portal_activation_status <> 'pending' then
    raise exception 'La cuenta ya está activada';
  end if;

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa and enabled;

  if v_config.portal_password_secret_id is null then
    raise exception 'Guarda primero las claves del portal';
  end if;

  select decrypted_secret into v_password
  from vault.decrypted_secrets
  where id = v_config.portal_password_secret_id;

  select decrypted_secret into v_security_key
  from vault.decrypted_secrets
  where id = v_config.security_key_secret_id;

  if length(coalesce(v_password, '')) < 1 then
    raise exception 'No se pudo recuperar la contraseña cifrada';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_user.chapa, 0)
  );

  v_job := private.app_cpe_queue_portal_sync_job(
    v_user.chapa,
    v_password,
    v_security_key,
    'activation_pending',
    'history',
    null,
    now() + interval '30 days'
  );

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'requestedAt', v_job.requested_at
  );
end;
$$;

revoke all on function public.app_cpe_queue_pending_portal_activation(text) from public;
grant execute on function public.app_cpe_queue_pending_portal_activation(text) to anon, authenticated;

do $$
declare
  v_config record;
  v_password text;
  v_security_key text;
begin
  for v_config in
    select a.*
    from public.app_cpe_portal_auto_sync a
    join public.app_cpe_users u on u.chapa = a.chapa
    where a.enabled
      and u.portal_activation_status = 'pending'
      and not exists (
        select 1
        from public.app_cpe_portal_sync_jobs j
        where j.chapa = a.chapa
      )
  loop
    select decrypted_secret into v_password
    from vault.decrypted_secrets
    where id = v_config.portal_password_secret_id;

    select decrypted_secret into v_security_key
    from vault.decrypted_secrets
    where id = v_config.security_key_secret_id;

    if length(coalesce(v_password, '')) > 0 then
      perform private.app_cpe_queue_portal_sync_job(
        v_config.chapa,
        v_password,
        v_security_key,
        'activation_pending',
        'history',
        null,
        now() + interval '30 days'
      );
    end if;
  end loop;
end;
$$;
