create or replace function public.app_cpe_get_general_board_worker_credential()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_chapa text;
  v_password text;
begin
  select config.chapa, secret.decrypted_secret
  into v_chapa, v_password
  from public.app_cpe_portal_auto_sync config
  join vault.decrypted_secrets secret
    on secret.id = config.portal_password_secret_id
  where config.chapa = '72683'
    and config.enabled
    and length(coalesce(secret.decrypted_secret, '')) > 0
  limit 1;

  if v_chapa is null or length(coalesce(v_password, '')) < 1 then
    raise exception 'La credencial 72683 no está disponible para actualizar el tablón';
  end if;

  return jsonb_build_object('chapa', v_chapa, 'portalPassword', v_password);
end;
$$;

revoke all on function public.app_cpe_get_general_board_worker_credential() from public, anon, authenticated;
grant execute on function public.app_cpe_get_general_board_worker_credential() to service_role;
