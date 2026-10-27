-- Keep the state of a subscription when a browser or push provider drops it.
alter table private.app_cpe_push_subscriptions
  add column activated_at timestamptz not null default now(),
  add column disabled_at timestamptz,
  add column disabled_reason text;
update private.app_cpe_push_subscriptions set activated_at=created_at;

create or replace function public.app_cpe_push_subscribe(p_token text,p_subscription jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_endpoint text; v_p256dh text; v_auth text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_endpoint := p_subscription->>'endpoint';
  v_p256dh := p_subscription->'keys'->>'p256dh';
  v_auth := p_subscription->'keys'->>'auth';
  if length(coalesce(v_endpoint,'')) not between 20 and 2048
    or v_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|webpush[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/'
    or length(coalesce(v_p256dh,'')) not between 80 and 200
    or length(coalesce(v_auth,'')) not between 16 and 100 then
    raise exception 'Suscripción push no válida';
  end if;
  insert into private.app_cpe_push_subscriptions(user_id,endpoint,p256dh,auth)
  values (v_user.id,v_endpoint,v_p256dh,v_auth)
  on conflict(endpoint) do update set
    user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
    activated_at=case when private.app_cpe_push_subscriptions.disabled_at is not null
      then now() else private.app_cpe_push_subscriptions.activated_at end,
    disabled_at=null,disabled_reason=null,updated_at=now();
  return true;
end $$;

create or replace function public.app_cpe_push_subscription_active(p_token text,p_endpoint text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return exists(select 1 from private.app_cpe_push_subscriptions s
    where s.user_id=v_user.id and s.endpoint=p_endpoint and s.disabled_at is null);
end $$;
revoke all on function public.app_cpe_push_subscription_active(text,text) from public,anon,authenticated;
grant execute on function public.app_cpe_push_subscription_active(text,text) to anon,authenticated;

create or replace function public.app_cpe_push_unsubscribe(p_token text,p_endpoint text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  update private.app_cpe_push_subscriptions
    set disabled_at=now(),disabled_reason='sign_out',updated_at=now()
    where user_id=v_user.id and endpoint=p_endpoint and disabled_at is null;
  update private.app_cpe_push_deliveries d set state='failed',updated_at=now()
    from private.app_cpe_push_subscriptions s
    where d.subscription_id=s.id and s.user_id=v_user.id and s.endpoint=p_endpoint
      and d.state in ('pending','processing');
  return true;
end $$;

create or replace function private.app_cpe_queue_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.app_cpe_push_deliveries(notification_id,subscription_id)
  select new.id,s.id from private.app_cpe_push_subscriptions s
  where s.user_id=new.user_id and s.disabled_at is null
  on conflict do nothing;
  return new;
end $$;

create or replace function public.app_cpe_push_finish(p_dispatch_token text,p_id bigint,p_status integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_valid boolean; v_subscription_id uuid;
begin
  select dispatch_token=p_dispatch_token into v_valid from private.app_cpe_push_config where id=true;
  if coalesce(v_valid,false)=false then raise exception 'No autorizado'; end if;
  if p_status in (404,410) then
    select subscription_id into v_subscription_id from private.app_cpe_push_deliveries where id=p_id;
    update private.app_cpe_push_subscriptions set disabled_at=now(),
      disabled_reason='push_http_' || p_status::text,updated_at=now()
      where id=v_subscription_id and disabled_at is null;
    update private.app_cpe_push_deliveries set state='failed',updated_at=now()
      where subscription_id=v_subscription_id and state in ('pending','processing');
  else
    update private.app_cpe_push_deliveries set
      state=case when p_status between 200 and 299 then 'sent'
        when attempts>=3 then 'failed' else 'pending' end,updated_at=now()
      where id=p_id;
  end if;
  return true;
end $$;

create or replace function public.app_cpe_admin_push_activation_monitor(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin public.app_cpe_users; v_users jsonb; v_total integer; v_disabled jsonb;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa is distinct from '72683' then
    raise exception 'Acceso de administrador requerido';
  end if;
  select count(*) into v_total from (
    select user_id from private.app_cpe_push_subscriptions
    where disabled_at is null group by user_id
  ) active_users;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.activated_at desc), '[]'::jsonb)
    into v_users from (
      select u.chapa,u.display_name,min(s.activated_at) as activated_at,
        max(s.updated_at) as last_confirmed_at,count(*)::integer as devices
      from private.app_cpe_push_subscriptions s
      join public.app_cpe_users u on u.id=s.user_id
      where s.disabled_at is null
      group by u.id,u.chapa,u.display_name
      order by min(s.activated_at) desc limit 200
    ) item;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.disabled_at desc),'[]'::jsonb)
    into v_disabled from (
      select u.chapa,s.disabled_at,s.disabled_reason
      from private.app_cpe_push_subscriptions s
      join public.app_cpe_users u on u.id=s.user_id
      where s.disabled_at is not null
      order by s.disabled_at desc limit 10
    ) item;
  return jsonb_build_object('total',v_total,'users',v_users,'recentDisabled',v_disabled);
end $$;
