-- Keep credentials and snapshots. Only stop automatic portal reads after
-- seven days without a real (non-support) visit to App CPE.
create or replace function private.app_cpe_pause_inactive_portal_syncs()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_paused integer;
begin
  update public.app_cpe_portal_auto_sync c
  set sync_status = 'paused_inactive',
      paused_at = pg_catalog.now(),
      pause_reason = 'inactivity_7_days',
      updated_at = pg_catalog.now()
  where c.enabled
    and c.sync_status = 'active'
    and c.portal_password_secret_id is not null
    and (c.last_app_seen_at is null
      or c.last_app_seen_at < pg_catalog.now() - interval '7 days');
  get diagnostics v_paused = row_count;
  return v_paused;
end;
$$;

revoke all on function private.app_cpe_pause_inactive_portal_syncs() from public, anon, authenticated, service_role;

-- The desktop worker claims only users whose sync is currently eligible.
-- This also protects jobs that were already queued before the pause.
create or replace function public.app_cpe_claim_eligible_portal_sync_jobs(p_limit integer default 12)
returns setof public.app_cpe_portal_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.app_cpe_pause_inactive_portal_syncs();
  return query
  with candidates as (
    select j.id
    from public.app_cpe_portal_sync_jobs j
    join public.app_cpe_portal_auto_sync c on c.chapa = j.chapa
    where j.status = 'queued'
      and j.portal_password is not null
      and j.requested_at <= pg_catalog.now()
      and c.enabled
      and c.sync_status = 'active'
      and c.portal_password_secret_id is not null
      and c.last_app_seen_at >= pg_catalog.now() - interval '7 days'
    order by j.requested_at, j.id
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit, 12), 32))
  )
  update public.app_cpe_portal_sync_jobs j
  set status = 'running',
      started_at = pg_catalog.now(),
      expires_at = pg_catalog.now() + interval '12 hours',
      message = 'Lectura iniciada'
  from candidates
  where j.id = candidates.id
  returning j.*;
end;
$$;

revoke all on function public.app_cpe_claim_eligible_portal_sync_jobs(integer) from public, anon, authenticated;
grant execute on function public.app_cpe_claim_eligible_portal_sync_jobs(integer) to service_role;

create or replace function public.app_cpe_next_eligible_portal_sync_at()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select min(j.requested_at)
  from public.app_cpe_portal_sync_jobs j
  join public.app_cpe_portal_auto_sync c on c.chapa = j.chapa
  where j.status = 'queued'
    and j.portal_password is not null
    and c.enabled
    and c.sync_status = 'active'
    and c.portal_password_secret_id is not null
    and c.last_app_seen_at >= pg_catalog.now() - interval '7 days';
$$;

revoke all on function public.app_cpe_next_eligible_portal_sync_at() from public, anon, authenticated;
grant execute on function public.app_cpe_next_eligible_portal_sync_at() to service_role;

create or replace function public.app_cpe_create_worker_manual_jobs(p_full_history boolean default false)
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
  v_paused := private.app_cpe_pause_inactive_portal_syncs();

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
        v_config.chapa, v_password, v_security_key, 'worker_manual_all',
        v_request_kind, null,
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

create or replace function public.app_cpe_touch_portal_activity(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_is_support_session boolean := false;
  v_reactivation jsonb;
  v_has_running_or_queued boolean;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select coalesce(s.is_support, false) into v_is_support_session
  from public.app_cpe_sessions s
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now();

  if v_is_support_session then
    return jsonb_build_object(
      'ok', true, 'tracked', false, 'reason', 'support_session',
      'syncStatus', 'support_session', 'reactivated', false, 'refreshQueued', false
    );
  end if;

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa
  for update;

  if v_config.chapa is null then
    return jsonb_build_object(
      'ok', true, 'syncStatus', 'not_configured',
      'reactivated', false, 'refreshQueued', false
    );
  end if;

  if v_config.enabled
    and v_config.portal_password_secret_id is not null
    and v_config.sync_status in ('active', 'paused_inactive')
    and v_user.portal_activation_status = 'active'
    and (v_config.sync_status = 'paused_inactive'
      or v_config.last_app_seen_at is null
      or v_config.last_app_seen_at < now() - interval '7 days') then
    select exists (
      select 1 from public.app_cpe_portal_sync_jobs j
      where j.chapa = v_user.chapa
        and j.status in ('queued', 'running')
        and j.portal_password is not null
        and j.expires_at > now()
    ) into v_has_running_or_queued;

    if not v_has_running_or_queued then
      v_reactivation := public.app_cpe_reactivate_portal_sync(p_token);
      return jsonb_build_object(
        'ok', true, 'syncStatus', 'active', 'lastAppSeenAt', now(),
        'pausedAt', null, 'pauseReason', null,
        'reactivated', true, 'refreshQueued', true,
        'jobId', v_reactivation -> 'jobId',
        'requestKind', v_reactivation -> 'requestKind'
      );
    end if;

    update public.app_cpe_portal_auto_sync
    set sync_status = 'active', last_app_seen_at = now(),
        paused_at = null, pause_reason = null, updated_at = now()
    where chapa = v_user.chapa
    returning * into v_config;
  else
    update public.app_cpe_portal_auto_sync
    set last_app_seen_at = now(), updated_at = now()
    where chapa = v_user.chapa
    returning * into v_config;
  end if;

  return jsonb_build_object(
    'ok', true,
    'syncStatus', v_config.sync_status,
    'lastAppSeenAt', v_config.last_app_seen_at,
    'pausedAt', v_config.paused_at,
    'pauseReason', v_config.pause_reason,
    'reactivated', coalesce(v_has_running_or_queued, false),
    'refreshQueued', false,
    'jobId', null
  );
end;
$$;

revoke all on function public.app_cpe_touch_portal_activity(text) from public, anon, authenticated;
grant execute on function public.app_cpe_touch_portal_activity(text) to anon, authenticated;

-- Keep the table current even on days when no desktop worker is started.
select cron.schedule(
  'app-cpe-pause-inactive-portal-syncs',
  '13 * * * *',
  'select private.app_cpe_pause_inactive_portal_syncs()'
);

-- Apply the policy immediately to existing inactive users.
select private.app_cpe_pause_inactive_portal_syncs();
