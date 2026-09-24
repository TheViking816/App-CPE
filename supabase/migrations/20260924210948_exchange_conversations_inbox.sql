-- Keep conversations after an offer is removed, without showing it on the board.
alter table public.app_cpe_vacation_offers
  drop constraint app_cpe_vacation_offers_status_check;
alter table public.app_cpe_vacation_offers
  add constraint app_cpe_vacation_offers_status_check
  check (status in ('open', 'agreed', 'cancelled'));

create or replace function public.app_cpe_rest_exchange_cancel(p_token text, p_offer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  update public.app_cpe_rest_offers set status = 'cancelled'
  where id = p_offer_id and owner_id = v_user.id and status = 'open';
  if not found then raise exception 'Solo puedes retirar tus publicaciones abiertas'; end if;
  update public.app_cpe_rest_proposals set status = 'rejected'
  where offer_id = p_offer_id and status = 'pending';
  return true;
end;
$$;

create or replace function public.app_cpe_vacation_exchange_cancel(p_token text, p_offer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  update public.app_cpe_vacation_offers set status = 'cancelled'
  where id = p_offer_id and owner_id = v_user.id and status = 'open';
  if not found then raise exception 'Solo puedes eliminar tus publicaciones abiertas'; end if;
  update public.app_cpe_vacation_proposals set status = 'rejected'
  where offer_id = p_offer_id and status = 'pending';
  return true;
end;
$$;

-- Opaque app sessions are checked inside RPCs. No direct table access.
create table public.app_cpe_exchange_thread_reads (
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  exchange_type text not null check (exchange_type in ('rest', 'vacation')),
  proposal_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, exchange_type, proposal_id)
);
create index app_cpe_vacation_proposals_proposer_idx
  on public.app_cpe_vacation_proposals (proposer_id, created_at desc);
alter table public.app_cpe_exchange_thread_reads enable row level security;
revoke all on public.app_cpe_exchange_thread_reads from public, anon, authenticated;

create function public.app_cpe_exchange_threads(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_threads jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', t.exchange_type, 'proposalId', t.proposal_id, 'offerId', t.offer_id,
    'counterpartName', t.counterpart_name, 'counterpartChapa', t.counterpart_chapa,
    'status', t.proposal_status, 'offerStatus', t.offer_status,
    'offered', t.offered_label, 'wanted', t.wanted_label,
    'createdAt', t.created_at, 'lastAt', coalesce(t.message_at, t.created_at),
    'lastMessage', t.message_body, 'lastMessageIsOwn', t.message_sender_id = v_user.id,
    'unread', t.unread_count
  ) order by coalesce(t.message_at, t.created_at) desc), '[]'::jsonb) into v_threads
  from (
    select 'rest'::text exchange_type, p.id proposal_id, o.id offer_id,
      case when o.owner_id = v_user.id then coalesce(nullif(split_part(btrim(proposer.display_name), ' ', 1), ''), 'Compañero')
        else coalesce(nullif(split_part(btrim(owner.display_name), ' ', 1), ''), 'Compañero') end counterpart_name,
      case when p.status = 'accepted'
        then case when o.owner_id = v_user.id then proposer.chapa else owner.chapa end
        else null end counterpart_chapa,
      p.status proposal_status, o.status offer_status,
      case when o.owner_id = v_user.id then o.offered_date else p.offered_date end offered_label,
      case when o.owner_id = v_user.id then o.wanted_date else o.offered_date end wanted_label,
      p.created_at, lm.body message_body, lm.created_at message_at, lm.sender_id message_sender_id,
      (select count(*) from public.app_cpe_rest_messages m
       where m.proposal_id = p.id and m.sender_id <> v_user.id
         and m.created_at > coalesce(rd.last_read_at, '-infinity'::timestamptz)) unread_count
    from public.app_cpe_rest_proposals p
    join public.app_cpe_rest_offers o on o.id = p.offer_id
    join public.app_cpe_users owner on owner.id = o.owner_id
    join public.app_cpe_users proposer on proposer.id = p.proposer_id
    left join public.app_cpe_exchange_thread_reads rd on rd.user_id = v_user.id
      and rd.exchange_type = 'rest' and rd.proposal_id = p.id
    left join lateral (select m.body, m.created_at, m.sender_id
      from public.app_cpe_rest_messages m where m.proposal_id = p.id
      order by m.created_at desc limit 1) lm on true
    where o.owner_id = v_user.id or p.proposer_id = v_user.id
    union all
    select 'vacation'::text, p.id, o.id,
      case when o.owner_id = v_user.id then coalesce(nullif(split_part(btrim(proposer.display_name), ' ', 1), ''), 'Compañero')
        else coalesce(nullif(split_part(btrim(owner.display_name), ' ', 1), ''), 'Compañero') end,
      case when p.status = 'accepted'
        then case when o.owner_id = v_user.id then proposer.chapa else owner.chapa end
        else null end,
      p.status, o.status,
      case when o.owner_id = v_user.id then o.offered_start else o.wanted_start end,
      case when o.owner_id = v_user.id then o.wanted_start else o.offered_start end,
      p.created_at, lm.body, lm.created_at, lm.sender_id,
      (select count(*) from public.app_cpe_vacation_messages m
       where m.proposal_id = p.id and m.sender_id <> v_user.id
         and m.created_at > coalesce(rd.last_read_at, '-infinity'::timestamptz))
    from public.app_cpe_vacation_proposals p
    join public.app_cpe_vacation_offers o on o.id = p.offer_id
    join public.app_cpe_users owner on owner.id = o.owner_id
    join public.app_cpe_users proposer on proposer.id = p.proposer_id
    left join public.app_cpe_exchange_thread_reads rd on rd.user_id = v_user.id
      and rd.exchange_type = 'vacation' and rd.proposal_id = p.id
    left join lateral (select m.body, m.created_at, m.sender_id
      from public.app_cpe_vacation_messages m where m.proposal_id = p.id
      order by m.created_at desc limit 1) lm on true
    where o.owner_id = v_user.id or p.proposer_id = v_user.id
  ) t;
  return v_threads;
end;
$$;

create function public.app_cpe_exchange_mark_read(p_token text, p_type text, p_proposal_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_type = 'rest' then
    if not exists (select 1 from public.app_cpe_rest_proposals p
      join public.app_cpe_rest_offers o on o.id = p.offer_id
      where p.id = p_proposal_id and (p.proposer_id = v_user.id or o.owner_id = v_user.id)) then
      raise exception 'Conversación no disponible';
    end if;
  elsif p_type = 'vacation' then
    if not exists (select 1 from public.app_cpe_vacation_proposals p
      join public.app_cpe_vacation_offers o on o.id = p.offer_id
      where p.id = p_proposal_id and (p.proposer_id = v_user.id or o.owner_id = v_user.id)) then
      raise exception 'Conversación no disponible';
    end if;
  else
    raise exception 'Tipo de conversación incorrecto';
  end if;
  insert into public.app_cpe_exchange_thread_reads(user_id, exchange_type, proposal_id, last_read_at)
  values(v_user.id, p_type, p_proposal_id, now())
  on conflict (user_id, exchange_type, proposal_id) do update
    set last_read_at = greatest(public.app_cpe_exchange_thread_reads.last_read_at, excluded.last_read_at);
  return true;
end;
$$;

revoke all on function public.app_cpe_exchange_threads(text) from public, anon, authenticated;
revoke all on function public.app_cpe_exchange_mark_read(text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_exchange_threads(text) to anon, authenticated;
grant execute on function public.app_cpe_exchange_mark_read(text, text, uuid) to anon, authenticated;
