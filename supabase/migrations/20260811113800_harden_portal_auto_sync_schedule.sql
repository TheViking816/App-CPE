create or replace function public.app_cpe_claim_scheduled_portal_sync_jobs(
  p_scheduler_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_expected_secret text;
  v_madrid_now timestamp;
  v_minutes integer;
  v_slot_time text;
  v_slot text;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_job public.app_cpe_portal_sync_jobs;
  v_jobs jsonb := '[]'::jsonb;
begin
  select decrypted_secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'app_cpe_portal_scheduler_secret';

  if v_expected_secret is null
     or p_scheduler_secret is null
     or extensions.digest(p_scheduler_secret, 'sha256') <> extensions.digest(v_expected_secret, 'sha256') then
    raise exception 'Scheduler no autorizado';
  end if;

  v_madrid_now := timezone('Europe/Madrid', now());
  v_minutes := extract(hour from v_madrid_now)::integer * 60
    + extract(minute from v_madrid_now)::integer;

  v_slot_time := case
    when v_minutes between 450 and 464 then '07:30'
    when v_minutes between 750 and 764 then '12:30'
    when v_minutes between 900 and 914 then '15:00'
    else null
  end;

  if v_slot_time is null then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'localTime', to_char(v_madrid_now, 'HH24:MI'),
      'jobs', v_jobs
    );
  end if;

  v_slot := to_char(v_madrid_now, 'YYYY-MM-DD') || 'T' || v_slot_time;

  for v_config in
    select *
    from public.app_cpe_portal_auto_sync
    where enabled
      and last_scheduled_slot is distinct from v_slot
    order by chapa
    for update skip locked
  loop
    select decrypted_secret into v_password
    from vault.decrypted_secrets
    where id = v_config.portal_password_secret_id;

    select decrypted_secret into v_security_key
    from vault.decrypted_secrets
    where id = v_config.security_key_secret_id;

    if length(coalesce(v_password, '')) > 0 then
      insert into public.app_cpe_portal_sync_jobs (
        chapa,
        portal_password,
        security_key,
        trigger_source,
        schedule_slot,
        expires_at
      ) values (
        v_config.chapa,
        v_password,
        nullif(v_security_key, ''),
        'scheduled',
        v_slot,
        now() + interval '45 minutes'
      ) returning * into v_job;

      update public.app_cpe_portal_auto_sync
      set last_scheduled_slot = v_slot,
          last_scheduled_at = now(),
          updated_at = now()
      where chapa = v_config.chapa;

      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
        'jobId', v_job.id,
        'chapa', v_job.chapa
      ));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'skipped', false, 'slot', v_slot, 'jobs', v_jobs);
end;
$$;

create or replace function public.app_cpe_update_auto_sync_success()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.trigger_source <> 'scheduled' or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'completed' then
    update public.app_cpe_portal_auto_sync
    set last_success_at = coalesce(new.finished_at, now()),
        updated_at = now()
    where chapa = new.chapa;
  elsif new.status = 'failed' then
    update public.app_cpe_portal_auto_sync
    set last_scheduled_slot = null,
        updated_at = now()
    where chapa = new.chapa
      and last_scheduled_slot = new.schedule_slot;
  end if;

  return new;
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'app-cpe-portal-auto-sync';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'app-cpe-portal-auto-sync',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://wvwdiywtlbffumshbboa.supabase.co/functions/v1/schedule-portal-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-scheduler-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'app_cpe_portal_scheduler_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $cron$
  );
end;
$$;
