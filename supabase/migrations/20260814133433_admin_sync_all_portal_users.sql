create or replace function public.app_cpe_create_admin_portal_sync_jobs(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_job_id uuid;
  v_jobs jsonb := '[]'::jsonb;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  v_admin := public.app_cpe_user_from_token(p_token);

  if v_admin.chapa <> '72683' then
    raise exception using
      errcode = '42501',
      message = 'Acceso administrativo no autorizado';
  end if;

  perform pg_advisory_xact_lock(hashtext('app_cpe_admin_sync_all_portal_users'));

  for v_config in
    select *
    from public.app_cpe_portal_auto_sync
    where enabled
      and portal_password_secret_id is not null
    order by chapa
  loop
    if exists (
      select 1
      from public.app_cpe_portal_sync_jobs
      where chapa = v_config.chapa
        and status in ('queued', 'running')
        and expires_at > now()
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      select decrypted_secret into v_password
      from vault.decrypted_secrets
      where id = v_config.portal_password_secret_id;

      select decrypted_secret into v_security_key
      from vault.decrypted_secrets
      where id = v_config.security_key_secret_id;

      if length(coalesce(v_password, '')) < 1 then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.app_cpe_portal_sync_jobs (
        chapa,
        portal_password,
        security_key,
        trigger_source,
        expires_at
      ) values (
        v_config.chapa,
        v_password,
        nullif(v_security_key, ''),
        'admin_all',
        now() + interval '45 minutes'
      )
      returning id into v_job_id;

      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
        'jobId', v_job_id,
        'chapa', v_config.chapa
      ));
      v_queued := v_queued + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  insert into public.app_cpe_usage_events (event_type, chapa, metadata)
  values (
    'portal_sync_all_started',
    v_admin.chapa,
    jsonb_build_object('queued', v_queued, 'skipped', v_skipped)
  );

  return jsonb_build_object(
    'ok', true,
    'queued', v_queued,
    'skipped', v_skipped,
    'jobs', v_jobs
  );
end;
$$;

revoke all on function public.app_cpe_create_admin_portal_sync_jobs(text) from public;
revoke all on function public.app_cpe_create_admin_portal_sync_jobs(text) from anon, authenticated;
grant execute on function public.app_cpe_create_admin_portal_sync_jobs(text) to service_role;
