create table if not exists public.app_cpe_portal_auto_sync (
  chapa text primary key references public.app_cpe_users(chapa) on delete cascade,
  portal_password_secret_id uuid not null,
  security_key_secret_id uuid,
  enabled boolean not null default true,
  last_scheduled_slot text,
  last_scheduled_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_cpe_portal_auto_sync enable row level security;
revoke all on public.app_cpe_portal_auto_sync from public, anon, authenticated;

alter table public.app_cpe_portal_sync_jobs
  add column if not exists trigger_source text not null default 'manual',
  add column if not exists schedule_slot text;

create index if not exists app_cpe_portal_sync_jobs_schedule_idx
  on public.app_cpe_portal_sync_jobs (schedule_slot, chapa)
  where schedule_slot is not null;

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
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa
  for update;

  if not coalesce(p_enabled, false) then
    if v_config.portal_password_secret_id is not null then
      delete from vault.secrets where id = v_config.portal_password_secret_id;
    end if;
    if v_config.security_key_secret_id is not null then
      delete from vault.secrets where id = v_config.security_key_secret_id;
    end if;
    delete from public.app_cpe_portal_auto_sync where chapa = v_user.chapa;
    return jsonb_build_object('ok', true, 'enabled', false);
  end if;

  if length(coalesce(p_portal_password, '')) < 1 then
    raise exception 'Introduce la contrasena del portal para activar la sincronizacion automatica';
  end if;

  if v_config.portal_password_secret_id is null then
    v_password_secret_id := vault.create_secret(
      p_portal_password,
      'app_cpe_portal_password_' || v_user.chapa,
      'Credencial cifrada para la sincronizacion automatica de App CPE'
    );
  else
    v_password_secret_id := v_config.portal_password_secret_id;
    perform vault.update_secret(v_password_secret_id, p_portal_password);
  end if;

  if length(coalesce(p_security_key, '')) > 0 then
    if v_config.security_key_secret_id is null then
      v_security_secret_id := vault.create_secret(
        p_security_key,
        'app_cpe_portal_security_' || v_user.chapa,
        'Clave de primas cifrada para la sincronizacion automatica de App CPE'
      );
    else
      v_security_secret_id := v_config.security_key_secret_id;
      perform vault.update_secret(v_security_secret_id, p_security_key);
    end if;
  else
    v_security_secret_id := v_config.security_key_secret_id;
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

create or replace function public.app_cpe_get_portal_auto_sync_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa;

  return jsonb_build_object(
    'ok', true,
    'enabled', coalesce(v_config.enabled, false),
    'hasSecurityKey', v_config.security_key_secret_id is not null,
    'lastScheduledAt', v_config.last_scheduled_at,
    'lastSuccessAt', v_config.last_success_at,
    'updatedAt', v_config.updated_at
  );
end;
$$;

create or replace function public.app_cpe_create_portal_sync_job_from_saved(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa and enabled;

  if v_config.portal_password_secret_id is null then
    raise exception 'No hay claves cifradas guardadas para este usuario';
  end if;

  select decrypted_secret into v_password
  from vault.decrypted_secrets
  where id = v_config.portal_password_secret_id;

  select decrypted_secret into v_security_key
  from vault.decrypted_secrets
  where id = v_config.security_key_secret_id;

  if length(coalesce(v_password, '')) < 1 then
    raise exception 'No se pudo recuperar la contrasena cifrada';
  end if;

  insert into public.app_cpe_portal_sync_jobs (
    chapa,
    portal_password,
    security_key,
    trigger_source,
    expires_at
  ) values (
    v_user.chapa,
    v_password,
    nullif(v_security_key, ''),
    'saved_credentials',
    now() + interval '45 minutes'
  ) returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'requestedAt', v_job.requested_at
  );
end;
$$;

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
  v_local_time text;
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
  v_local_time := to_char(v_madrid_now, 'HH24:MI');
  if v_local_time not in ('07:30', '12:30', '15:00') then
    return jsonb_build_object('ok', true, 'skipped', true, 'localTime', v_local_time, 'jobs', v_jobs);
  end if;

  v_slot := to_char(v_madrid_now, 'YYYY-MM-DD') || 'T' || v_local_time;

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
  if new.trigger_source = 'scheduled' and new.status = 'completed' and old.status is distinct from new.status then
    update public.app_cpe_portal_auto_sync
    set last_success_at = coalesce(new.finished_at, now()),
        updated_at = now()
    where chapa = new.chapa;
  end if;
  return new;
end;
$$;

drop trigger if exists app_cpe_portal_auto_sync_success on public.app_cpe_portal_sync_jobs;
create trigger app_cpe_portal_auto_sync_success
after update of status on public.app_cpe_portal_sync_jobs
for each row execute function public.app_cpe_update_auto_sync_success();

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'app_cpe_portal_scheduler_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'app_cpe_portal_scheduler_secret',
      'Token interno para Supabase Cron; no exponer al cliente'
    );
  end if;
end;
$$;

revoke all on function public.app_cpe_set_portal_auto_sync(text, boolean, text, text) from public;
revoke all on function public.app_cpe_get_portal_auto_sync_status(text) from public;
revoke all on function public.app_cpe_create_portal_sync_job_from_saved(text) from public;
revoke all on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) from public;
revoke all on function public.app_cpe_update_auto_sync_success() from public;

grant execute on function public.app_cpe_set_portal_auto_sync(text, boolean, text, text) to anon, authenticated;
grant execute on function public.app_cpe_get_portal_auto_sync_status(text) to anon, authenticated;
grant execute on function public.app_cpe_create_portal_sync_job_from_saved(text) to anon, authenticated;
grant execute on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) to service_role;

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
    '*/30 * * * *',
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
