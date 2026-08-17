create or replace function public.app_cpe_create_worker_catchup_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_request_kind text;
  v_job public.app_cpe_portal_sync_jobs;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_cpe_portal_worker_startup_catchup', 0)
  );

  for v_config in
    select config.*
    from public.app_cpe_portal_auto_sync config
    left join public.app_cpe_portal_snapshots snapshot on snapshot.chapa = config.chapa
    where config.enabled
      and config.portal_password_secret_id is not null
      and (snapshot.updated_at is null or snapshot.updated_at < now() - interval '2 hours')
    order by config.chapa
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

      select case when exists (
        select 1
        from public.app_cpe_portal_snapshots snapshot
        where snapshot.chapa = v_config.chapa
          and (
            (jsonb_typeof(snapshot.payload #> '{jornales,rows}') = 'array'
              and jsonb_array_length(snapshot.payload #> '{jornales,rows}') > 0)
            or
            (jsonb_typeof(snapshot.payload #> '{jornales,history}') = 'array'
              and jsonb_array_length(snapshot.payload #> '{jornales,history}') > 0)
          )
      ) then 'snapshot' else 'history' end into v_request_kind;

      v_job := private.app_cpe_queue_portal_sync_job(
        v_config.chapa,
        v_password,
        v_security_key,
        'worker_startup',
        v_request_kind,
        null,
        now() + interval '12 hours'
      );
      v_queued := v_queued + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'queued', v_queued, 'skipped', v_skipped);
end;
$$;

revoke all on function public.app_cpe_create_worker_catchup_jobs() from public, anon, authenticated;
grant execute on function public.app_cpe_create_worker_catchup_jobs() to service_role;
