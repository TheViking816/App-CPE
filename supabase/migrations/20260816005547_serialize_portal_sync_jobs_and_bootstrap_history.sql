create or replace function public.app_cpe_create_portal_sync_job(
  p_token text,
  p_portal_password text,
  p_security_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_user.chapa, 0)
  );

  select * into v_job
  from public.app_cpe_portal_sync_jobs
  where chapa = v_user.chapa
    and status in ('queued', 'running')
    and expires_at > now()
  order by requested_at desc
  limit 1;

  if v_job.id is not null then
    return jsonb_build_object(
      'ok', true,
      'jobId', v_job.id,
      'status', v_job.status,
      'requestedAt', v_job.requested_at,
      'reused', true
    );
  end if;

  delete from public.app_cpe_portal_sync_jobs
  where expires_at < now()
     or (chapa = v_user.chapa and status in ('completed', 'failed') and requested_at < now() - interval '1 hour');

  select case when exists (
    select 1
    from public.app_cpe_portal_snapshots snapshot
    where snapshot.chapa = v_user.chapa
      and (
        (jsonb_typeof(snapshot.payload #> '{jornales,rows}') = 'array'
          and jsonb_array_length(snapshot.payload #> '{jornales,rows}') > 0)
        or
        (jsonb_typeof(snapshot.payload #> '{jornales,history}') = 'array'
          and jsonb_array_length(snapshot.payload #> '{jornales,history}') > 0)
      )
  ) then 'snapshot' else 'history' end
  into v_request_kind;

  insert into public.app_cpe_portal_sync_jobs (
    chapa,
    portal_password,
    security_key,
    request_kind
  ) values (
    v_user.chapa,
    p_portal_password,
    nullif(p_security_key, ''),
    v_request_kind
  )
  returning * into v_job;

  if v_user.chapa <> '72683' then
    insert into public.app_cpe_usage_events (event_type, chapa, metadata)
    values (
      'portal_sync_started',
      v_user.chapa,
      jsonb_build_object(
        'job_id', v_job.id,
        'with_primas_key', nullif(p_security_key, '') is not null,
        'request_kind', v_request_kind
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'requestedAt', v_job.requested_at,
    'requestKind', v_request_kind,
    'reused', false
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
  v_request_kind text;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_user.chapa, 0)
  );

  select * into v_job
  from public.app_cpe_portal_sync_jobs
  where chapa = v_user.chapa
    and status in ('queued', 'running')
    and expires_at > now()
  order by requested_at desc
  limit 1;

  if v_job.id is not null then
    return jsonb_build_object(
      'ok', true,
      'jobId', v_job.id,
      'status', v_job.status,
      'requestedAt', v_job.requested_at,
      'reused', true
    );
  end if;

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

  select case when exists (
    select 1
    from public.app_cpe_portal_snapshots snapshot
    where snapshot.chapa = v_user.chapa
      and (
        (jsonb_typeof(snapshot.payload #> '{jornales,rows}') = 'array'
          and jsonb_array_length(snapshot.payload #> '{jornales,rows}') > 0)
        or
        (jsonb_typeof(snapshot.payload #> '{jornales,history}') = 'array'
          and jsonb_array_length(snapshot.payload #> '{jornales,history}') > 0)
      )
  ) then 'snapshot' else 'history' end
  into v_request_kind;

  insert into public.app_cpe_portal_sync_jobs (
    chapa,
    portal_password,
    security_key,
    trigger_source,
    request_kind,
    expires_at
  ) values (
    v_user.chapa,
    v_password,
    nullif(v_security_key, ''),
    'saved_credentials',
    v_request_kind,
    now() + interval '45 minutes'
  ) returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'requestedAt', v_job.requested_at,
    'requestKind', v_request_kind,
    'reused', false
  );
end;
$$;

revoke all on function public.app_cpe_create_portal_sync_job(text, text, text) from public;
grant execute on function public.app_cpe_create_portal_sync_job(text, text, text) to anon, authenticated;

revoke all on function public.app_cpe_create_portal_sync_job_from_saved(text) from public;
grant execute on function public.app_cpe_create_portal_sync_job_from_saved(text) to anon, authenticated;
