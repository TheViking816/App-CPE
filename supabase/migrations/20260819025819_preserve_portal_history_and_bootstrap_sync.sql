-- Portal reads are partial by design. Preserve previously committed sections and
-- merge month histories atomically so a progress update or a failed reader can
-- never erase earlier months.
create or replace function private.app_cpe_merge_portal_period_section(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_result jsonb;
  v_history jsonb;
begin
  if p_incoming is null then return p_existing; end if;
  if p_existing is null then return p_incoming; end if;

  -- A missing security key is not a new value and must not replace saved data.
  if coalesce((p_incoming ->> 'locked')::boolean, false)
    and not coalesce((p_existing ->> 'locked')::boolean, false) then
    return p_existing;
  end if;

  v_result := p_existing || p_incoming;
  with candidates as (
    select value as period, 0 as priority
    from jsonb_array_elements(
      case when jsonb_typeof(p_existing -> 'history') = 'array'
        then p_existing -> 'history' else '[]'::jsonb end
    )
    union all
    select value as period, 1 as priority
    from jsonb_array_elements(
      case when jsonb_typeof(p_incoming -> 'history') = 'array'
        then p_incoming -> 'history' else '[]'::jsonb end
    )
  ), normalized as (
    select period, priority,
      coalesce(nullif(period ->> 'year', ''), nullif(p_incoming ->> 'year', ''), nullif(p_existing ->> 'year', ''), '0') as period_year,
      coalesce(nullif(period ->> 'month', ''), '0') as period_month
    from candidates
    where jsonb_typeof(period) = 'object'
  ), deduplicated as (
    select distinct on (period_year, period_month)
      period, period_year, period_month
    from normalized
    order by period_year, period_month, priority desc
  )
  select coalesce(jsonb_agg(period order by
    case when period_year ~ '^[0-9]+$' then period_year::integer else 0 end,
    case when period_month ~ '^[0-9]+$' then period_month::integer else 0 end
  ), '[]'::jsonb)
  into v_history
  from deduplicated;

  if jsonb_array_length(v_history) > 0 then
    v_result := jsonb_set(v_result, '{history}', v_history, true);
  end if;
  return v_result;
end;
$$;

create or replace function private.app_cpe_preserve_portal_snapshot_payload(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, private, pg_catalog, pg_temp
as $$
declare
  v_result jsonb := coalesce(p_existing, '{}'::jsonb) || coalesce(p_incoming, '{}'::jsonb);
begin
  if p_existing is null then return p_incoming; end if;
  if p_incoming is null then return p_existing; end if;

  if p_existing -> 'jornales' is not null or p_incoming -> 'jornales' is not null then
    v_result := jsonb_set(v_result, '{jornales}', private.app_cpe_merge_portal_period_section(p_existing -> 'jornales', p_incoming -> 'jornales'), true);
  end if;
  if p_existing -> 'primas' is not null or p_incoming -> 'primas' is not null then
    v_result := jsonb_set(v_result, '{primas}', private.app_cpe_merge_portal_period_section(p_existing -> 'primas', p_incoming -> 'primas'), true);
  end if;

  if p_existing -> 'nominas' is not null and (
    p_incoming -> 'nominas' is null
    or coalesce((p_incoming #>> '{nominas,locked}')::boolean, false)
  ) then
    v_result := jsonb_set(v_result, '{nominas}', p_existing -> 'nominas', true);
  end if;

  if p_existing -> 'sync' is not null or p_incoming -> 'sync' is not null then
    v_result := jsonb_set(
      v_result,
      '{sync}',
      coalesce(p_existing -> 'sync', '{}'::jsonb) || coalesce(p_incoming -> 'sync', '{}'::jsonb),
      true
    );
  end if;
  return v_result;
end;
$$;

create or replace function private.app_cpe_preserve_portal_snapshot_trigger()
returns trigger
language plpgsql
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.payload := private.app_cpe_preserve_portal_snapshot_payload(old.payload, new.payload);
  end if;
  return new;
end;
$$;

drop trigger if exists app_cpe_preserve_portal_snapshot_history on public.app_cpe_portal_snapshots;
create trigger app_cpe_preserve_portal_snapshot_history
before update of payload on public.app_cpe_portal_snapshots
for each row execute function private.app_cpe_preserve_portal_snapshot_trigger();

drop trigger if exists app_cpe_preserve_portal_preview_history on public.app_cpe_portal_preview_snapshots;
create trigger app_cpe_preserve_portal_preview_history
before update of payload on public.app_cpe_portal_preview_snapshots
for each row execute function private.app_cpe_preserve_portal_snapshot_trigger();

-- Recover any useful history still present in development preview snapshots.
with preview_histories as (
  select
    preview.chapa,
    preview.payload #> '{primas,history}' as history,
    row_number() over (
      partition by preview.chapa
      order by jsonb_array_length(preview.payload #> '{primas,history}') desc
    ) as position
  from public.app_cpe_portal_preview_snapshots preview
  where jsonb_typeof(preview.payload #> '{primas,history}') = 'array'
    and jsonb_array_length(preview.payload #> '{primas,history}') > 0
)
update public.app_cpe_portal_snapshots main
set payload = jsonb_set(
  main.payload,
  '{primas}',
  coalesce(main.payload -> 'primas', '{}'::jsonb) || jsonb_build_object('history', recovered.history),
  true
)
from preview_histories recovered
where recovered.chapa = main.chapa
  and recovered.position = 1
  and main.payload is not null
  and not (
    jsonb_typeof(main.payload #> '{primas,history}') = 'array'
    and jsonb_array_length(main.payload #> '{primas,history}') > 0
  );

-- The Monitor offers two explicit operations: current-month refresh and the
-- full first load (annual history plus payroll documents).
drop function if exists public.app_cpe_admin_queue_portal_sync_users(text, text[]);
create function public.app_cpe_admin_queue_portal_sync_users(
  p_token text,
  p_chapas text[],
  p_full_history boolean default false
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
  if coalesce(cardinality(p_chapas), 0) < 1 then raise exception 'Selecciona al menos una chapa'; end if;
  if cardinality(p_chapas) > 100 then raise exception 'Solo se pueden seleccionar 100 chapas cada vez'; end if;

  for v_chapa in
    select distinct public.app_cpe_normalize_chapa(value)
    from unnest(p_chapas) selected(value)
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_portal_sync_job:' || v_chapa, 0));
    select * into v_user from public.app_cpe_users where chapa = v_chapa;
    if v_user.id is null then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'skipped', 'reason', 'Usuario no encontrado'));
      continue;
    end if;

    select * into v_config from public.app_cpe_portal_auto_sync where chapa = v_chapa and enabled;
    if v_config.portal_password_secret_id is null then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'skipped', 'reason', 'No tiene claves guardadas'));
      continue;
    end if;

    select * into v_existing from public.app_cpe_portal_sync_jobs where chapa = v_chapa;
    if v_existing.status in ('queued', 'running') and v_existing.expires_at > now() then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('chapa', v_chapa, 'action', 'skipped', 'reason', case when v_existing.status = 'running' then 'Ya se está ejecutando' else 'Ya está en cola' end));
      continue;
    end if;

    begin
      select decrypted_secret into v_password from vault.decrypted_secrets where id = v_config.portal_password_secret_id;
      select decrypted_secret into v_security_key from vault.decrypted_secrets where id = v_config.security_key_secret_id;
      if length(coalesce(v_password, '')) < 1 then raise exception 'No se pudo recuperar la contraseña guardada'; end if;

      v_request_kind := case
        when p_full_history or v_user.portal_activation_status = 'pending' then 'history'
        when not exists (
          select 1 from public.app_cpe_portal_snapshots snapshot
          where snapshot.chapa = v_chapa
            and jsonb_typeof(snapshot.payload #> '{jornales,history}') = 'array'
            and jsonb_array_length(snapshot.payload #> '{jornales,history}') > 0
        ) then 'history'
        else 'snapshot'
      end;

      v_job := private.app_cpe_queue_portal_sync_job(
        v_chapa, v_password, v_security_key, 'admin_selected', v_request_kind, null,
        case when v_request_kind = 'history' then now() + interval '30 days' else now() + interval '12 hours' end
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

revoke all on function public.app_cpe_admin_queue_portal_sync_users(text, text[], boolean) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_queue_portal_sync_users(text, text[], boolean) to anon, authenticated;

revoke all on function private.app_cpe_merge_portal_period_section(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.app_cpe_preserve_portal_snapshot_payload(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.app_cpe_preserve_portal_snapshot_trigger() from public, anon, authenticated;
