-- A rejected portal password is a durable quarantine state. Keep the account,
-- Vault secrets, snapshot and failed job for audit, but exclude it from every
-- bulk read until a replacement password completes one full history load.

create or replace function private.app_cpe_retire_rejected_portal_credentials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
begin
  if new.status = 'failed'
    and coalesce(new.message, '') ~* 'usuario[[:space:]]+o[[:space:]]+contrase[nñ]a[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos' then
    update public.app_cpe_portal_auto_sync
    set enabled = false,
        sync_status = 'credentials_error',
        paused_at = coalesce(paused_at, pg_catalog.now()),
        pause_reason = 'credentials_error',
        updated_at = pg_catalog.now()
    where chapa = new.chapa;

    update public.app_cpe_users
    set portal_activation_status = 'pending',
        portal_activated_at = null,
        updated_at = pg_catalog.now()
    where chapa = new.chapa
    returning * into v_user;

    if v_user.id is not null and v_user.email is not null then
      insert into public.app_cpe_activation_email_outbox (
        user_id, kind, recipient, chapa, status, attempts, last_error, sent_at, created_at
      ) values (
        v_user.id, 'portal_credentials_rejected', v_user.email, v_user.chapa,
        'pending', 0, null, null, pg_catalog.now()
      )
      on conflict (user_id, kind) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_retire_rejected_portal_credentials()
from public, anon, authenticated, service_role;

drop trigger if exists app_cpe_retire_rejected_portal_credentials
on public.app_cpe_portal_sync_jobs;

create trigger app_cpe_retire_rejected_portal_credentials
after update of status, message on public.app_cpe_portal_sync_jobs
for each row execute function private.app_cpe_retire_rejected_portal_credentials();

-- Quarantined credentials cannot enter the worker again. The sole exception is
-- the full-history job created after the owner explicitly replaces the key.
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
set search_path = ''
as $$
declare
  v_job public.app_cpe_portal_sync_jobs;
begin
  if exists (
    select 1
    from public.app_cpe_portal_auto_sync config
    where config.chapa = p_chapa
      and config.sync_status = 'credentials_error'
  ) and not (
    p_trigger_source = 'credentials_corrected'
    and p_request_kind = 'history'
  ) then
    raise exception 'Sincronización bloqueada: el usuario debe cambiar la contraseña del portal';
  end if;

  insert into public.app_cpe_portal_sync_jobs (
    chapa, portal_password, security_key, status, message,
    requested_at, started_at, finished_at, expires_at, created_at,
    trigger_source, schedule_slot, request_kind, document_id, retry_count
  ) values (
    p_chapa, p_portal_password, nullif(p_security_key, ''), 'queued', null,
    pg_catalog.now(), null, null, p_expires_at, pg_catalog.now(),
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

revoke all on function private.app_cpe_queue_portal_sync_job(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;

-- Saving a replacement password queues exactly one history validation. The
-- configuration remains quarantined until that job succeeds, so bulk worker
-- runs cannot pick it up in the meantime.
create or replace function public.app_cpe_set_portal_auto_sync(
  p_token text,
  p_enabled boolean,
  p_portal_password text default '',
  p_security_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password_secret_id uuid;
  v_security_secret_id uuid;
  v_password_secret_name text;
  v_security_secret_name text;
  v_security_key text;
  v_was_credentials_error boolean := false;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_password_secret_name := 'app_cpe_portal_password_' || v_user.chapa;
  v_security_secret_name := 'app_cpe_portal_security_' || v_user.chapa;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_cpe_portal_auto_sync:' || v_user.chapa, 0)
  );

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa
  for update;

  v_was_credentials_error := v_config.chapa is not null and (
    not coalesce(v_config.enabled, false)
    or coalesce(v_config.sync_status, 'credentials_error') = 'credentials_error'
  );

  if not coalesce(p_enabled, false) then
    delete from vault.secrets
    where id = v_config.portal_password_secret_id
       or id = v_config.security_key_secret_id
       or name = v_password_secret_name
       or name = v_security_secret_name;

    delete from public.app_cpe_portal_auto_sync where chapa = v_user.chapa;
    return jsonb_build_object('ok', true, 'enabled', false);
  end if;

  if length(trim(coalesce(p_portal_password, ''))) < 1 then
    raise exception 'Introduce la contrasena del portal para activar la sincronizacion automatica';
  end if;

  select id into v_password_secret_id
  from vault.secrets
  where id = v_config.portal_password_secret_id;

  if v_password_secret_id is null then
    select id into v_password_secret_id
    from vault.secrets
    where name = v_password_secret_name;
  end if;

  if v_password_secret_id is null then
    v_password_secret_id := vault.create_secret(
      trim(p_portal_password),
      v_password_secret_name,
      'Credencial cifrada para la sincronizacion automatica de App CPE'
    );
  else
    perform vault.update_secret(v_password_secret_id, trim(p_portal_password));
  end if;

  select id into v_security_secret_id
  from vault.secrets
  where id = v_config.security_key_secret_id;

  if v_security_secret_id is null then
    select id into v_security_secret_id
    from vault.secrets
    where name = v_security_secret_name;
  end if;

  if length(trim(coalesce(p_security_key, ''))) > 0 then
    v_security_key := trim(p_security_key);
    if v_security_secret_id is null then
      v_security_secret_id := vault.create_secret(
        v_security_key,
        v_security_secret_name,
        'Clave de primas cifrada para la sincronizacion automatica de App CPE'
      );
    else
      perform vault.update_secret(v_security_secret_id, v_security_key);
    end if;
  elsif v_security_secret_id is not null then
    select decrypted_secret into v_security_key
    from vault.decrypted_secrets
    where id = v_security_secret_id;
  end if;

  insert into public.app_cpe_portal_auto_sync (
    chapa, portal_password_secret_id, security_key_secret_id, enabled,
    sync_status, paused_at, pause_reason, last_app_seen_at, updated_at
  ) values (
    v_user.chapa, v_password_secret_id, v_security_secret_id,
    not v_was_credentials_error,
    case when v_was_credentials_error then 'credentials_error' else 'active' end,
    case when v_was_credentials_error then pg_catalog.now() else null end,
    case when v_was_credentials_error then 'credentials_validation' else null end,
    pg_catalog.now(), pg_catalog.now()
  )
  on conflict (chapa) do update set
    portal_password_secret_id = excluded.portal_password_secret_id,
    security_key_secret_id = excluded.security_key_secret_id,
    enabled = excluded.enabled,
    sync_status = excluded.sync_status,
    paused_at = excluded.paused_at,
    pause_reason = excluded.pause_reason,
    last_app_seen_at = excluded.last_app_seen_at,
    updated_at = pg_catalog.now();

  if v_was_credentials_error then
    v_job := private.app_cpe_queue_portal_sync_job(
      v_user.chapa,
      trim(p_portal_password),
      v_security_key,
      'credentials_corrected',
      'history',
      null,
      pg_catalog.now() + interval '30 days'
    );

    return jsonb_build_object(
      'ok', true,
      'enabled', false,
      'validationPending', true,
      'requestKind', 'history',
      'jobId', v_job.id,
      'status', v_job.status,
      'updatedAt', pg_catalog.now()
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'enabled', true,
    'validationPending', false,
    'updatedAt', pg_catalog.now()
  );
end;
$$;

revoke all on function public.app_cpe_set_portal_auto_sync(text, boolean, text, text)
from public, anon, authenticated;
grant execute on function public.app_cpe_set_portal_auto_sync(text, boolean, text, text)
to anon, authenticated;

-- Successful validation is the only transition out of quarantine.
create or replace function public.app_cpe_update_auto_sync_success()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    if new.trigger_source = 'scheduled' then
      update public.app_cpe_portal_auto_sync
      set last_success_at = coalesce(new.finished_at, pg_catalog.now()),
          updated_at = pg_catalog.now()
      where chapa = new.chapa;
    elsif new.trigger_source = 'credentials_corrected'
      and new.request_kind = 'history' then
      update public.app_cpe_portal_auto_sync
      set enabled = true,
          sync_status = 'active',
          paused_at = null,
          pause_reason = null,
          last_success_at = coalesce(new.finished_at, pg_catalog.now()),
          updated_at = pg_catalog.now()
      where chapa = new.chapa;

      update public.app_cpe_users
      set portal_activation_status = 'active',
          portal_activated_at = coalesce(portal_activated_at, pg_catalog.now()),
          updated_at = pg_catalog.now()
      where chapa = new.chapa;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.app_cpe_update_auto_sync_success()
from public, anon, authenticated, service_role;

-- Repair accounts missed by the previous accent-sensitive expression.
update public.app_cpe_portal_auto_sync config
set enabled = false,
    sync_status = 'credentials_error',
    paused_at = coalesce(config.paused_at, pg_catalog.now()),
    pause_reason = 'credentials_error',
    updated_at = pg_catalog.now()
where exists (
  select 1
  from public.app_cpe_portal_sync_jobs job
  where job.chapa = config.chapa
    and job.status = 'failed'
    and coalesce(job.message, '') ~* 'usuario[[:space:]]+o[[:space:]]+contrase[nñ]a[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos'
);

update public.app_cpe_users users
set portal_activation_status = 'pending',
    portal_activated_at = null,
    updated_at = pg_catalog.now()
where exists (
  select 1
  from public.app_cpe_portal_sync_jobs job
  where job.chapa = users.chapa
    and job.status = 'failed'
    and coalesce(job.message, '') ~* 'usuario[[:space:]]+o[[:space:]]+contrase[nñ]a[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos'
);
