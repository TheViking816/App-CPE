-- Opening the app only records activity for active accounts. A portal read is
-- queued exclusively when an account returns after being paused for seven days.
create or replace function public.app_cpe_touch_portal_activity(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_job public.app_cpe_portal_sync_jobs;
  v_was_inactive boolean := false;
  v_refresh_queued boolean := false;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa
  for update;

  if v_config.chapa is null then
    return jsonb_build_object(
      'ok', true,
      'syncStatus', 'not_configured',
      'reactivated', false,
      'refreshQueued', false
    );
  end if;

  v_was_inactive := v_config.enabled
    and v_user.portal_activation_status = 'active'
    and (
      v_config.sync_status = 'paused_inactive'
      or (
        v_config.sync_status = 'active'
        and v_config.last_app_seen_at < now() - interval '7 days'
      )
    );

  if v_was_inactive then
    update public.app_cpe_portal_auto_sync
    set sync_status = 'active',
        last_app_seen_at = now(),
        paused_at = null,
        pause_reason = null,
        updated_at = now()
    where chapa = v_user.chapa
    returning * into v_config;

    if v_config.portal_password_secret_id is not null
      and not exists (
        select 1
        from public.app_cpe_portal_sync_jobs
        where chapa = v_user.chapa
          and status in ('queued', 'running')
          and expires_at > now()
      ) then
      select decrypted_secret into v_password
      from vault.decrypted_secrets
      where id = v_config.portal_password_secret_id;

      select decrypted_secret into v_security_key
      from vault.decrypted_secrets
      where id = v_config.security_key_secret_id;

      if length(coalesce(v_password, '')) > 0 then
        v_job := private.app_cpe_queue_portal_sync_job(
          v_user.chapa,
          v_password,
          v_security_key,
          'app_activity_reactivated',
          'snapshot',
          null,
          now() + interval '12 hours'
        );
        v_refresh_queued := true;
      end if;
    end if;
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
    'pauseReason', v_config.pause_reason,
    'reactivated', v_was_inactive,
    'refreshQueued', v_refresh_queued,
    'jobId', case when v_refresh_queued then v_job.id else null end
  );
end;
$$;

revoke all on function public.app_cpe_touch_portal_activity(text) from public, anon, authenticated;
grant execute on function public.app_cpe_touch_portal_activity(text) to anon, authenticated;

-- A new logical job reuses the per-user queue row, so retry_count must not leak
-- from a previous failed execution.
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
  from public, anon, authenticated;
