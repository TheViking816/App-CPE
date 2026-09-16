-- La consulta SL es una vista viva. Si el portal reconoce la tabla, sus filas
-- son autoritativas incluso cuando otra sección deja la sincronización parcial.
-- Fusionarlas por contenido conserva posiciones antiguas para la misma fecha.
create or replace function private.app_cpe_guard_partial_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; merged jsonb;
begin
  for k in select jsonb_object_keys(old.payload) loop
    if k in ('sync','jornales','primas','mensajes') then continue; end if;

    if k = 'sl'
      and new.payload#>>'{sl,recognized}' = 'true'
      and jsonb_typeof(new.payload#>'{sl,rows}') = 'array'
    then
      continue;
    end if;

    if k <> 'nominas' and new.payload#>>'{sync,partial}' is distinct from 'true'
      and new.payload#>>'{sync,failed}' is distinct from 'true'
      and new.payload->k is not null and new.payload->k <> '{}'::jsonb
      and new.payload#>array[k,'rows'] is distinct from '[]'::jsonb
    then continue; end if;

    if k = 'descansos' then
      merged := private.app_cpe_merge_calendar(old.payload->k,new.payload->k);
    else
      merged := private.app_cpe_keep_known_json(old.payload->k,new.payload->k);
    end if;
    if merged is not null then
      new.payload := jsonb_set(new.payload,array[k],merged,true);
    end if;
  end loop;
  return new;
end; $$;

revoke all on function private.app_cpe_guard_partial_snapshot()
  from public, anon, authenticated, service_role;

-- Reparación inmediata del dato contrastado con Consulta posición SL.
update public.app_cpe_portal_snapshots
set payload = jsonb_set(
  payload,
  '{sl,rows}',
  coalesce((
    select jsonb_agg(
      case
        when row->>'fecha' = '20/09/2026'
          then jsonb_set(row, '{posicion}', '"1"'::jsonb, true)
        else row
      end
      order by ordinal
    )
    from jsonb_array_elements(payload#>'{sl,rows}') with ordinality as entries(row, ordinal)
  ), '[]'::jsonb),
  true
)
where chapa = '72683'
  and jsonb_typeof(payload#>'{sl,rows}') = 'array';
