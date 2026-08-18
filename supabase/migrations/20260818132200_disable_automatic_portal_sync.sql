do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'app-cpe-portal-auto-sync';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

delete from public.app_cpe_portal_sync_jobs
where status = 'queued'
  and trigger_source = 'scheduled';

create or replace function public.app_cpe_claim_scheduled_portal_sync_jobs(p_scheduler_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_expected_secret text;
begin
  select decrypted_secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'app_cpe_portal_scheduler_secret';

  if v_expected_secret is null
    or p_scheduler_secret is null
    or extensions.digest(p_scheduler_secret, 'sha256') <> extensions.digest(v_expected_secret, 'sha256') then
    raise exception 'Scheduler no autorizado';
  end if;

  return jsonb_build_object(
    'ok', true,
    'disabled', true,
    'jobs', '[]'::jsonb
  );
end;
$$;

revoke all on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) from public, anon, authenticated;
grant execute on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) to service_role;
