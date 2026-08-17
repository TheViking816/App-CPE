-- The queue is a live status table. Historical usage is already retained in
-- app_cpe_usage_events, so keep only the most recent attempt for each worker.
with ranked as (
  select id,
         row_number() over (partition by chapa order by requested_at desc, created_at desc, id desc) as position
  from public.app_cpe_portal_sync_jobs
)
delete from public.app_cpe_portal_sync_jobs jobs
using ranked
where jobs.id = ranked.id
  and ranked.position > 1;

drop index if exists public.app_cpe_portal_sync_jobs_chapa_idx;
create unique index if not exists app_cpe_portal_sync_jobs_chapa_key
  on public.app_cpe_portal_sync_jobs (chapa);

create or replace function private.app_cpe_queue_portal_sync_job(
  p_chapa text,
  p_portal_password text,
  p_security_key text,
  p_trigger_source text,
  p_request_kind text,
  p_document_id text,
  p_expires_at timestamptz,
  p_schedule_slot text default null
)
returns public.app_cpe_portal_sync_jobs
language plpgsql
security invoker
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_job public.app_cpe_portal_sync_jobs;
begin
  insert into public.app_cpe_portal_sync_jobs (
    chapa, portal_password, security_key, status, message,
    requested_at, started_at, finished_at, expires_at, created_at,
    trigger_source, schedule_slot, request_kind, document_id
  ) values (
    p_chapa, p_portal_password, nullif(p_security_key, ''), 'queued', null,
    now(), null, null, p_expires_at, now(),
    p_trigger_source, p_schedule_slot, p_request_kind, p_document_id
  )
  on conflict (chapa) do update set
    portal_password = excluded.portal_password,
    security_key = excluded.security_key,
    status = 'queued',
    message = null,
    requested_at = excluded.requested_at,
    started_at = null,
    finished_at = null,
    expires_at = excluded.expires_at,
    created_at = excluded.created_at,
    trigger_source = excluded.trigger_source,
    schedule_slot = excluded.schedule_slot,
    request_kind = excluded.request_kind,
    document_id = excluded.document_id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function private.app_cpe_queue_portal_sync_job(text, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;

create or replace function public.app_cpe_create_portal_sync_job(
  p_token text,
  p_portal_password text,
  p_security_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_job public.app_cpe_portal_sync_jobs;
  v_request_kind text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if length(coalesce(p_portal_password, '')) < 1 then
    raise exception 'Introduce la contrasena del portal';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_user.chapa, 0));
  select * into v_job from public.app_cpe_portal_sync_jobs
  where chapa = v_user.chapa and status in ('queued', 'running') and expires_at > now();
  if v_job.id is not null then
    return jsonb_build_object('ok', true, 'jobId', v_job.id, 'status', v_job.status, 'requestedAt', v_job.requested_at, 'reused', true);
  end if;

  select case when exists (
    select 1 from public.app_cpe_portal_snapshots snapshot
    where snapshot.chapa = v_user.chapa and (
      (jsonb_typeof(snapshot.payload #> '{jornales,rows}') = 'array' and jsonb_array_length(snapshot.payload #> '{jornales,rows}') > 0)
      or (jsonb_typeof(snapshot.payload #> '{jornales,history}') = 'array' and jsonb_array_length(snapshot.payload #> '{jornales,history}') > 0)
    )
  ) then 'snapshot' else 'history' end into v_request_kind;

  v_job := private.app_cpe_queue_portal_sync_job(v_user.chapa, p_portal_password, p_security_key, 'manual', v_request_kind, null, now() + interval '15 minutes');

  if v_user.chapa <> '72683' then
    insert into public.app_cpe_usage_events (event_type, chapa, metadata)
    values ('portal_sync_started', v_user.chapa, jsonb_build_object('job_id', v_job.id, 'with_primas_key', nullif(p_security_key, '') is not null, 'request_kind', v_request_kind));
  end if;

  return jsonb_build_object('ok', true, 'jobId', v_job.id, 'status', v_job.status, 'requestedAt', v_job.requested_at, 'requestKind', v_request_kind, 'reused', false);
end;
$$;

create or replace function public.app_cpe_create_portal_sync_job_from_saved(p_token text)
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
  v_request_kind text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_user.chapa, 0));
  select * into v_job from public.app_cpe_portal_sync_jobs
  where chapa = v_user.chapa and status in ('queued', 'running') and expires_at > now();
  if v_job.id is not null then
    return jsonb_build_object('ok', true, 'jobId', v_job.id, 'status', v_job.status, 'requestedAt', v_job.requested_at, 'reused', true);
  end if;

  select * into v_config from public.app_cpe_portal_auto_sync where chapa = v_user.chapa and enabled;
  if v_config.portal_password_secret_id is null then raise exception 'No hay claves cifradas guardadas para este usuario'; end if;
  select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
  select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
  if length(coalesce(v_password, '')) < 1 then raise exception 'No se pudo recuperar la contrasena cifrada'; end if;

  select case when exists (
    select 1 from public.app_cpe_portal_snapshots snapshot
    where snapshot.chapa = v_user.chapa and (
      (jsonb_typeof(snapshot.payload #> '{jornales,rows}') = 'array' and jsonb_array_length(snapshot.payload #> '{jornales,rows}') > 0)
      or (jsonb_typeof(snapshot.payload #> '{jornales,history}') = 'array' and jsonb_array_length(snapshot.payload #> '{jornales,history}') > 0)
    )
  ) then 'snapshot' else 'history' end into v_request_kind;

  v_job := private.app_cpe_queue_portal_sync_job(v_user.chapa, v_password, v_security_key, 'saved_credentials', v_request_kind, null, now() + interval '45 minutes');
  return jsonb_build_object('ok', true, 'jobId', v_job.id, 'status', v_job.status, 'requestedAt', v_job.requested_at, 'requestKind', v_request_kind, 'reused', false);
end;
$$;

create or replace function public.app_cpe_create_portal_document_job(p_token text, p_document_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_snapshot public.app_cpe_portal_snapshots;
  v_password text;
  v_security_key text;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if length(coalesce(p_document_id, '')) < 1 or length(p_document_id) > 240 then raise exception 'Documento no valido'; end if;
  select * into v_snapshot from public.app_cpe_portal_snapshots where chapa = v_user.chapa;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_snapshot.payload->'nominas'->'rows', '[]'::jsonb)) item where item->>'id' = p_document_id
  ) then raise exception 'La nomina solicitada no pertenece a este usuario'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_user.chapa, 0));
  select * into v_job from public.app_cpe_portal_sync_jobs
  where chapa = v_user.chapa and status in ('queued', 'running') and expires_at > now();
  if v_job.id is not null then
    return jsonb_build_object('ok', true, 'jobId', v_job.id, 'status', v_job.status, 'requestedAt', v_job.requested_at, 'reused', true);
  end if;

  select * into v_config from public.app_cpe_portal_auto_sync where chapa = v_user.chapa and enabled;
  if v_config.portal_password_secret_id is null or v_config.security_key_secret_id is null then
    raise exception 'Guarda la contrasena del portal y la clave de seguridad para abrir nominas';
  end if;
  select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
  select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
  if length(coalesce(v_password, '')) < 1 or length(coalesce(v_security_key, '')) < 1 then raise exception 'No se pudieron recuperar las claves guardadas'; end if;

  v_job := private.app_cpe_queue_portal_sync_job(v_user.chapa, v_password, v_security_key, 'document', 'document', p_document_id, now() + interval '15 minutes');
  return jsonb_build_object('ok', true, 'jobId', v_job.id, 'status', v_job.status, 'requestedAt', v_job.requested_at, 'reused', false);
end;
$$;

create or replace function public.app_cpe_create_admin_portal_sync_jobs(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_job public.app_cpe_portal_sync_jobs;
  v_jobs jsonb := '[]'::jsonb;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado'; end if;
  perform pg_advisory_xact_lock(hashtext('app_cpe_admin_sync_all_portal_users'));

  for v_config in select * from public.app_cpe_portal_auto_sync where enabled and portal_password_secret_id is not null order by chapa loop
    if exists (select 1 from public.app_cpe_portal_sync_jobs where chapa = v_config.chapa and status in ('queued', 'running') and expires_at > now()) then
      v_skipped := v_skipped + 1; continue;
    end if;
    begin
      select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
      select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
      if length(coalesce(v_password, '')) < 1 then v_skipped := v_skipped + 1; continue; end if;
      v_job := private.app_cpe_queue_portal_sync_job(v_config.chapa, v_password, v_security_key, 'admin_all', 'snapshot', null, now() + interval '45 minutes');
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object('jobId', v_job.id, 'chapa', v_config.chapa));
      v_queued := v_queued + 1;
    exception when others then v_skipped := v_skipped + 1;
    end;
  end loop;

  insert into public.app_cpe_usage_events (event_type, chapa, metadata)
  values ('portal_sync_all_started', v_admin.chapa, jsonb_build_object('queued', v_queued, 'skipped', v_skipped));
  return jsonb_build_object('ok', true, 'queued', v_queued, 'skipped', v_skipped, 'jobs', v_jobs);
end;
$$;

create or replace function public.app_cpe_claim_scheduled_portal_sync_jobs(p_scheduler_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
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
  select decrypted_secret into v_expected_secret from vault.decrypted_secrets where name = 'app_cpe_portal_scheduler_secret';
  if v_expected_secret is null or p_scheduler_secret is null or extensions.digest(p_scheduler_secret, 'sha256') <> extensions.digest(v_expected_secret, 'sha256') then
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
    return jsonb_build_object('ok', true, 'skipped', true, 'localTime', to_char(v_madrid_now, 'HH24:MI'), 'jobs', v_jobs);
  end if;
  v_slot := to_char(v_madrid_now, 'YYYY-MM-DD') || 'T' || v_slot_time;

  for v_config in
    select * from public.app_cpe_portal_auto_sync
    where enabled and last_scheduled_slot is distinct from v_slot
    order by chapa for update skip locked
  loop
    if exists (select 1 from public.app_cpe_portal_sync_jobs where chapa = v_config.chapa and status in ('queued', 'running') and expires_at > now()) then continue; end if;
    select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
    select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
    if length(coalesce(v_password, '')) > 0 then
      v_job := private.app_cpe_queue_portal_sync_job(v_config.chapa, v_password, v_security_key, 'scheduled', 'snapshot', null, now() + interval '45 minutes', v_slot);
      update public.app_cpe_portal_auto_sync set last_scheduled_slot = v_slot, last_scheduled_at = now(), updated_at = now() where chapa = v_config.chapa;
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object('jobId', v_job.id, 'chapa', v_job.chapa));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'skipped', false, 'slot', v_slot, 'jobs', v_jobs);
end;
$$;

revoke all on function public.app_cpe_create_portal_sync_job(text, text, text) from public;
grant execute on function public.app_cpe_create_portal_sync_job(text, text, text) to anon, authenticated;
revoke all on function public.app_cpe_create_portal_sync_job_from_saved(text) from public;
grant execute on function public.app_cpe_create_portal_sync_job_from_saved(text) to anon, authenticated;
revoke all on function public.app_cpe_create_portal_document_job(text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_create_portal_document_job(text, text) to service_role;
revoke all on function public.app_cpe_create_admin_portal_sync_jobs(text) from public, anon, authenticated;
grant execute on function public.app_cpe_create_admin_portal_sync_jobs(text) to service_role;
revoke all on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) from public, anon, authenticated;
grant execute on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) to service_role;
