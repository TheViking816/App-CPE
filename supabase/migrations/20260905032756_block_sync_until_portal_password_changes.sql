-- Keep rejected credentials stored and visible, but prevent every queue path
-- from retrying them until the owner explicitly saves a password again.
create or replace function private.app_cpe_apply_portal_sync_lifecycle()
returns trigger
language plpgsql
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if not new.enabled then
    new.sync_status := 'credentials_error';
    new.paused_at := coalesce(new.paused_at, now());
    new.pause_reason := 'credentials_error';
  elsif tg_op = 'INSERT' or not old.enabled then
    new.sync_status := 'active';
    new.last_app_seen_at := now();
    new.paused_at := null;
    new.pause_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_apply_portal_sync_lifecycle()
from public, anon, authenticated, service_role;

drop trigger if exists app_cpe_apply_portal_sync_lifecycle
on public.app_cpe_portal_auto_sync;

create trigger app_cpe_apply_portal_sync_lifecycle
before insert or update of enabled
on public.app_cpe_portal_auto_sync
for each row execute function private.app_cpe_apply_portal_sync_lifecycle();

create or replace function private.app_cpe_activate_changed_portal_password()
returns trigger
language plpgsql
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if new.portal_password_secret_id is not null then
    new.enabled := true;
    new.sync_status := 'active';
    new.last_app_seen_at := now();
    new.paused_at := null;
    new.pause_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_activate_changed_portal_password()
from public, anon, authenticated, service_role;

drop trigger if exists app_cpe_activate_changed_portal_password
on public.app_cpe_portal_auto_sync;

create trigger app_cpe_activate_changed_portal_password
before update of portal_password_secret_id
on public.app_cpe_portal_auto_sync
for each row execute function private.app_cpe_activate_changed_portal_password();

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
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_job public.app_cpe_portal_sync_jobs;
begin
  if exists (
    select 1
    from public.app_cpe_portal_auto_sync config
    where config.chapa = p_chapa
      and config.sync_status = 'credentials_error'
  ) then
    raise exception 'Sincronización bloqueada: el usuario debe cambiar la contraseña del portal';
  end if;

  insert into public.app_cpe_portal_sync_jobs (
    chapa, portal_password, security_key, status, message,
    requested_at, started_at, finished_at, expires_at, created_at,
    trigger_source, schedule_slot, request_kind, document_id, retry_count
  ) values (
    p_chapa, p_portal_password, nullif(p_security_key, ''), 'queued', null,
    now(), null, null, p_expires_at, now(),
    p_trigger_source, p_schedule_slot, p_request_kind, p_document_id, 0
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
    document_id = excluded.document_id,
    retry_count = 0
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function private.app_cpe_queue_portal_sync_job(text, text, text, text, text, text, timestamptz, text)
from public, anon, authenticated, service_role;

-- There must not be a queued/running job left for an already rejected key.
update public.app_cpe_portal_sync_jobs jobs
set status = 'failed',
    message = 'Sincronización bloqueada: el usuario debe cambiar la contraseña del portal',
    finished_at = now()
from public.app_cpe_portal_auto_sync config
where config.chapa = jobs.chapa
  and config.sync_status = 'credentials_error'
  and jobs.status in ('queued', 'running');
