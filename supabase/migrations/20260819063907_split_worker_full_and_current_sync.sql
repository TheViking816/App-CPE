-- The two desktop operations are deliberately explicit. A complete load always
-- refreshes annual history; the normal operation only refreshes the current
-- month and relies on the snapshot merge trigger to preserve older periods.
drop function if exists public.app_cpe_create_worker_manual_jobs();

create function public.app_cpe_create_worker_manual_jobs(
  p_full_history boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_request_kind text := case when p_full_history then 'history' else 'snapshot' end;
  v_job public.app_cpe_portal_sync_jobs;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_cpe_portal_worker_manual_all', 0)
  );

  update public.app_cpe_portal_sync_jobs
  set status = 'failed',
      message = 'Trabajo anterior recuperado sin credenciales',
      finished_at = now()
  where status = 'running'
    and portal_password is null;

  for v_config in
    select config.*
    from public.app_cpe_portal_auto_sync config
    where config.enabled
      and config.portal_password_secret_id is not null
    order by config.chapa
  loop
    -- A queued monthly job can safely be promoted before the worker claims it.
    if p_full_history then
      update public.app_cpe_portal_sync_jobs
      set request_kind = 'history',
          trigger_source = 'worker_manual_all',
          message = 'Carga completa anual en cola',
          expires_at = now() + interval '30 days'
      where chapa = v_config.chapa
        and status = 'queued'
        and portal_password is not null
        and expires_at > now();
      if found then
        v_queued := v_queued + 1;
        continue;
      end if;
    end if;

    if exists (
      select 1
      from public.app_cpe_portal_sync_jobs
      where chapa = v_config.chapa
        and status in ('queued', 'running')
        and portal_password is not null
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

      v_job := private.app_cpe_queue_portal_sync_job(
        v_config.chapa,
        v_password,
        v_security_key,
        'worker_manual_all',
        v_request_kind,
        null,
        case when p_full_history then now() + interval '30 days' else now() + interval '12 hours' end
      );
      v_queued := v_queued + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mode', case when p_full_history then 'history' else 'snapshot' end,
    'queued', v_queued,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function public.app_cpe_create_worker_manual_jobs(boolean) from public, anon, authenticated;
grant execute on function public.app_cpe_create_worker_manual_jobs(boolean) to service_role;
