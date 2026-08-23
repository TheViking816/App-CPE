-- A portal reader may recognize a page before its table has finished loading.
-- Never let such an empty or shorter partial response erase a collection already stored.
create or replace function private.app_cpe_preserve_nonempty_portal_sections(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_result jsonb := coalesce(p_existing, '{}'::jsonb) || coalesce(p_incoming, '{}'::jsonb);
  v_section record;
  v_collection_key text;
  v_merged_section jsonb;
begin
  if p_existing is null then return p_incoming; end if;
  if p_incoming is null then return p_existing; end if;

  for v_section in
    select key, value
    from jsonb_each(p_existing)
    where jsonb_typeof(value) = 'object'
      and jsonb_typeof(p_incoming -> key) = 'object'
  loop
    v_merged_section := v_section.value || (p_incoming -> v_section.key);
    foreach v_collection_key in array array['rows', 'months', 'history', 'rules']
    loop
      if jsonb_typeof(v_section.value -> v_collection_key) = 'array'
        and jsonb_array_length(v_section.value -> v_collection_key) > 0
        and (
          jsonb_typeof((p_incoming -> v_section.key) -> v_collection_key) is distinct from 'array'
          or jsonb_array_length((p_incoming -> v_section.key) -> v_collection_key)
            < jsonb_array_length(v_section.value -> v_collection_key)
        ) then
        v_merged_section := jsonb_set(
          v_merged_section,
          array[v_collection_key],
          v_section.value -> v_collection_key,
          true
        );
      end if;
    end loop;
    v_result := jsonb_set(v_result, array[v_section.key], v_merged_section, true);
  end loop;

  return v_result;
end;
$$;

-- Exceptions are annual history. If a partial read returns only part of the
-- table, retain older rows and let the newest copy of a row update its status.
create or replace function private.app_cpe_merge_portal_exception_section(
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
  v_rows jsonb;
begin
  if p_incoming is null then return p_existing; end if;
  if p_existing is null then return p_incoming; end if;

  v_result := p_existing || p_incoming;
  with candidates as (
    select value as row_value, 0 as priority
    from jsonb_array_elements(
      case when jsonb_typeof(p_existing -> 'rows') = 'array'
        then p_existing -> 'rows' else '[]'::jsonb end
    )
    union all
    select value as row_value, 1 as priority
    from jsonb_array_elements(
      case when jsonb_typeof(p_incoming -> 'rows') = 'array'
        then p_incoming -> 'rows' else '[]'::jsonb end
    )
  ), deduplicated as (
    select distinct on (
      coalesce(row_value ->> 'chapa', ''),
      coalesce(row_value ->> 'date', ''),
      coalesce(row_value ->> 'shift', ''),
      coalesce(row_value ->> 'requestedAt', '')
    ) row_value
    from candidates
    where jsonb_typeof(row_value) = 'object'
    order by
      coalesce(row_value ->> 'chapa', ''),
      coalesce(row_value ->> 'date', ''),
      coalesce(row_value ->> 'shift', ''),
      coalesce(row_value ->> 'requestedAt', ''),
      priority desc
  )
  select coalesce(jsonb_agg(row_value order by row_value ->> 'date' desc), '[]'::jsonb)
  into v_rows
  from deduplicated;

  if jsonb_array_length(v_rows) > 0 then
    v_result := jsonb_set(v_result, '{rows}', v_rows, true);
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
  v_result jsonb;
begin
  if p_existing is null then return p_incoming; end if;
  if p_incoming is null then return p_existing; end if;

  v_result := private.app_cpe_preserve_nonempty_portal_sections(p_existing, p_incoming);

  if p_existing -> 'jornales' is not null or p_incoming -> 'jornales' is not null then
    v_result := jsonb_set(v_result, '{jornales}', private.app_cpe_merge_portal_period_section(p_existing -> 'jornales', p_incoming -> 'jornales'), true);
  end if;
  if p_existing -> 'primas' is not null or p_incoming -> 'primas' is not null then
    v_result := jsonb_set(v_result, '{primas}', private.app_cpe_merge_portal_period_section(p_existing -> 'primas', p_incoming -> 'primas'), true);
  end if;
  if p_existing -> 'excepciones' is not null or p_incoming -> 'excepciones' is not null then
    v_result := jsonb_set(v_result, '{excepciones}', private.app_cpe_merge_portal_exception_section(p_existing -> 'excepciones', p_incoming -> 'excepciones'), true);
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

revoke all on function private.app_cpe_preserve_nonempty_portal_sections(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.app_cpe_merge_portal_exception_section(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.app_cpe_preserve_portal_snapshot_payload(jsonb, jsonb) from public, anon, authenticated;
