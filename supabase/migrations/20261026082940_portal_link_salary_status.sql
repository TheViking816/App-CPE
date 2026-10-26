create or replace function public.app_cpe_portal_link_request_status(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user public.app_cpe_users; v_request private.app_cpe_portal_link_requests;
  v_auto public.app_cpe_portal_auto_sync; v_key uuid; v_linked boolean;
begin
  v_user:=public.app_cpe_user_from_token(p_token);
  select * into v_request from private.app_cpe_portal_link_requests where user_id=v_user.id;
  select * into v_auto from public.app_cpe_portal_auto_sync where chapa=v_user.chapa;
  v_key:=coalesce(v_request.security_key_secret_id,v_auto.security_key_secret_id);
  select exists(select 1 from private.app_cpe_manual_noray_section_links
    where chapa=v_user.chapa and section='vacaciones') into v_linked;
  return jsonb_build_object('status',coalesce(v_request.status,'none'),
    'updatedAt',v_request.updated_at,'hasPortalPassword',
    v_request.password_secret_id is not null or v_auto.portal_password_secret_id is not null,
    'hasPersonalLinks',v_linked,
    'hasPremiumKey',v_key is not null and not exists(
      select 1 from cpe_mobile_private.invalid_salary_keys k
      where k.chapa=v_user.chapa and k.secret_id=v_key));
end $$;

create or replace function public.app_cpe_save_portal_premium_key(
  p_token text,p_security_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user public.app_cpe_users; v_request private.app_cpe_portal_link_requests;
  v_auto public.app_cpe_portal_auto_sync; v_secret uuid; v_old text;
begin
  v_user:=public.app_cpe_user_from_token(p_token);
  if p_security_key is null or length(btrim(p_security_key)) not between 1 and 256
    then raise exception 'Introduce la clave de primas'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('app_cpe_link_request_'||v_user.chapa));
  select * into v_request from private.app_cpe_portal_link_requests
    where user_id=v_user.id for update;
  select * into v_auto from public.app_cpe_portal_auto_sync
    where chapa=v_user.chapa for update;
  if v_request.password_secret_id is null and v_auto.portal_password_secret_id is null
    then raise exception 'Primero vincula la contraseña del portal'; end if;
  v_secret:=coalesce(v_request.security_key_secret_id,v_auto.security_key_secret_id);
  if v_secret is not null then
    select decrypted_secret into v_old from vault.decrypted_secrets where id=v_secret;
    if v_old=btrim(p_security_key) then return public.app_cpe_portal_link_request_status(p_token); end if;
  end if;
  if v_request.user_id is not null and v_request.last_notified_at>now()-interval '5 minutes'
    then raise exception 'Espera cinco minutos antes de cambiar la clave guardada'; end if;
  if v_secret is null then
    v_secret:=vault.create_secret(btrim(p_security_key),
      'app_cpe_link_premium_'||v_user.chapa,'Clave de primas App CPE');
  else
    perform vault.update_secret(v_secret,btrim(p_security_key));
  end if;
  if v_request.user_id is not null then
    update private.app_cpe_portal_link_requests
      set security_key_secret_id=v_secret,updated_at=now(),last_notified_at=now()
      where user_id=v_user.id;
  else
    update public.app_cpe_portal_auto_sync
      set security_key_secret_id=v_secret,updated_at=now()
      where chapa=v_user.chapa;
  end if;
  delete from cpe_mobile_private.invalid_salary_keys where chapa=v_user.chapa;
  insert into public.app_cpe_activation_email_outbox(user_id,kind,recipient,chapa)
    values(v_user.id,'admin_portal_links_requested','portalestibavlc@gmail.com',v_user.chapa)
    on conflict(user_id,kind) do update set recipient=excluded.recipient,
      chapa=excluded.chapa,status='pending',attempts=0,last_error=null,
      sent_at=null,created_at=now();
  return public.app_cpe_portal_link_request_status(p_token);
end $$;

revoke all on function public.app_cpe_save_portal_premium_key(text,text)
  from public,anon,authenticated;
grant execute on function public.app_cpe_save_portal_premium_key(text,text)
  to anon,authenticated;
