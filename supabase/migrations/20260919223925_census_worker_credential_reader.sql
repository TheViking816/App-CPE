-- Credencial de un solo usuario para el lector manual de censos. No crea
-- trabajos de sincronización ni modifica las fechas del worker habitual.
create or replace function public.app_cpe_get_census_worker_credential(p_chapa text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text;
begin
  if p_chapa !~ '^\d{5}$' then
    raise exception 'Chapa no valida';
  end if;

  select secret.decrypted_secret into v_password
  from public.app_cpe_portal_auto_sync config
  join vault.decrypted_secrets secret on secret.id = config.portal_password_secret_id
  where config.chapa = p_chapa and config.enabled;

  if length(coalesce(v_password, '')) < 1 then
    raise exception 'No hay credenciales activas para la chapa solicitada';
  end if;

  return jsonb_build_object('chapa', p_chapa, 'portalPassword', v_password);
end;
$$;

revoke all on function public.app_cpe_get_census_worker_credential(text) from public, anon, authenticated;
grant execute on function public.app_cpe_get_census_worker_credential(text) to service_role;
