create or replace function public.app_cpe_set_portal_security_key(
  p_token text,
  p_security_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_security_secret_id uuid;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if length(trim(coalesce(p_security_key, ''))) < 1 then
    raise exception 'Introduce la clave de seguridad';
  end if;

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa and enabled
  for update;

  if v_config.portal_password_secret_id is null then
    raise exception 'Primero debes guardar la contrasena del portal';
  end if;

  if v_config.security_key_secret_id is null then
    v_security_secret_id := vault.create_secret(
      trim(p_security_key),
      'app_cpe_portal_security_' || v_user.chapa,
      'Clave de primas cifrada para la sincronizacion automatica de App CPE'
    );
  else
    v_security_secret_id := v_config.security_key_secret_id;
    perform vault.update_secret(v_security_secret_id, trim(p_security_key));
  end if;

  update public.app_cpe_portal_auto_sync
  set security_key_secret_id = v_security_secret_id,
      updated_at = now()
  where chapa = v_user.chapa;

  return jsonb_build_object('ok', true, 'hasSecurityKey', true, 'updatedAt', now());
end;
$$;

revoke all on function public.app_cpe_set_portal_security_key(text, text) from public;
grant execute on function public.app_cpe_set_portal_security_key(text, text) to anon, authenticated;
