-- An empty requested-doubles result is authoritative only after the worker
-- has verified that every day in the rolling window loaded its checkbox
-- matrix. This prevents transient/partial portal pages from erasing requests.
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
  v_result jsonb;
  v_sync jsonb;
begin
  if p_existing is null then return p_incoming - 'mensajes'; end if;
  if p_incoming is null then return p_existing - 'mensajes'; end if;

  v_result := private.app_cpe_preserve_nonempty_portal_sections(p_existing, p_incoming) - 'mensajes';

  if p_existing -> 'jornales' is not null or p_incoming -> 'jornales' is not null then
    v_result := jsonb_set(v_result, '{jornales}', private.app_cpe_merge_portal_period_section(p_existing -> 'jornales', p_incoming -> 'jornales'), true);
  end if;
  if p_existing -> 'primas' is not null or p_incoming -> 'primas' is not null then
    v_result := jsonb_set(v_result, '{primas}', private.app_cpe_merge_portal_period_section(p_existing -> 'primas', p_incoming -> 'primas'), true);
  end if;

  if coalesce((p_incoming #>> '{asignaciones,recognized}')::boolean, false)
    and jsonb_typeof(p_incoming #> '{asignaciones,rows}') = 'array'
  then
    v_result := jsonb_set(v_result, '{asignaciones}', p_incoming -> 'asignaciones', true);
  end if;

  if p_existing -> 'excepciones' is not null or p_incoming -> 'excepciones' is not null then
    v_result := jsonb_set(v_result, '{excepciones}', private.app_cpe_merge_portal_exception_section(p_existing -> 'excepciones', p_incoming -> 'excepciones'), true);
  end if;

  if coalesce((p_incoming #>> '{dobles,recognized}')::boolean, false)
    and coalesce((p_incoming #>> '{dobles,complete}')::boolean, false)
    and jsonb_typeof(p_incoming #> '{dobles,rows}') = 'array'
    and jsonb_typeof(p_incoming #> '{dobles,queriedDates}') = 'array'
    and jsonb_array_length(p_incoming #> '{dobles,queriedDates}') = coalesce((p_incoming #>> '{dobles,windowDays}')::integer, 0)
    and coalesce((p_incoming #>> '{dobles,windowDays}')::integer, 0) > 0
  then
    v_result := jsonb_set(v_result, '{dobles}', p_incoming -> 'dobles', true);
  end if;

  if p_existing -> 'nominas' is not null and (
    p_incoming -> 'nominas' is null
    or coalesce((p_incoming #>> '{nominas,locked}')::boolean, false)
  ) then
    v_result := jsonb_set(v_result, '{nominas}', p_existing -> 'nominas', true);
  end if;

  if p_existing -> 'sync' is not null or p_incoming -> 'sync' is not null then
    v_sync := coalesce(p_existing -> 'sync', '{}'::jsonb) || coalesce(p_incoming -> 'sync', '{}'::jsonb);
    if p_incoming -> 'sync' is not null
      and not coalesce((p_incoming #>> '{sync,failed}')::boolean, false)
    then
      v_sync := v_sync - 'failed' - 'error';
    end if;
    v_result := jsonb_set(v_result, '{sync}', v_sync, true);
  end if;
  return v_result;
end;
$$;

revoke all on function private.app_cpe_preserve_portal_snapshot_payload(jsonb, jsonb)
from public, anon, authenticated, service_role;
