-- Include mobile-reader premium keys stored in Vault when an account is deleted.
create or replace function public.app_cpe_delete_account(
  p_token text,p_current_password text,p_confirmation text
) returns jsonb language plpgsql security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp as $$
declare
  v_user public.app_cpe_users;
  v_password_secret_id uuid;
  v_security_secret_id uuid;
  v_mobile_secret_ids uuid[];
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select u.* into v_user from public.app_cpe_users u where u.id=v_user.id for update;
  if v_user.password_hash <> crypt(coalesce(p_current_password,''),v_user.password_hash) then
    raise exception 'La contraseña actual no es correcta';
  end if;
  if upper(trim(coalesce(p_confirmation,''))) <> 'ELIMINAR' then
    raise exception 'Escribe ELIMINAR para confirmar la baja definitiva';
  end if;
  select portal_password_secret_id,security_key_secret_id
    into v_password_secret_id,v_security_secret_id
    from public.app_cpe_portal_auto_sync where chapa=v_user.chapa;
  select array_agg(distinct secret_id) into v_mobile_secret_ids from (
    select secret_id from cpe_mobile_private.invalid_salary_keys where chapa=v_user.chapa
    union all
    select premium_secret_id from cpe_mobile_private.personal_items where chapa=v_user.chapa
  ) keys where secret_id is not null;

  delete from cpe_mobile_private.personal_items where chapa=v_user.chapa;
  delete from private.app_cpe_initial_paid_days where chapa=v_user.chapa;
  delete from private.app_cpe_noray_link_audit where chapa=v_user.chapa;
  delete from public.app_cpe_bolsa_name_scan_jobs where chapa=v_user.chapa;
  delete from public.app_cpe_usage_events where chapa=v_user.chapa;
  update cpe_mobile_private.personal_runs set current_chapa=null where current_chapa=v_user.chapa;
  update private.app_cpe_personal_sync_runs set current_chapa=null where current_chapa=v_user.chapa;
  delete from public.app_cpe_users where id=v_user.id;
  delete from vault.secrets where id in (v_password_secret_id,v_security_secret_id)
    or id=any(coalesce(v_mobile_secret_ids,array[]::uuid[]));
  return jsonb_build_object('ok',true,'deleted',true);
end $$;
