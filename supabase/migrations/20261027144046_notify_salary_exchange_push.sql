-- In-app events belong to the recipient; no message body is copied into a notification.
create or replace function private.app_cpe_notify_exchange_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_vacation boolean := tg_table_name like '%vacation%';
  v_kind text := case when tg_table_name like '%vacation%' then 'vacation' else 'rest' end;
  v_offer_id uuid;
  v_owner_id uuid;
  v_proposer_id uuid;
  v_recipient_id uuid;
  v_recipient public.app_cpe_users;
  v_actor public.app_cpe_users;
  v_event text;
  v_title text;
  v_body text;
  v_proposal_id uuid;
  v_hash text;
begin
  if tg_table_name like '%proposals' then
    v_offer_id := new.offer_id;
    v_proposer_id := new.proposer_id;
    v_proposal_id := new.id;
    if v_vacation then
      select owner_id into v_owner_id from public.app_cpe_vacation_offers where id = v_offer_id;
    else
      select owner_id into v_owner_id from public.app_cpe_rest_offers where id = v_offer_id;
    end if;
    if tg_op = 'INSERT' then
      v_recipient_id := v_owner_id;
      select * into v_actor from public.app_cpe_users where id = v_proposer_id;
      v_event := v_kind || '_proposal';
      v_title := case when v_vacation then 'Nueva propuesta de vacaciones' else 'Nueva propuesta de descanso' end;
      v_body := coalesce(nullif(v_actor.display_name,''),v_actor.chapa,'Un compañero') || ' quiere hacer un intercambio contigo.';
    elsif new.status is distinct from old.status and new.status in ('accepted','rejected') then
      v_recipient_id := v_proposer_id;
      v_event := v_kind || '_response';
      v_title := case when new.status = 'accepted' then 'Propuesta aceptada' else 'Propuesta rechazada' end;
      v_body := case when v_vacation then 'Consulta tu intercambio de vacaciones.' else 'Consulta tu intercambio de descansos.' end;
    else
      return new;
    end if;
  else
    v_proposal_id := new.proposal_id;
    if v_vacation then
      select p.offer_id,p.proposer_id into v_offer_id,v_proposer_id from public.app_cpe_vacation_proposals p where p.id = v_proposal_id;
      select owner_id into v_owner_id from public.app_cpe_vacation_offers where id = v_offer_id;
    else
      select p.offer_id,p.proposer_id into v_offer_id,v_proposer_id from public.app_cpe_rest_proposals p where p.id = v_proposal_id;
      select owner_id into v_owner_id from public.app_cpe_rest_offers where id = v_offer_id;
    end if;
    if new.sender_id not in (v_owner_id,v_proposer_id) then return new; end if;
    v_recipient_id := case when new.sender_id = v_owner_id then v_proposer_id else v_owner_id end;
    select * into v_actor from public.app_cpe_users where id = new.sender_id;
    v_event := v_kind || '_message';
    v_title := 'Mensaje de ' || coalesce(nullif(v_actor.display_name,''),v_actor.chapa,'un compañero');
    v_body := case when v_vacation then 'Abre el chat de vacaciones para leerlo.' else 'Abre el chat de descansos para leerlo.' end;
  end if;
  if v_recipient_id is null or (tg_table_name like '%proposals' and tg_op = 'INSERT' and v_recipient_id = v_proposer_id) then return new; end if;
  v_hash := new.id::text;
  if tg_table_name like '%proposals' then v_hash := v_hash || ':' || new.status; end if;
  select * into v_recipient from public.app_cpe_users where id = v_recipient_id;
  if v_recipient.id is null then return new; end if;
  insert into public.app_cpe_user_notifications
    (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata,created_at)
  values (v_recipient.id,v_recipient.chapa,v_event,v_title,v_body,v_proposal_id::text,
    v_hash,
    'conversaciones',jsonb_build_object('proposalId',v_proposal_id,'offerId',v_offer_id),new.created_at)
  on conflict (chapa,event_type,entity_key,change_hash) do nothing;
  return new;
end $$;

create trigger app_cpe_rest_proposal_notify after insert or update of status on public.app_cpe_rest_proposals
for each row execute function private.app_cpe_notify_exchange_activity();
create trigger app_cpe_vacation_proposal_notify after insert or update of status on public.app_cpe_vacation_proposals
for each row execute function private.app_cpe_notify_exchange_activity();
create trigger app_cpe_rest_message_notify after insert on public.app_cpe_rest_messages
for each row execute function private.app_cpe_notify_exchange_activity();
create trigger app_cpe_vacation_message_notify after insert on public.app_cpe_vacation_messages
for each row execute function private.app_cpe_notify_exchange_activity();

create or replace function private.app_cpe_notify_mobile_journals()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_row jsonb;
  v_old_rows jsonb := '[]'::jsonb;
  v_year int;
  v_month int;
  v_date date;
  v_key text;
begin
  select * into v_user from public.app_cpe_users where chapa = new.chapa;
  if v_user.id is null or coalesce(new.payload->'journals'->>'year','') !~ '^20[0-9]{2}$'
     or coalesce(new.payload->'journals'->>'month','') !~ '^[0-9]{1,2}$' then return new; end if;
  v_year := (new.payload->'journals'->>'year')::int;
  v_month := (new.payload->'journals'->>'month')::int;
  if v_month not between 1 and 12 then return new; end if;
  if tg_op = 'UPDATE' and old.payload->'journals'->>'year' = v_year::text
      and old.payload->'journals'->>'month' = v_month::text then
    v_old_rows := coalesce(old.payload->'journals'->'rows','[]'::jsonb);
  end if;
  for v_row in select value from jsonb_array_elements(coalesce(new.payload->'journals'->'rows','[]'::jsonb)) loop
    if coalesce(v_row->>'dia','') !~ '^[0-9]{1,2}$' then continue; end if;
    if (v_row->>'dia')::int not between 1 and 31 then continue; end if;
    begin v_date := make_date(v_year,v_month,(v_row->>'dia')::int);
    exception when datetime_field_overflow then continue; end;
    if v_date < (now() at time zone 'Europe/Madrid')::date - 7 then continue; end if;
    v_key := v_date::text || '|' || coalesce(v_row->>'jornada','');
    if exists(select 1 from jsonb_array_elements(v_old_rows) r where r->>'dia'=v_row->>'dia' and r->>'jornada'=v_row->>'jornada') then continue; end if;
    insert into public.app_cpe_user_notifications
      (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata)
    values (v_user.id,new.chapa,'new_journal','Nuevo jornal cargado',
      to_char(v_date,'DD/MM/YYYY') || ' · ' || coalesce(v_row->>'jornada',''),v_key,
      encode(extensions.digest(v_row::text,'sha256'),'hex'),'sueldometro',
      jsonb_build_object('date',v_date,'shift',v_row->>'jornada'))
    on conflict (chapa,event_type,entity_key,change_hash) do nothing;
  end loop;
  return new;
end $$;
create trigger app_cpe_mobile_journal_notify after insert or update of payload on private.app_cpe_personal_noray_snapshots
for each row execute function private.app_cpe_notify_mobile_journals();

create or replace function private.app_cpe_notify_mobile_premium()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  if new.work_date < (now() at time zone 'Europe/Madrid')::date - 30 then return new; end if;
  select * into v_user from public.app_cpe_users where chapa=new.chapa;
  if v_user.id is null then return new; end if;
  insert into public.app_cpe_user_notifications
    (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata)
  values (v_user.id,new.chapa,'new_premium','Prima cargada',
    to_char(new.work_date,'DD/MM/YYYY') || ' · ' || new.shift || ' · ' || to_char(new.amount,'FM999G999D00') || ' €',
    new.work_date::text || '|' || new.shift, new.part || ':' || new.amount::text,
    'sueldometro',jsonb_build_object('date',new.work_date,'shift',new.shift,'part',new.part))
  on conflict (chapa,event_type,entity_key,change_hash) do nothing;
  return new;
end $$;
create trigger app_cpe_mobile_premium_notify after insert on cpe_mobile_private.personal_salary_premiums
for each row execute function private.app_cpe_notify_mobile_premium();

-- Browser subscriptions are private and linked to the existing App CPE session.
create table private.app_cpe_push_config (
  id boolean primary key default true check (id),
  public_key text,
  private_key text,
  dispatch_token text not null default encode(extensions.gen_random_bytes(32),'hex')
);
insert into private.app_cpe_push_config(id) values (true);
revoke all on private.app_cpe_push_config from public, anon, authenticated;

create table private.app_cpe_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on private.app_cpe_push_subscriptions(user_id);
revoke all on private.app_cpe_push_subscriptions from public, anon, authenticated;

create table private.app_cpe_push_deliveries (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.app_cpe_user_notifications(id) on delete cascade,
  subscription_id uuid not null references private.app_cpe_push_subscriptions(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(notification_id,subscription_id)
);
create index on private.app_cpe_push_deliveries(state,updated_at) where state in ('pending','processing');
revoke all on private.app_cpe_push_deliveries from public, anon, authenticated;

create function private.app_cpe_queue_push() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.app_cpe_push_deliveries(notification_id,subscription_id)
  select new.id,s.id from private.app_cpe_push_subscriptions s where s.user_id=new.user_id
  on conflict do nothing;
  return new;
end $$;
create trigger app_cpe_queue_push after insert on public.app_cpe_user_notifications
for each row execute function private.app_cpe_queue_push();

create function public.app_cpe_push_public_key() returns text language sql security definer set search_path = '' as $$
  select public_key from private.app_cpe_push_config where id=true
$$;
revoke all on function public.app_cpe_push_public_key() from public;
grant execute on function public.app_cpe_push_public_key() to anon,authenticated;

create function public.app_cpe_push_subscribe(p_token text,p_subscription jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_endpoint text; v_p256dh text; v_auth text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_endpoint := p_subscription->>'endpoint';
  v_p256dh := p_subscription->'keys'->>'p256dh';
  v_auth := p_subscription->'keys'->>'auth';
  if length(coalesce(v_endpoint,'')) not between 20 and 2048
    or v_endpoint !~ '^https://[^/]+/'
    or length(coalesce(v_p256dh,'')) not between 80 and 200
    or length(coalesce(v_auth,'')) not between 16 and 100 then
    raise exception 'Suscripción push no válida';
  end if;
  insert into private.app_cpe_push_subscriptions(user_id,endpoint,p256dh,auth)
  values (v_user.id,v_endpoint,v_p256dh,v_auth)
  on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,
    auth=excluded.auth,updated_at=now();
  return true;
end $$;
revoke all on function public.app_cpe_push_subscribe(text,jsonb) from public;
grant execute on function public.app_cpe_push_subscribe(text,jsonb) to anon,authenticated;

create function public.app_cpe_push_unsubscribe(p_token text,p_endpoint text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  delete from private.app_cpe_push_subscriptions where user_id=v_user.id and endpoint=p_endpoint;
  return true;
end $$;
revoke all on function public.app_cpe_push_unsubscribe(text,text) from public;
grant execute on function public.app_cpe_push_unsubscribe(text,text) to anon,authenticated;

create function public.app_cpe_push_claim(p_dispatch_token text,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_valid boolean; v_rows jsonb;
begin
  select dispatch_token=p_dispatch_token into v_valid from private.app_cpe_push_config where id=true;
  if coalesce(v_valid,false)=false then raise exception 'No autorizado'; end if;
  with claimed as (
    select d.id from private.app_cpe_push_deliveries d
    where d.state='pending' or (d.state='processing' and d.updated_at<now()-interval '5 minutes')
    order by d.id limit least(greatest(coalesce(p_limit,50),1),100) for update skip locked
  ), updated as (
    update private.app_cpe_push_deliveries d set state='processing',attempts=attempts+1,updated_at=now()
    from claimed c where d.id=c.id returning d.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'endpoint',s.endpoint,
      'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'title',n.title,
      'body',n.body,'notificationId',n.id,'targetTab',n.target_tab,'eventType',n.event_type)), '[]'::jsonb)
    into v_rows from updated d
    join private.app_cpe_push_subscriptions s on s.id=d.subscription_id
    join public.app_cpe_user_notifications n on n.id=d.notification_id;
  return jsonb_build_object('rows',v_rows);
end $$;
revoke all on function public.app_cpe_push_claim(text,integer) from public,anon,authenticated;
grant execute on function public.app_cpe_push_claim(text,integer) to service_role;

create function public.app_cpe_push_finish(p_dispatch_token text,p_id bigint,p_status integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_valid boolean;
begin
  select dispatch_token=p_dispatch_token into v_valid from private.app_cpe_push_config where id=true;
  if coalesce(v_valid,false)=false then raise exception 'No autorizado'; end if;
  if p_status in (404,410) then
    delete from private.app_cpe_push_subscriptions s using private.app_cpe_push_deliveries d
    where d.id=p_id and s.id=d.subscription_id;
  else
    update private.app_cpe_push_deliveries set
      state=case when p_status between 200 and 299 then 'sent'
        when attempts>=3 then 'failed' else 'pending' end, updated_at=now()
      where id=p_id;
  end if;
  return true;
end $$;
revoke all on function public.app_cpe_push_finish(text,bigint,integer) from public,anon,authenticated;
grant execute on function public.app_cpe_push_finish(text,bigint,integer) to service_role;

create function public.app_cpe_push_configure(p_dispatch_token text,p_public_key text,p_private_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_valid boolean;
begin
  select dispatch_token=p_dispatch_token into v_valid from private.app_cpe_push_config where id=true;
  if coalesce(v_valid,false)=false then raise exception 'No autorizado'; end if;
  update private.app_cpe_push_config set public_key=p_public_key,private_key=p_private_key
  where id=true and public_key is null;
  return true;
end $$;
revoke all on function public.app_cpe_push_configure(text,text,text) from public,anon,authenticated;
grant execute on function public.app_cpe_push_configure(text,text,text) to service_role;

create function public.app_cpe_push_private_config(p_dispatch_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_valid boolean; v_result jsonb;
begin
  select dispatch_token=p_dispatch_token into v_valid from private.app_cpe_push_config where id=true;
  if coalesce(v_valid,false)=false then raise exception 'No autorizado'; end if;
  select jsonb_build_object('publicKey',public_key,'privateKey',private_key) into v_result
    from private.app_cpe_push_config where id=true;
  return v_result;
end $$;
revoke all on function public.app_cpe_push_private_config(text) from public,anon,authenticated;
grant execute on function public.app_cpe_push_private_config(text) to service_role;

