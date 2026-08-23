-- App CPE no muestra ni sincroniza la bandeja del portal. Elimina los datos
-- históricos y evita que la fusión protectora los vuelva a introducir.
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

  if p_existing -> 'jornales' is not null or v_result -> 'jornales' is not null then
    v_result := jsonb_set(v_result, '{jornales}', private.app_cpe_merge_portal_period_section(p_existing -> 'jornales', v_result -> 'jornales'), true);
  end if;
  if p_existing -> 'primas' is not null or v_result -> 'primas' is not null then
    v_result := jsonb_set(v_result, '{primas}', private.app_cpe_merge_portal_period_section(p_existing -> 'primas', v_result -> 'primas'), true);
  end if;
  if p_existing -> 'excepciones' is not null or v_result -> 'excepciones' is not null then
    v_result := jsonb_set(v_result, '{excepciones}', private.app_cpe_merge_portal_exception_section(p_existing -> 'excepciones', v_result -> 'excepciones'), true);
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
  from public, anon, authenticated;

update public.app_cpe_portal_snapshots
set payload = case
  when payload -> 'sync' is not null
    and coalesce(payload #>> '{sync,stage}', '') = 'Completado'
    and not coalesce((payload #>> '{sync,inProgress}')::boolean, false)
  then jsonb_set(payload - 'mensajes', '{sync}', (payload -> 'sync') - 'failed' - 'error', true)
  else payload - 'mensajes'
end
where payload ? 'mensajes'
   or (
     coalesce(payload #>> '{sync,stage}', '') = 'Completado'
     and (payload #> '{sync,failed}' is not null or payload #> '{sync,error}' is not null)
   );

update public.app_cpe_portal_preview_snapshots
set payload = payload - 'mensajes'
where payload ? 'mensajes';
