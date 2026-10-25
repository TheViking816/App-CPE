alter table private.app_cpe_portal_link_requests
  add column if not exists security_key_secret_id uuid;

create or replace function public.app_cpe_request_portal_links_with_premium(
  p_token text, p_portal_password text, p_security_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_request private.app_cpe_portal_link_requests;
  v_result jsonb;
  v_key text;
  v_secret_id uuid;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_key := pg_catalog.btrim(coalesce(p_security_key,''));
  if pg_catalog.length(v_key) > 256 then raise exception 'La clave de primas es demasiado larga'; end if;

  -- The existing password flow and its notification remain unchanged.
  v_result := public.app_cpe_request_portal_links(p_token,p_portal_password);
  if v_key = '' then return v_result; end if;

  select * into v_request from private.app_cpe_portal_link_requests
    where user_id=v_user.id for update;
  if v_request.user_id is null then raise exception 'Vinculación del portal no disponible'; end if;
  if v_request.security_key_secret_id is null then
    v_secret_id := vault.create_secret(v_key,
      'app_cpe_link_premium_'||v_user.chapa,
      'Clave de primas cifrada para la vinculación del portal App CPE');
  else
    v_secret_id := v_request.security_key_secret_id;
    perform vault.update_secret(v_secret_id,v_key);
  end if;
  update private.app_cpe_portal_link_requests
    set security_key_secret_id=v_secret_id,updated_at=now()
    where user_id=v_user.id;
  return v_result || pg_catalog.jsonb_build_object('hasPremiumKey',true);
end $$;

revoke all on function public.app_cpe_request_portal_links_with_premium(text,text,text)
  from public, anon, authenticated;
grant execute on function public.app_cpe_request_portal_links_with_premium(text,text,text)
  to anon, authenticated;
