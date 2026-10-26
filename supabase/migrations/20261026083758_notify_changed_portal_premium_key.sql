create or replace function public.app_cpe_request_portal_links_with_premium(
  p_token text,p_portal_password text,p_security_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user public.app_cpe_users; v_request private.app_cpe_portal_link_requests;
  v_result jsonb; v_key text; v_old text; v_secret uuid; v_changed boolean;
begin
  v_user:=public.app_cpe_user_from_token(p_token);
  v_key:=btrim(coalesce(p_security_key,''));
  if length(v_key)>256 then raise exception 'La clave de primas es demasiado larga'; end if;
  v_result:=public.app_cpe_request_portal_links(p_token,p_portal_password);
  if v_key='' then return v_result; end if;
  select * into v_request from private.app_cpe_portal_link_requests
    where user_id=v_user.id for update;
  if v_request.user_id is null then raise exception 'Vinculación del portal no disponible'; end if;
  if v_request.security_key_secret_id is not null then
    select decrypted_secret into v_old from vault.decrypted_secrets
      where id=v_request.security_key_secret_id;
  end if;
  v_changed:=v_old is distinct from v_key;
  if v_changed then
    if v_request.security_key_secret_id is null then
      v_secret:=vault.create_secret(v_key,'app_cpe_link_premium_'||v_user.chapa,
        'Clave de primas cifrada para vinculación App CPE');
    else
      v_secret:=v_request.security_key_secret_id;
      perform vault.update_secret(v_secret,v_key);
    end if;
    update private.app_cpe_portal_link_requests
      set security_key_secret_id=v_secret,updated_at=now()
      where user_id=v_user.id;
    delete from cpe_mobile_private.invalid_salary_keys where chapa=v_user.chapa;
    insert into public.app_cpe_activation_email_outbox(user_id,kind,recipient,chapa)
      values(v_user.id,'admin_portal_links_requested','portalestibavlc@gmail.com',v_user.chapa)
      on conflict(user_id,kind) do update set recipient=excluded.recipient,
        chapa=excluded.chapa,status='pending',attempts=0,last_error=null,
        sent_at=null,created_at=now();
  end if;
  return public.app_cpe_portal_link_request_status(p_token);
end $$;

revoke all on function public.app_cpe_request_portal_links_with_premium(text,text,text)
  from public,anon,authenticated;
grant execute on function public.app_cpe_request_portal_links_with_premium(text,text,text)
  to anon,authenticated;
