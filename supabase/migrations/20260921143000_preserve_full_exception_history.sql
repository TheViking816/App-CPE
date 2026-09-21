-- Exception requests are annual history. A later portal response can omit
-- accepted, denied or pending rows, so merge every known row and let the
-- newest copy update its status without erasing the rest of the year.
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
  v_existing_year integer := coalesce((p_existing ->> 'year')::integer, 0);
  v_incoming_year integer := coalesce((p_incoming ->> 'year')::integer, 0);
  v_used_total integer;
  v_max_annual integer;
begin
  if p_incoming is null then return p_existing; end if;
  if p_existing is null then return p_incoming; end if;
  if not coalesce((p_incoming ->> 'recognized')::boolean, false)
    or jsonb_typeof(p_incoming -> 'rows') is distinct from 'array'
  then
    return p_existing;
  end if;

  if v_existing_year > 0 and v_incoming_year > 0 and v_existing_year <> v_incoming_year then
    return p_existing || p_incoming;
  end if;

  v_result := p_existing || p_incoming;
  with candidates as (
    select value as row_value, 0 as priority
    from jsonb_array_elements(
      case when jsonb_typeof(p_existing -> 'rows') = 'array'
        then p_existing -> 'rows' else '[]'::jsonb end
    )
    union all
    select value as row_value, 1 as priority
    from jsonb_array_elements(p_incoming -> 'rows')
  ), grouped as (
    select
      coalesce(row_value ->> 'chapa', '') as chapa,
      coalesce(row_value ->> 'date', '') as date,
      coalesce(row_value ->> 'shift', '') as shift,
      coalesce(row_value ->> 'requestedAt', '') as requested_at,
      (array_agg(row_value order by priority desc))[1] as row_value,
      bool_or(coalesce((row_value ->> 'used')::boolean, false)) as used
    from candidates
    where jsonb_typeof(row_value) = 'object'
    group by 1, 2, 3, 4
  )
  select coalesce(
    jsonb_agg(
      case when used then jsonb_set(row_value, '{used}', 'true'::jsonb, true) else row_value end
      order by date desc, shift desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from grouped;

  v_used_total := greatest(
    coalesce((p_existing ->> 'usedTotal')::integer, 0),
    coalesce((p_incoming ->> 'usedTotal')::integer, 0),
    (select count(*)::integer from jsonb_array_elements(v_rows) row_value
      where coalesce((row_value ->> 'used')::boolean, false))
  );
  v_max_annual := greatest(
    1,
    coalesce((p_incoming ->> 'maxAnnual')::integer, 0),
    coalesce((p_existing ->> 'maxAnnual')::integer, 15)
  );

  v_result := jsonb_set(v_result, '{rows}', v_rows, true);
  v_result := jsonb_set(v_result, '{usedTotal}', to_jsonb(v_used_total), true);
  v_result := jsonb_set(v_result, '{remaining}', to_jsonb(greatest(0, v_max_annual - v_used_total)), true);
  return v_result;
end;
$$;

revoke all on function private.app_cpe_merge_portal_exception_section(jsonb, jsonb)
  from public, anon, authenticated;
