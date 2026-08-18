-- Accounts created before the activation flow inherited the old `active`
-- default. Move only untouched legacy accounts into the real onboarding flow.
update public.app_cpe_users users
set portal_activation_status = 'pending',
    portal_activated_at = null,
    updated_at = now()
where users.chapa <> '72683'
  and users.portal_activation_status = 'active'
  and users.portal_activated_at is null
  and users.created_at < timestamptz '2026-08-18 12:10:38+00'
  and not exists (
    select 1
    from public.app_cpe_portal_snapshots snapshot
    where snapshot.chapa = users.chapa
      and snapshot.payload is not null
  );

create or replace function public.app_cpe_update_activation_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.portal_activation_status <> 'pending' then
    raise exception 'La cuenta ya está activada';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Introduce un correo electrónico válido';
  end if;

  update public.app_cpe_users
  set email = v_email, updated_at = now()
  where id = v_user.id
  returning * into v_updated;

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

create or replace function public.app_cpe_admin_portal_sync_users(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_users jsonb;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'chapa', users.chapa,
      'email', users.email,
      'activationStatus', users.portal_activation_status,
      'hasCredentials', coalesce(config.enabled, false) and config.portal_password_secret_id is not null,
      'hasSecurityKey', config.security_key_secret_id is not null,
      'lastSuccessAt', config.last_success_at,
      'jobStatus', jobs.status,
      'jobMessage', jobs.message,
      'triggerSource', jobs.trigger_source,
      'requestKind', jobs.request_kind,
      'requestedAt', jobs.requested_at,
      'startedAt', jobs.started_at,
      'finishedAt', jobs.finished_at
    ) order by
      case
        when users.portal_activation_status = 'pending' then 0
        when jobs.status = 'failed' then 1
        when jobs.status in ('queued', 'running') then 2
        else 3
      end,
      users.chapa
  ), '[]'::jsonb)
  into v_users
  from public.app_cpe_users users
  left join public.app_cpe_portal_auto_sync config on config.chapa = users.chapa
  left join public.app_cpe_portal_sync_jobs jobs on jobs.chapa = users.chapa
  where users.chapa <> v_admin.chapa;

  return jsonb_build_object('ok', true, 'users', v_users, 'generatedAt', now());
end;
$$;

create or replace function public.app_cpe_admin_queue_portal_sync_users(
  p_token text,
  p_chapas text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_chapa text;
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_existing public.app_cpe_portal_sync_jobs;
  v_job public.app_cpe_portal_sync_jobs;
  v_password text;
  v_security_key text;
  v_request_kind text;
  v_results jsonb := '[]'::jsonb;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;
  if coalesce(cardinality(p_chapas), 0) < 1 then
    raise exception 'Selecciona al menos una chapa';
  end if;
  if cardinality(p_chapas) > 100 then
    raise exception 'Solo se pueden seleccionar 100 chapas cada vez';
  end if;

  for v_chapa in
    select distinct public.app_cpe_normalize_chapa(value)
    from unnest(p_chapas) selected(value)
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_chapa, 0)
    );

    select * into v_user from public.app_cpe_users where chapa = v_chapa;
    if v_user.id is null then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'skipped', 'reason', 'Usuario no encontrado'));
      continue;
    end if;

    select * into v_config
    from public.app_cpe_portal_auto_sync
    where chapa = v_chapa and enabled;
    if v_config.portal_password_secret_id is null then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'skipped', 'reason', 'No tiene claves guardadas'));
      continue;
    end if;

    select * into v_existing
    from public.app_cpe_portal_sync_jobs
    where chapa = v_chapa;
    if v_existing.status in ('queued', 'running') and v_existing.expires_at > now() then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'skipped', 'reason', case when v_existing.status = 'running' then 'Ya se está ejecutando' else 'Ya está en cola' end));
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
        raise exception 'No se pudo recuperar la contraseña guardada';
      end if;

      select case when v_user.portal_activation_status = 'pending' or not exists (
        select 1
        from public.app_cpe_portal_snapshots snapshot
        where snapshot.chapa = v_chapa
          and (
            (jsonb_typeof(snapshot.payload #> '{jornales,rows}') = 'array'
              and jsonb_array_length(snapshot.payload #> '{jornales,rows}') > 0)
            or
            (jsonb_typeof(snapshot.payload #> '{jornales,history}') = 'array'
              and jsonb_array_length(snapshot.payload #> '{jornales,history}') > 0)
          )
      ) then 'history' else 'snapshot' end
      into v_request_kind;

      v_job := private.app_cpe_queue_portal_sync_job(
        v_chapa,
        v_password,
        v_security_key,
        'admin_selected',
        v_request_kind,
        null,
        case when v_user.portal_activation_status = 'pending' then now() + interval '30 days' else now() + interval '12 hours' end
      );
      v_queued := v_queued + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'queued', 'jobId', v_job.id, 'requestKind', v_request_kind));
    exception when others then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'skipped', 'reason', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ok', true, 'queued', v_queued, 'skipped', v_skipped, 'results', v_results);
end;
$$;

revoke all on function public.app_cpe_admin_portal_sync_users(text) from public, anon, authenticated;
revoke all on function public.app_cpe_admin_queue_portal_sync_users(text, text[]) from public, anon, authenticated;
revoke all on function public.app_cpe_update_activation_email(text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_portal_sync_users(text) to anon, authenticated;
grant execute on function public.app_cpe_admin_queue_portal_sync_users(text, text[]) to anon, authenticated;
grant execute on function public.app_cpe_update_activation_email(text, text) to anon, authenticated;
