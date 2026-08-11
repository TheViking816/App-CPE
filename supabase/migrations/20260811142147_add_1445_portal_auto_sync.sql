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
  v_hour integer;
  v_minute integer;
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
  v_hour := extract(hour from v_madrid_now)::integer;
  v_minute := extract(minute from v_madrid_now)::integer;

  v_slot_time := case
    when v_minute between 0 and 14 then lpad(v_hour::text, 2, '0') || ':00'
    when v_hour = 7 and v_minute between 30 and 44 then '07:30'
    when v_hour = 12 and v_minute between 30 and 44 then '12:30'
    when v_hour = 14 and v_minute between 45 and 59 then '14:45'
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

revoke all on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) from public, anon, authenticated;
grant execute on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) to service_role;
