-- Keep credentials and snapshots in place while excluding inactive accounts
-- from bulk portal reads. Usage events remain short-lived analytics; this row
-- stores the durable synchronization lifecycle.
alter table public.app_cpe_portal_auto_sync
  add column if not exists sync_status text not null default 'active',
  add column if not exists last_app_seen_at timestamptz not null default now(),
  add column if not exists paused_at timestamptz,
  add column if not exists pause_reason text;

alter table public.app_cpe_portal_auto_sync
  drop constraint if exists app_cpe_portal_auto_sync_status_check;

alter table public.app_cpe_portal_auto_sync
  add constraint app_cpe_portal_auto_sync_status_check
  check (sync_status in ('active', 'paused_inactive', 'credentials_error'));

update public.app_cpe_portal_auto_sync
set sync_status = case when enabled then 'active' else 'credentials_error' end,
    last_app_seen_at = coalesce(last_app_seen_at, now()),
    paused_at = null,
    pause_reason = case when enabled then null else 'credentials_error' end;

create index if not exists app_cpe_portal_auto_sync_activity_idx
  on public.app_cpe_portal_auto_sync (sync_status, last_app_seen_at)
  where enabled;

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
  elsif tg_op = 'INSERT'
    or not old.enabled
    or new.portal_password_secret_id is distinct from old.portal_password_secret_id then
    new.sync_status := 'active';
    new.last_app_seen_at := now();
    new.paused_at := null;
    new.pause_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_apply_portal_sync_lifecycle() from public, anon, authenticated, service_role;

drop trigger if exists app_cpe_apply_portal_sync_lifecycle on public.app_cpe_portal_auto_sync;
create trigger app_cpe_apply_portal_sync_lifecycle
before insert or update of enabled, portal_password_secret_id
on public.app_cpe_portal_auto_sync
for each row execute function private.app_cpe_apply_portal_sync_lifecycle();

create or replace function public.app_cpe_touch_portal_activity(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa
  for update;

  if v_config.chapa is null then
    return jsonb_build_object('ok', true, 'syncStatus', 'not_configured');
  end if;

  if v_config.enabled
    and v_config.sync_status = 'active'
    and v_user.portal_activation_status = 'active'
    and v_config.last_app_seen_at < now() - interval '7 days' then
    update public.app_cpe_portal_auto_sync
    set sync_status = 'paused_inactive',
        paused_at = now(),
        pause_reason = 'inactivity_7_days',
        last_app_seen_at = now(),
        updated_at = now()
    where chapa = v_user.chapa
    returning * into v_config;
  else
    update public.app_cpe_portal_auto_sync
    set last_app_seen_at = now()
    where chapa = v_user.chapa
    returning * into v_config;
  end if;

  return jsonb_build_object(
    'ok', true,
    'syncStatus', v_config.sync_status,
    'lastAppSeenAt', v_config.last_app_seen_at,
    'pausedAt', v_config.paused_at,
    'pauseReason', v_config.pause_reason
  );
end;
$$;

revoke all on function public.app_cpe_touch_portal_activity(text) from public, anon, authenticated;
grant execute on function public.app_cpe_touch_portal_activity(text) to anon, authenticated;

create or replace function public.app_cpe_get_portal_auto_sync_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
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
    'syncStatus', case when not coalesce(v_config.enabled, false) then 'credentials_error' else v_config.sync_status end,
    'hasSecurityKey', v_config.security_key_secret_id is not null,
    'lastAppSeenAt', v_config.last_app_seen_at,
    'pausedAt', v_config.paused_at,
    'pauseReason', v_config.pause_reason,
    'lastScheduledAt', v_config.last_scheduled_at,
    'lastSuccessAt', v_config.last_success_at,
    'updatedAt', v_config.updated_at
  );
end;
$$;

revoke all on function public.app_cpe_get_portal_auto_sync_status(text) from public, anon, authenticated;
grant execute on function public.app_cpe_get_portal_auto_sync_status(text) to anon, authenticated;

-- Adding the security key is the missing half of an initial load. Store it in
-- Vault and immediately promote the consolidated job to annual history.
create or replace function public.app_cpe_set_portal_security_key(
  p_token text,
  p_security_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_security_secret_id uuid;
  v_password text;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if length(trim(coalesce(p_security_key, ''))) < 1 then
    raise exception 'Introduce la clave de seguridad';
  end if;

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa and enabled
  for update;

  if v_config.portal_password_secret_id is null then
    raise exception 'Primero debes guardar la contrasena del portal';
  end if;

  if v_config.security_key_secret_id is null then
    v_security_secret_id := vault.create_secret(
      trim(p_security_key),
      'app_cpe_portal_security_' || v_user.chapa,
      'Clave de primas cifrada para la sincronizacion automatica de App CPE'
    );
  else
    v_security_secret_id := v_config.security_key_secret_id;
    perform vault.update_secret(v_security_secret_id, trim(p_security_key));
  end if;

  select decrypted_secret into v_password
  from vault.decrypted_secrets
  where id = v_config.portal_password_secret_id;
  if length(coalesce(v_password, '')) < 1 then
    raise exception 'No se pudo recuperar la contrasena guardada del portal';
  end if;

  update public.app_cpe_portal_auto_sync
  set security_key_secret_id = v_security_secret_id,
      enabled = true,
      sync_status = 'active',
      last_app_seen_at = now(),
      paused_at = null,
      pause_reason = null,
      updated_at = now()
  where chapa = v_user.chapa;

  v_job := private.app_cpe_queue_portal_sync_job(
    v_user.chapa,
    v_password,
    trim(p_security_key),
    'security_key_added',
    'history',
    null,
    now() + interval '30 days'
  );

  return jsonb_build_object(
    'ok', true,
    'hasSecurityKey', true,
    'requestKind', 'history',
    'jobId', v_job.id,
    'status', v_job.status,
    'updatedAt', now()
  );
end;
$$;

revoke all on function public.app_cpe_set_portal_security_key(text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_set_portal_security_key(text, text) to anon, authenticated;

create or replace function public.app_cpe_reactivate_portal_sync(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_snapshot jsonb;
  v_request_kind text := 'snapshot';
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa and enabled
  for update;

  if v_config.portal_password_secret_id is null then
    raise exception 'No hay credenciales del portal configuradas';
  end if;

  select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
  select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
  if length(coalesce(v_password, '')) < 1 then raise exception 'No se pudo recuperar la contrasena guardada'; end if;

  select payload into v_snapshot
  from public.app_cpe_portal_snapshots
  where chapa = v_user.chapa;

  if length(coalesce(v_security_key, '')) > 0 and (
    coalesce(v_snapshot #>> '{sync,fullHistoryCompletedAt}', '') = ''
    or jsonb_typeof(v_snapshot #> '{primas,history}') is distinct from 'array'
    or jsonb_array_length(case
      when jsonb_typeof(v_snapshot #> '{primas,history}') = 'array'
        then v_snapshot #> '{primas,history}'
      else '[]'::jsonb
    end) = 0
    or coalesce((v_snapshot #>> '{nominas,locked}')::boolean, true)
  ) then
    v_request_kind := 'history';
  end if;

  update public.app_cpe_portal_auto_sync
  set sync_status = 'active',
      last_app_seen_at = now(),
      paused_at = null,
      pause_reason = null,
      updated_at = now()
  where chapa = v_user.chapa;

  v_job := private.app_cpe_queue_portal_sync_job(
    v_user.chapa, v_password, v_security_key, 'reactivated', v_request_kind, null,
    case when v_request_kind = 'history' then now() + interval '30 days' else now() + interval '12 hours' end
  );

  return jsonb_build_object(
    'ok', true,
    'syncStatus', 'active',
    'requestKind', v_request_kind,
    'jobId', v_job.id,
    'status', v_job.status
  );
end;
$$;

revoke all on function public.app_cpe_reactivate_portal_sync(text) from public, anon, authenticated;
grant execute on function public.app_cpe_reactivate_portal_sync(text) to anon, authenticated;

-- Bulk desktop syncs pause accounts after seven days without opening the app
-- and never delete their credentials, snapshots or historical documents.
create or replace function public.app_cpe_create_worker_manual_jobs(
  p_full_history boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp
as $$
declare
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_request_kind text := case when p_full_history then 'history' else 'snapshot' end;
  v_job public.app_cpe_portal_sync_jobs;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_paused integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_portal_worker_manual_all', 0));

  update public.app_cpe_portal_auto_sync config
  set sync_status = 'paused_inactive',
      paused_at = now(),
      pause_reason = 'inactivity_7_days',
      updated_at = now()
  from public.app_cpe_users users
  where users.chapa = config.chapa
    and users.portal_activation_status = 'active'
    and config.enabled
    and config.sync_status = 'active'
    and config.last_app_seen_at < now() - interval '7 days';
  get diagnostics v_paused = row_count;

  update public.app_cpe_portal_sync_jobs
  set status = 'failed', message = 'Trabajo anterior recuperado sin credenciales', finished_at = now()
  where status = 'running' and portal_password is null;

  for v_config in
    select config.*
    from public.app_cpe_portal_auto_sync config
    where config.enabled
      and config.sync_status = 'active'
      and config.portal_password_secret_id is not null
    order by config.chapa
  loop
    if p_full_history then
      update public.app_cpe_portal_sync_jobs
      set request_kind = 'history', trigger_source = 'worker_manual_all',
          message = 'Carga completa anual en cola', expires_at = now() + interval '30 days'
      where chapa = v_config.chapa and status = 'queued'
        and portal_password is not null and expires_at > now();
      if found then v_queued := v_queued + 1; continue; end if;
    end if;

    if exists (
      select 1 from public.app_cpe_portal_sync_jobs
      where chapa = v_config.chapa and status in ('queued', 'running')
        and portal_password is not null and expires_at > now()
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
      select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
      if length(coalesce(v_password, '')) < 1 then v_skipped := v_skipped + 1; continue; end if;

      v_job := private.app_cpe_queue_portal_sync_job(
        v_config.chapa, v_password, v_security_key, 'worker_manual_all', v_request_kind, null,
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
    'skipped', v_skipped,
    'paused', v_paused
  );
end;
$$;

revoke all on function public.app_cpe_create_worker_manual_jobs(boolean) from public, anon, authenticated;
grant execute on function public.app_cpe_create_worker_manual_jobs(boolean) to service_role;

create or replace function public.app_cpe_admin_portal_sync_users(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_users jsonb;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'chapa', users.chapa,
    'email', users.email,
    'activationStatus', users.portal_activation_status,
    'syncStatus', case when not coalesce(config.enabled, false) then 'credentials_error' else config.sync_status end,
    'lastAppSeenAt', config.last_app_seen_at,
    'pausedAt', config.paused_at,
    'pauseReason', config.pause_reason,
    'hasCredentials', coalesce(config.enabled, false) and config.portal_password_secret_id is not null,
    'hasSecurityKey', config.security_key_secret_id is not null,
    'hasPremiumHistory', coalesce(jsonb_array_length(case when jsonb_typeof(snapshot.payload #> '{primas,history}') = 'array' then snapshot.payload #> '{primas,history}' else '[]'::jsonb end), 0) > 0,
    'premiumHistoryMonths', coalesce(jsonb_array_length(case when jsonb_typeof(snapshot.payload #> '{primas,history}') = 'array' then snapshot.payload #> '{primas,history}' else '[]'::jsonb end), 0),
    'fullHistoryCompletedAt', snapshot.payload #>> '{sync,fullHistoryCompletedAt}',
    'lastSuccessAt', config.last_success_at,
    'jobStatus', jobs.status,
    'jobMessage', jobs.message,
    'triggerSource', jobs.trigger_source,
    'requestKind', jobs.request_kind,
    'requestedAt', jobs.requested_at,
    'startedAt', jobs.started_at,
    'finishedAt', jobs.finished_at
  ) order by
    case when users.portal_activation_status = 'pending' then 0
      when config.sync_status = 'paused_inactive' then 1
      when jobs.status = 'failed' then 2
      when jobs.status in ('queued', 'running') then 3 else 4 end,
    users.chapa), '[]'::jsonb)
  into v_users
  from public.app_cpe_users users
  left join public.app_cpe_portal_auto_sync config on config.chapa = users.chapa
  left join public.app_cpe_portal_sync_jobs jobs on jobs.chapa = users.chapa
  left join public.app_cpe_portal_snapshots snapshot on snapshot.chapa = users.chapa
  where users.chapa <> v_admin.chapa
    and (config.chapa is not null or users.portal_activation_status = 'pending');

  return jsonb_build_object('ok', true, 'users', v_users, 'generatedAt', now());
end;
$$;

revoke all on function public.app_cpe_admin_portal_sync_users(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_portal_sync_users(text) to anon, authenticated;
