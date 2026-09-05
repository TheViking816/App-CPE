create or replace function public.app_cpe_retry_failed_portal_sync_job(
  p_chapa text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_job public.app_cpe_portal_sync_jobs;
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_retry_count integer;
  v_new_job public.app_cpe_portal_sync_jobs;
begin
  select * into v_job
  from public.app_cpe_portal_sync_jobs
  where id = p_job_id and chapa = p_chapa and status = 'failed'
  for update;
  if v_job.id is null then return jsonb_build_object('ok', false, 'reason', 'job_not_failed'); end if;
  if coalesce(v_job.retry_count, 0) >= 1 then
    return jsonb_build_object('ok', false, 'reason', 'retry_limit_reached');
  end if;
  if coalesce(v_job.message, '') ~* 'usuario[[:space:]]+o[[:space:]]+contrase[nñ]a[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos'
    or coalesce(v_job.message, '') ~* 'claves[[:space:]]+del[[:space:]]+portal.*pendientes[[:space:]]+de[[:space:]]+correcci[oó]n' then
    return jsonb_build_object('ok', false, 'reason', 'credentials_rejected');
  end if;

  select * into v_config from public.app_cpe_portal_auto_sync
  where chapa = p_chapa and enabled;
  if v_config.chapa is null or coalesce(v_config.sync_status, 'active') <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'sync_paused');
  end if;
  if v_config.portal_password_secret_id is null then
    return jsonb_build_object('ok', false, 'reason', 'credentials_unavailable');
  end if;
  select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
  select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
  if length(coalesce(v_password, '')) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'credentials_unavailable');
  end if;

  v_retry_count := coalesce(v_job.retry_count, 0) + 1;
  v_new_job := private.app_cpe_queue_portal_sync_job(
    p_chapa, v_password, v_security_key, 'worker_retry_2m',
    coalesce(v_job.request_kind, 'snapshot'), v_job.document_id,
    now() + interval '45 minutes', v_job.schedule_slot
  );
  update public.app_cpe_portal_sync_jobs
  set requested_at = now() + interval '2 minutes',
      message = 'Reintento automático programado para dentro de 2 minutos',
      retry_count = v_retry_count
  where id = v_new_job.id;
  return jsonb_build_object('ok', true, 'jobId', v_new_job.id, 'retryCount', v_retry_count);
end;
$$;

revoke all on function public.app_cpe_retry_failed_portal_sync_job(text, uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_retry_failed_portal_sync_job(text, uuid) to service_role;

-- Repair configurations whose rejected-credential job was rewritten by the
-- legacy retry path before the rejection trigger could retain the state.
update public.app_cpe_portal_auto_sync config
set sync_status = 'credentials_error',
    paused_at = coalesce(config.paused_at, now()),
    pause_reason = 'credentials_error',
    updated_at = now()
where exists (
  select 1
  from public.app_cpe_portal_sync_jobs job
  where job.chapa = config.chapa
    and job.status = 'failed'
    and job.message ~* 'claves[[:space:]]+del[[:space:]]+portal.*pendientes[[:space:]]+de[[:space:]]+correcci[oó]n'
);
