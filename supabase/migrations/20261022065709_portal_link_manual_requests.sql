drop function if exists public.app_cpe_link_own_portal_pilot(text,text);

create table private.app_cpe_portal_link_requests (
  user_id uuid primary key references public.app_cpe_users(id) on delete cascade,
  chapa text not null check (chapa='72683'),
  password_secret_id uuid not null,
  status text not null default 'pending' check (status in ('pending','linked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_notified_at timestamptz not null default now()
);
alter table private.app_cpe_portal_link_requests enable row level security;
revoke all on private.app_cpe_portal_link_requests from public,anon,authenticated;

alter table public.app_cpe_activation_email_outbox drop constraint app_cpe_activation_email_outbox_kind_check;
alter table public.app_cpe_activation_email_outbox add constraint app_cpe_activation_email_outbox_kind_check
  check (kind in ('admin_pending','user_activated','portal_credentials_rejected','premium_history_ready','admin_security_key_added','admin_portal_links_requested'));

create function public.app_cpe_portal_link_request_status(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user public.app_cpe_users; v_request private.app_cpe_portal_link_requests;
begin
  v_user:=public.app_cpe_user_from_token(p_token);
  if v_user.chapa is distinct from '72683' then raise exception 'Prueba disponible solo para 72683'; end if;
  select * into v_request from private.app_cpe_portal_link_requests where user_id=v_user.id;
  return jsonb_build_object('status',coalesce(v_request.status,'none'),'updatedAt',v_request.updated_at);
end; $$;

create function public.app_cpe_request_portal_links(p_token text,p_portal_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user public.app_cpe_users; v_request private.app_cpe_portal_link_requests; v_secret uuid; v_same boolean;
begin
  v_user:=public.app_cpe_user_from_token(p_token);
  if v_user.chapa is distinct from '72683' then raise exception 'Prueba disponible solo para 72683'; end if;
  if p_portal_password is null or length(p_portal_password) not between 1 and 256 or btrim(p_portal_password)='' then raise exception 'Introduce la contraseña del portal'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('app_cpe_link_request_'||v_user.chapa));
  select * into v_request from private.app_cpe_portal_link_requests where user_id=v_user.id for update;
  if found then
    select decrypted_secret=p_portal_password into v_same from vault.decrypted_secrets where id=v_request.password_secret_id;
    if v_request.status='pending' and coalesce(v_same,false) then return public.app_cpe_portal_link_request_status(p_token); end if;
    if v_request.last_notified_at>now()-interval '5 minutes' then raise exception 'Espera cinco minutos antes de cambiar la contraseña guardada'; end if;
    v_secret:=v_request.password_secret_id;
    perform vault.update_secret(v_secret,p_portal_password);
    update private.app_cpe_portal_link_requests set status='pending',updated_at=now(),last_notified_at=now() where user_id=v_user.id;
  else
    v_secret:=vault.create_secret(p_portal_password,'app_cpe_link_request_'||v_user.chapa,'Contraseña recuperable para vinculación manual de enlaces App CPE');
    insert into private.app_cpe_portal_link_requests(user_id,chapa,password_secret_id) values(v_user.id,v_user.chapa,v_secret);
  end if;
  insert into public.app_cpe_activation_email_outbox(user_id,kind,recipient,chapa)
    values(v_user.id,'admin_portal_links_requested','portalestibavlc@gmail.com',v_user.chapa)
    on conflict(user_id,kind) do update set recipient=excluded.recipient,chapa=excluded.chapa,status='pending',attempts=0,last_error=null,sent_at=null,created_at=now();
  return public.app_cpe_portal_link_request_status(p_token);
end; $$;

revoke all on function public.app_cpe_request_portal_links(text,text), public.app_cpe_portal_link_request_status(text) from public,anon,authenticated;
grant execute on function public.app_cpe_request_portal_links(text,text), public.app_cpe_portal_link_request_status(text) to anon,authenticated;
