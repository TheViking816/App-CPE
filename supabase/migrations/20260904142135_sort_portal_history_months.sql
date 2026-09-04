create or replace function private.app_cpe_merge_portal_period_section(p_existing jsonb,p_incoming jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb; histories jsonb; old_period jsonb; new_period jsonb;
begin
  if p_existing is null then return p_incoming; end if;
  if p_incoming is null or p_incoming->>'locked'='true' then return p_existing; end if;
  old_period := p_existing - 'history';
  new_period := p_incoming - 'history';
  histories := coalesce(p_existing->'history','[]');
  if nullif(old_period->>'monthLabel','') is not null then
    histories := private.app_cpe_keep_known_json(histories,jsonb_build_array(old_period));
  end if;
  histories := private.app_cpe_keep_known_json(histories,coalesce(p_incoming->'history','[]'));
  if nullif(new_period->>'monthLabel','') is not null then
    histories := private.app_cpe_keep_known_json(histories,jsonb_build_array(new_period));
  end if;
  if old_period->>'monthLabel' is not distinct from new_period->>'monthLabel' then
    result := private.app_cpe_keep_known_json(old_period,new_period);
  else result := new_period; end if;
  select coalesce(jsonb_agg(h order by (h->>'year')::integer nulls last, (h->>'month')::integer nulls last), '[]'::jsonb) into histories from jsonb_array_elements(histories) h;
  return jsonb_set(result,'{history}',histories,true);
end; $$;


-- Reapply the month-aware merge to existing stored histories without deleting rows.
update public.app_cpe_portal_snapshots set payload=payload;
