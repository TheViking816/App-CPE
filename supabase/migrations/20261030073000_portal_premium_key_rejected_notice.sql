-- Surface a rejected premium key separately from a key that was never saved.
create or replace function public.app_cpe_portal_link_request_status(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user public.app_cpe_users;
  v_request private.app_cpe_portal_link_requests;
  v_auto public.app_cpe_portal_auto_sync;
  v_key uuid;
  v_linked boolean;
  v_auto_password_usable boolean;
  v_premium_key_rejected boolean;
begin
  v_user:=public.app_cpe_user_from_token(p_token);
  select * into v_request from private.app_cpe_portal_link_requests where user_id=v_user.id;
  select * into v_auto from public.app_cpe_portal_auto_sync where chapa=v_user.chapa;
  v_key:=coalesce(v_request.security_key_secret_id,v_auto.security_key_secret_id);
  select exists(select 1 from private.app_cpe_manual_noray_section_links
    where chapa=v_user.chapa and section='vacaciones') into v_linked;
  v_auto_password_usable:=v_auto.portal_password_secret_id is not null
    and (v_auto.sync_status is distinct from 'credentials_error'
      or v_auto.last_success_at is not null or v_linked);
  select v_key is not null and exists(
    select 1 from cpe_mobile_private.invalid_salary_keys k
    where k.chapa=v_user.chapa and k.secret_id=v_key)
    into v_premium_key_rejected;
  return jsonb_build_object(
    'status',coalesce(v_request.status,'none'),
    'updatedAt',v_request.updated_at,
    'hasPortalPassword',v_request.password_secret_id is not null or v_auto_password_usable,
    'hasPersonalLinks',v_linked,
    'portalPasswordIncorrect',coalesce((select v_request.rejected_password_fingerprint=
      encode(extensions.digest(d.decrypted_secret,'sha256'),'hex')
      from vault.decrypted_secrets d
      where d.id=coalesce(v_request.password_secret_id,v_auto.portal_password_secret_id)),false),
    'hasPremiumKey',v_key is not null and not v_premium_key_rejected,
    'premiumKeyIncorrect',v_premium_key_rejected
  );
end $$;
