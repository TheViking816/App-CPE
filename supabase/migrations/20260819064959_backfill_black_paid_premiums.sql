-- The portal uses red for pending, green for confirmed and black for paid.
-- Older readers preserved red/green but stored black as "unknown". Repair the
-- existing snapshots so historical months do not need to be synchronized again.
create function private.app_cpe_backfill_paid_premium_section(p_section jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_result jsonb := p_section;
  v_rows jsonb;
  v_history jsonb;
begin
  if p_section is null or jsonb_typeof(p_section) <> 'object' then return p_section; end if;

  if jsonb_typeof(p_section -> 'rows') = 'array' then
    select coalesce(jsonb_agg(
      case when coalesce(row_item ->> 'produccionEstado', 'unknown') = 'unknown'
        then jsonb_set(row_item, '{produccionEstado}', '"paid"'::jsonb, true)
        else row_item end
      order by row_position
    ), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(p_section -> 'rows') with ordinality rows(row_item, row_position);
    v_result := jsonb_set(v_result, '{rows}', v_rows, true);
  end if;

  if jsonb_typeof(p_section -> 'history') = 'array' then
    select coalesce(jsonb_agg(
      case when jsonb_typeof(period_item -> 'rows') = 'array'
        then jsonb_set(
          period_item,
          '{rows}',
          coalesce((
            select jsonb_agg(
              case when coalesce(row_item ->> 'produccionEstado', 'unknown') = 'unknown'
                then jsonb_set(row_item, '{produccionEstado}', '"paid"'::jsonb, true)
                else row_item end
              order by row_position
            )
            from jsonb_array_elements(period_item -> 'rows') with ordinality rows(row_item, row_position)
          ), '[]'::jsonb),
          true
        )
        else period_item end
      order by period_position
    ), '[]'::jsonb)
    into v_history
    from jsonb_array_elements(p_section -> 'history') with ordinality periods(period_item, period_position);
    v_result := jsonb_set(v_result, '{history}', v_history, true);
  end if;

  return v_result;
end;
$$;

update public.app_cpe_portal_snapshots
set payload = jsonb_set(
  payload,
  '{primas}',
  private.app_cpe_backfill_paid_premium_section(payload -> 'primas'),
  true
)
where payload -> 'primas' is not null
  and payload -> 'primas' @? '$.**.produccionEstado ? (@ == "unknown")';

update public.app_cpe_portal_preview_snapshots
set payload = jsonb_set(
  payload,
  '{primas}',
  private.app_cpe_backfill_paid_premium_section(payload -> 'primas'),
  true
)
where payload -> 'primas' is not null
  and payload -> 'primas' @? '$.**.produccionEstado ? (@ == "unknown")';

drop function private.app_cpe_backfill_paid_premium_section(jsonb);
