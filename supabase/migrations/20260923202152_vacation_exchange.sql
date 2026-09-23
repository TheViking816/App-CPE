-- Vacation swaps are separate from DS/FS transfers. Each side gives and
-- receives the same number of calendar days; professional/rest groups are
-- informational, not an eligibility restriction.
create table public.app_cpe_vacation_offers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_cpe_users(id) on delete cascade,
  offered_start date not null,
  offered_end date not null,
  wanted_start date not null,
  wanted_end date not null,
  status text not null default 'open' check (status in ('open','agreed')),
  created_at timestamptz not null default now(),
  constraint app_cpe_vacation_offer_dates check (
    offered_start <= offered_end and wanted_start <= wanted_end
    and offered_end - offered_start = wanted_end - wanted_start
  )
);
create index app_cpe_vacation_offers_open_idx on public.app_cpe_vacation_offers(created_at desc) where status='open';
create index app_cpe_vacation_offers_owner_idx on public.app_cpe_vacation_offers(owner_id,created_at desc);

create table public.app_cpe_vacation_proposals (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.app_cpe_vacation_offers(id) on delete cascade,
  proposer_id uuid not null references public.app_cpe_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  created_at timestamptz not null default now()
);
create index app_cpe_vacation_proposals_offer_idx on public.app_cpe_vacation_proposals(offer_id,created_at desc);
create unique index app_cpe_vacation_one_pending_idx on public.app_cpe_vacation_proposals(offer_id,proposer_id) where status='pending';
create unique index app_cpe_vacation_one_accepted_idx on public.app_cpe_vacation_proposals(offer_id) where status='accepted';

create table public.app_cpe_vacation_messages (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.app_cpe_vacation_proposals(id) on delete cascade,
  sender_id uuid not null references public.app_cpe_users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index app_cpe_vacation_messages_thread_idx on public.app_cpe_vacation_messages(proposal_id,created_at);
create index app_cpe_vacation_messages_sender_idx on public.app_cpe_vacation_messages(sender_id,created_at desc);

alter table public.app_cpe_vacation_offers enable row level security;
alter table public.app_cpe_vacation_proposals enable row level security;
alter table public.app_cpe_vacation_messages enable row level security;
revoke all on public.app_cpe_vacation_offers, public.app_cpe_vacation_proposals,
  public.app_cpe_vacation_messages from public, anon, authenticated;

alter table public.app_cpe_user_notifications
  drop constraint if exists app_cpe_user_notifications_event_type_check;
alter table public.app_cpe_user_notifications
  add constraint app_cpe_user_notifications_event_type_check check (event_type in (
    'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
    'rests_changed', 'vacations_changed', 'exceptions_changed',
    'rest_proposal', 'rest_response', 'rest_message',
    'vacation_proposal', 'vacation_response', 'vacation_message'
  ));

create function public.app_cpe_vacation_period_is(p_chapa text, p_start date, p_end date, p_vacation boolean)
returns boolean
language sql security definer set search_path = ''
as $$
  select p_start is not null and p_end is not null and p_start <= p_end
    and p_end - p_start <= 30
    and not exists (
      select 1 from pg_catalog.generate_series(p_start,p_end,interval '1 day') d(day)
      where case when p_vacation
        then public.app_cpe_rest_day_code(p_chapa,d.day::date) is distinct from 'VA'
        else public.app_cpe_rest_day_code(p_chapa,d.day::date) = 'VA' end
    );
$$;
revoke all on function public.app_cpe_vacation_period_is(text,date,date,boolean) from public,anon,authenticated;

create function public.app_cpe_vacation_exchange_list(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users; v_offers jsonb; v_proposals jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'offeredStart',o.offered_start,'offeredEnd',o.offered_end,
    'wantedStart',o.wanted_start,'wantedEnd',o.wanted_end,
    'status',o.status,'createdAt',o.created_at,'isOwn',o.owner_id=v_user.id,
    'ownerName',coalesce(nullif(split_part(btrim(u.display_name),' ',1),''),'Compañero'),
    'ownerChapa',u.chapa,
    'professionalGroup',s.payload #>> '{descansos,worker,professionalGroup}',
    'restGroup',s.payload #>> '{descansos,worker,group}'
  ) order by o.created_at desc),'[]'::jsonb) into v_offers
  from public.app_cpe_vacation_offers o
  join public.app_cpe_users u on u.id=o.owner_id
  left join public.app_cpe_portal_snapshots s on s.chapa=u.chapa
  where o.status='open' or o.owner_id=v_user.id
    or exists (select 1 from public.app_cpe_vacation_proposals p
               where p.offer_id=o.id and p.proposer_id=v_user.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'offerId',p.offer_id,'status',p.status,'createdAt',p.created_at,
    'isOwn',p.proposer_id=v_user.id,
    'proposerName',coalesce(nullif(split_part(btrim(proposer.display_name),' ',1),''),'Compañero'),
    'counterpartChapa',case when p.status='accepted'
      then case when p.proposer_id=v_user.id then owner.chapa else proposer.chapa end
      else null end
  ) order by p.created_at desc),'[]'::jsonb) into v_proposals
  from public.app_cpe_vacation_proposals p
  join public.app_cpe_vacation_offers o on o.id=p.offer_id
  join public.app_cpe_users proposer on proposer.id=p.proposer_id
  join public.app_cpe_users owner on owner.id=o.owner_id
  where p.proposer_id=v_user.id or o.owner_id=v_user.id;
  return jsonb_build_object('offers',v_offers,'proposals',v_proposals);
end;
$$;

create function public.app_cpe_vacation_exchange_publish(
  p_token text,p_offered_start date,p_offered_end date,p_wanted_start date,p_wanted_end date
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users; v_id uuid; v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_offered_start is null or p_offered_end is null or p_wanted_start is null or p_wanted_end is null
    or p_offered_start < v_today or p_wanted_start < v_today
    or p_offered_end > v_today+365 or p_wanted_end > v_today+365
    or p_offered_start > p_offered_end or p_wanted_start > p_wanted_end
    or p_offered_end-p_offered_start <> p_wanted_end-p_wanted_start
    or p_offered_end-p_offered_start > 30 then
    raise exception 'Indica periodos futuros del mismo número de días (máximo 31)';
  end if;
  if not public.app_cpe_vacation_period_is(v_user.chapa,p_offered_start,p_offered_end,true) then
    raise exception 'Todos los días ofrecidos deben ser vacaciones asignadas en tu portal';
  end if;
  if not public.app_cpe_vacation_period_is(v_user.chapa,p_wanted_start,p_wanted_end,false) then
    raise exception 'El periodo que buscas ya contiene vacaciones asignadas';
  end if;
  if (select count(*) from public.app_cpe_vacation_offers where owner_id=v_user.id and status='open') >= 20 then
    raise exception 'Tienes demasiadas publicaciones abiertas';
  end if;
  if exists (select 1 from public.app_cpe_vacation_offers where owner_id=v_user.id and status='open'
    and offered_start=p_offered_start and offered_end=p_offered_end
    and wanted_start=p_wanted_start and wanted_end=p_wanted_end) then
    raise exception 'Ya tienes publicada esa oferta';
  end if;
  insert into public.app_cpe_vacation_offers(owner_id,offered_start,offered_end,wanted_start,wanted_end)
  values(v_user.id,p_offered_start,p_offered_end,p_wanted_start,p_wanted_end) returning id into v_id;
  return v_id;
end;
$$;

create function public.app_cpe_vacation_exchange_update(
  p_token text,p_offer_id uuid,p_offered_start date,p_offered_end date,p_wanted_start date,p_wanted_end date
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users; v_offer public.app_cpe_vacation_offers; v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_offer from public.app_cpe_vacation_offers where id=p_offer_id for update;
  if v_offer.id is null or v_offer.owner_id<>v_user.id or v_offer.status<>'open' then
    raise exception 'Solo puedes editar tus publicaciones abiertas';
  end if;
  if exists (select 1 from public.app_cpe_vacation_proposals where offer_id=p_offer_id and status='pending') then
    raise exception 'Responde o rechaza las propuestas pendientes antes de editar';
  end if;
  if p_offered_start is null or p_offered_end is null or p_wanted_start is null or p_wanted_end is null
    or p_offered_start < v_today or p_wanted_start < v_today
    or p_offered_end > v_today+365 or p_wanted_end > v_today+365
    or p_offered_start > p_offered_end or p_wanted_start > p_wanted_end
    or p_offered_end-p_offered_start <> p_wanted_end-p_wanted_start
    or p_offered_end-p_offered_start > 30 then
    raise exception 'Indica periodos futuros del mismo número de días (máximo 31)';
  end if;
  if not public.app_cpe_vacation_period_is(v_user.chapa,p_offered_start,p_offered_end,true) then
    raise exception 'Todos los días ofrecidos deben ser vacaciones asignadas en tu portal';
  end if;
  if not public.app_cpe_vacation_period_is(v_user.chapa,p_wanted_start,p_wanted_end,false) then
    raise exception 'El periodo que buscas ya contiene vacaciones asignadas';
  end if;
  if exists (select 1 from public.app_cpe_vacation_offers where owner_id=v_user.id and id<>p_offer_id and status='open'
    and offered_start=p_offered_start and offered_end=p_offered_end
    and wanted_start=p_wanted_start and wanted_end=p_wanted_end) then
    raise exception 'Ya tienes publicada esa oferta';
  end if;
  update public.app_cpe_vacation_offers set offered_start=p_offered_start,offered_end=p_offered_end,
    wanted_start=p_wanted_start,wanted_end=p_wanted_end where id=p_offer_id;
  return true;
end;
$$;

create function public.app_cpe_vacation_exchange_propose(p_token text,p_offer_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users; v_offer public.app_cpe_vacation_offers; v_id uuid;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_offer from public.app_cpe_vacation_offers where id=p_offer_id for update;
  if v_offer.id is null or v_offer.status<>'open' or v_offer.offered_start<v_today
    or v_offer.wanted_start<v_today then raise exception 'La publicación ya no está disponible'; end if;
  if v_offer.owner_id=v_user.id then raise exception 'No puedes responder a tu propia publicación'; end if;
  if not public.app_cpe_vacation_period_is(v_user.chapa,v_offer.wanted_start,v_offer.wanted_end,true) then
    raise exception 'El periodo solicitado debe ser vacaciones asignadas para ti';
  end if;
  if not public.app_cpe_vacation_period_is(v_user.chapa,v_offer.offered_start,v_offer.offered_end,false) then
    raise exception 'El periodo ofrecido ya contiene vacaciones asignadas para ti';
  end if;
  insert into public.app_cpe_vacation_proposals(offer_id,proposer_id)
  values(p_offer_id,v_user.id) returning id into v_id;
  insert into public.app_cpe_user_notifications
    (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata)
  select owner.id,owner.chapa,'vacation_proposal','Nueva propuesta de vacaciones',
    'Un compañero ha respondido a tu intercambio de vacaciones.',p_offer_id::text,v_id::text,
    'vacaciones',jsonb_build_object('offerId',p_offer_id,'proposalId',v_id)
  from public.app_cpe_users owner where owner.id=v_offer.owner_id;
  return v_id;
end;
$$;

create function public.app_cpe_vacation_exchange_decide(p_token text,p_proposal_id uuid,p_accept boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users; v_offer public.app_cpe_vacation_offers;
  v_proposal public.app_cpe_vacation_proposals; v_proposer public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select o.* into v_offer from public.app_cpe_vacation_offers o
  join public.app_cpe_vacation_proposals p on p.offer_id=o.id
  where p.id=p_proposal_id for update of o;
  select * into v_proposal from public.app_cpe_vacation_proposals where id=p_proposal_id for update;
  if v_offer.id is null or v_offer.owner_id<>v_user.id or v_offer.status<>'open'
    or v_proposal.status<>'pending' then raise exception 'Propuesta no disponible'; end if;
  if coalesce(p_accept,false) then
    select * into v_proposer from public.app_cpe_users where id=v_proposal.proposer_id;
    if not public.app_cpe_vacation_period_is(v_user.chapa,v_offer.offered_start,v_offer.offered_end,true)
      or not public.app_cpe_vacation_period_is(v_user.chapa,v_offer.wanted_start,v_offer.wanted_end,false)
      or not public.app_cpe_vacation_period_is(v_proposer.chapa,v_offer.wanted_start,v_offer.wanted_end,true)
      or not public.app_cpe_vacation_period_is(v_proposer.chapa,v_offer.offered_start,v_offer.offered_end,false) then
      raise exception 'Las vacaciones ya no coinciden con el portal';
    end if;
    update public.app_cpe_vacation_offers set status='agreed' where id=v_offer.id;
    update public.app_cpe_vacation_proposals
      set status=case when id=p_proposal_id then 'accepted' else 'rejected' end
      where offer_id=v_offer.id and status='pending';
  else
    update public.app_cpe_vacation_proposals set status='rejected' where id=p_proposal_id;
  end if;
  insert into public.app_cpe_user_notifications
    (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata)
  select proposer.id,proposer.chapa,'vacation_response',
    case when coalesce(p_accept,false) then 'Intercambio de vacaciones acordado' else 'Propuesta de vacaciones rechazada' end,
    case when coalesce(p_accept,false) then 'Tramitad y confirmad el intercambio en el Portal CPE.'
      else 'Puedes buscar otra publicación en el tablón.' end,
    v_offer.id::text,p_proposal_id::text || case when coalesce(p_accept,false) then ':accepted' else ':rejected' end,
    'vacaciones',jsonb_build_object('offerId',v_offer.id,'proposalId',p_proposal_id)
  from public.app_cpe_users proposer where proposer.id=v_proposal.proposer_id;
  return true;
end;
$$;

create function public.app_cpe_vacation_exchange_cancel(p_token text,p_offer_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  delete from public.app_cpe_vacation_offers where id=p_offer_id and owner_id=v_user.id and status='open';
  if not found then raise exception 'Solo puedes eliminar tus publicaciones abiertas'; end if;
  return true;
end;
$$;

create function public.app_cpe_vacation_exchange_withdraw(p_token text,p_proposal_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  update public.app_cpe_vacation_proposals set status='withdrawn'
  where id=p_proposal_id and proposer_id=v_user.id and status='pending';
  if not found then raise exception 'Solo puedes retirar tus propuestas pendientes'; end if;
  return true;
end;
$$;

create function public.app_cpe_vacation_exchange_messages(p_token text,p_proposal_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users; v_proposer_id uuid; v_owner_id uuid; v_messages jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select p.proposer_id,o.owner_id into v_proposer_id,v_owner_id
  from public.app_cpe_vacation_proposals p
  join public.app_cpe_vacation_offers o on o.id=p.offer_id where p.id=p_proposal_id;
  if v_user.id is distinct from v_proposer_id and v_user.id is distinct from v_owner_id then
    raise exception 'Conversación no disponible';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'body',m.body,'createdAt',m.created_at,'isOwn',m.sender_id=v_user.id,
    'senderName',coalesce(nullif(split_part(btrim(u.display_name),' ',1),''),'Compañero')
  ) order by m.created_at,m.id),'[]'::jsonb) into v_messages
  from (select * from public.app_cpe_vacation_messages where proposal_id=p_proposal_id
        order by created_at desc,id desc limit 200) m
  join public.app_cpe_users u on u.id=m.sender_id;
  return v_messages;
end;
$$;

create function public.app_cpe_vacation_exchange_send_message(p_token text,p_proposal_id uuid,p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_user public.app_cpe_users; v_proposal public.app_cpe_vacation_proposals;
  v_owner_id uuid; v_offer_status text; v_recipient_id uuid; v_message_id uuid;
  v_body text := btrim(coalesce(p_body,''));
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_proposal from public.app_cpe_vacation_proposals where id=p_proposal_id for update;
  select owner_id,status into v_owner_id,v_offer_status
  from public.app_cpe_vacation_offers where id=v_proposal.offer_id;
  if v_proposal.id is null or (v_user.id<>v_proposal.proposer_id and v_user.id<>v_owner_id)
    or v_proposal.status not in ('pending','accepted') or v_offer_status not in ('open','agreed') then
    raise exception 'Conversación no disponible';
  end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'El mensaje debe tener entre 1 y 500 caracteres';
  end if;
  if exists (select 1 from public.app_cpe_vacation_messages where sender_id=v_user.id
    and created_at>now()-interval '3 seconds')
    or (select count(*) from public.app_cpe_vacation_messages where sender_id=v_user.id
      and created_at>now()-interval '1 hour')>=30 then
    raise exception 'Espera antes de enviar otro mensaje';
  end if;
  v_recipient_id := case when v_user.id=v_owner_id then v_proposal.proposer_id else v_owner_id end;
  insert into public.app_cpe_vacation_messages(proposal_id,sender_id,body)
  values(p_proposal_id,v_user.id,v_body) returning id into v_message_id;
  insert into public.app_cpe_user_notifications
    (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata)
  select recipient.id,recipient.chapa,'vacation_message','Nuevo mensaje privado',
    'Un compañero te ha escrito sobre un intercambio de vacaciones.',
    v_proposal.offer_id::text,v_message_id::text,'vacaciones',
    jsonb_build_object('offerId',v_proposal.offer_id,'proposalId',p_proposal_id)
  from public.app_cpe_users recipient where recipient.id=v_recipient_id;
  return v_message_id;
end;
$$;

create function public.app_cpe_vacation_offer_rate_limit()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.app_cpe_vacation_offers
    where owner_id=new.owner_id and created_at>now()-interval '10 seconds')
    or (select count(*) from public.app_cpe_vacation_offers
      where owner_id=new.owner_id and created_at>now()-interval '24 hours')>=30 then
    raise exception 'Espera antes de publicar otra oferta';
  end if;
  return new;
end;
$$;
create trigger app_cpe_vacation_offer_rate_limit before insert on public.app_cpe_vacation_offers
for each row execute function public.app_cpe_vacation_offer_rate_limit();
revoke all on function public.app_cpe_vacation_offer_rate_limit() from public,anon,authenticated;

create function public.app_cpe_vacation_proposal_rate_limit()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.app_cpe_vacation_proposals
    where proposer_id=new.proposer_id and created_at>now()-interval '10 seconds')
    or (select count(*) from public.app_cpe_vacation_proposals
      where proposer_id=new.proposer_id and created_at>now()-interval '24 hours')>=40 then
    raise exception 'Espera antes de enviar otra propuesta';
  end if;
  return new;
end;
$$;
create trigger app_cpe_vacation_proposal_rate_limit before insert on public.app_cpe_vacation_proposals
for each row execute function public.app_cpe_vacation_proposal_rate_limit();
revoke all on function public.app_cpe_vacation_proposal_rate_limit() from public,anon,authenticated;

revoke all on function public.app_cpe_vacation_exchange_list(text) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_publish(text,date,date,date,date) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_update(text,uuid,date,date,date,date) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_propose(text,uuid) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_decide(text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_cancel(text,uuid) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_withdraw(text,uuid) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_messages(text,uuid) from public,anon,authenticated;
revoke all on function public.app_cpe_vacation_exchange_send_message(text,uuid,text) from public,anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_list(text) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_publish(text,date,date,date,date) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_update(text,uuid,date,date,date,date) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_propose(text,uuid) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_decide(text,uuid,boolean) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_cancel(text,uuid) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_withdraw(text,uuid) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_messages(text,uuid) to anon,authenticated;
grant execute on function public.app_cpe_vacation_exchange_send_message(text,uuid,text) to anon,authenticated;
