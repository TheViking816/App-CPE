-- La lista SL es una vista viva: al pasar los dias puede tener menos filas o
-- quedar vacia. Una lectura reconocida debe reemplazar el cache anterior.
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

    -- Las demas secciones conservan la proteccion frente a capturas parciales.
    -- SL se acepta completa porque parseSl ya confirma que la tabla es valida.
    if v_section.key <> 'sl' then
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
    end if;

    v_result := jsonb_set(v_result, array[v_section.key], v_merged_section, true);
  end loop;

  return v_result;
end;
$$;

revoke all on function private.app_cpe_preserve_nonempty_portal_sections(jsonb, jsonb)
  from public, anon, authenticated;
