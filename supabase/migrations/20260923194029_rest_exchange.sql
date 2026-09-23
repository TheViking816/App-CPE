-- Public offers, private proposals. App-CPE uses its own opaque session token,
-- so direct table access is denied and every exposed RPC validates that token.
create table public.app_cpe_rest_offers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_cpe_users(id) on delete cascade,
  kind text not null check (kind in ('swap', 'give', 'want')),
  offered_date date,
  wanted_date date,
  status text not null default 'open' check (status in ('open', 'agreed', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint app_cpe_rest_offer_dates check (
    (kind = 'swap' and offered_date is not null and wanted_date is not null and offered_date <> wanted_date)
    or (kind = 'give' and offered_date is not null and wanted_date is null)
    or (kind = 'want' and offered_date is null and wanted_date is not null)
  )
);

create table public.app_cpe_rest_proposals (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.app_cpe_rest_offers(id) on delete cascade,
  proposer_id uuid not null references public.app_cpe_users(id) on delete cascade,
  offered_date date,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now()
);

create index app_cpe_rest_offers_open_idx on public.app_cpe_rest_offers (created_at desc) where status = 'open';
create index app_cpe_rest_offers_owner_idx on public.app_cpe_rest_offers (owner_id, created_at desc);
create index app_cpe_rest_proposals_offer_idx on public.app_cpe_rest_proposals (offer_id, created_at desc);
create index app_cpe_rest_proposals_proposer_idx on public.app_cpe_rest_proposals (proposer_id, created_at desc);
create unique index app_cpe_rest_one_pending_proposal_idx
  on public.app_cpe_rest_proposals (offer_id, proposer_id) where status = 'pending';
create unique index app_cpe_rest_one_accepted_proposal_idx
  on public.app_cpe_rest_proposals (offer_id) where status = 'accepted';

alter table public.app_cpe_rest_offers enable row level security;
alter table public.app_cpe_rest_proposals enable row level security;
revoke all on public.app_cpe_rest_offers, public.app_cpe_rest_proposals from public, anon, authenticated;

alter table public.app_cpe_user_notifications
  drop constraint if exists app_cpe_user_notifications_event_type_check;
alter table public.app_cpe_user_notifications
  add constraint app_cpe_user_notifications_event_type_check check (event_type in (
    'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
    'rests_changed', 'vacations_changed', 'exceptions_changed',
    'rest_proposal', 'rest_response'
  ));

-- Returns NULL when the date is not present in the personal portal calendar.
-- A blank string means that the portal explicitly shows a working day.
create function public.app_cpe_rest_day_code(p_chapa text, p_date date)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_code text;
begin
  select s.payload into v_snapshot
  from public.app_cpe_portal_snapshots s where s.chapa = p_chapa;

  select coalesce(d.value ->> 'code', '') into v_code
  from jsonb_array_elements(coalesce(v_snapshot #> '{descansos,months}', '[]'::jsonb)) m(value)
  cross join lateral jsonb_array_elements(coalesce(m.value -> 'days', '[]'::jsonb)) d(value)
  where (m.value ->> 'year')::integer = extract(year from p_date)::integer
    and (m.value ->> 'month')::integer = extract(month from p_date)::integer
    and (d.value ->> 'day')::integer = extract(day from p_date)::integer
  limit 1;

  if v_code in ('DS', 'FS') and exists (
    select 1 from jsonb_array_elements(coalesce(v_snapshot #> '{vacaciones,rows}', '[]'::jsonb)) vacation(value)
    where vacation.value ->> 'inicio' ~ '^\d{1,2}/\d{1,2}/\d{4}$'
      and vacation.value ->> 'fin' ~ '^\d{1,2}/\d{1,2}/\d{4}$'
      and p_date between to_date(vacation.value ->> 'inicio', 'DD/MM/YYYY')
                     and to_date(vacation.value ->> 'fin', 'DD/MM/YYYY')
  ) then
    return 'VA';
  end if;
  return v_code;
end;
$$;

revoke all on function public.app_cpe_rest_day_code(text, date) from public, anon, authenticated;

create function public.app_cpe_rest_exchange_list(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_offers jsonb;
  v_proposals jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'kind', o.kind, 'offeredDate', o.offered_date,
    'wantedDate', o.wanted_date, 'status', o.status, 'createdAt', o.created_at,
    'isOwn', o.owner_id = v_user.id,
    'ownerName', coalesce(nullif(btrim(u.display_name), ''), 'Compañero'),
    'ownerGroup', s.payload #>> '{descansos,worker,group}'
  ) order by o.created_at desc), '[]'::jsonb) into v_offers
  from public.app_cpe_rest_offers o
  join public.app_cpe_users u on u.id = o.owner_id
  left join public.app_cpe_portal_snapshots s on s.chapa = u.chapa
  where o.status = 'open' or o.owner_id = v_user.id
    or exists (select 1 from public.app_cpe_rest_proposals p where p.offer_id = o.id and p.proposer_id = v_user.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'offerId', p.offer_id, 'status', p.status,
    'offeredDate', p.offered_date, 'createdAt', p.created_at,
    'isOwn', p.proposer_id = v_user.id,
    'proposerName', coalesce(nullif(btrim(proposer.display_name), ''), 'Compañero'),
    'counterpartChapa', case when p.status = 'accepted'
      then case when p.proposer_id = v_user.id then owner.chapa else proposer.chapa end
      else null end
  ) order by p.created_at desc), '[]'::jsonb) into v_proposals
  from public.app_cpe_rest_proposals p
  join public.app_cpe_rest_offers o on o.id = p.offer_id
  join public.app_cpe_users proposer on proposer.id = p.proposer_id
  join public.app_cpe_users owner on owner.id = o.owner_id
  where p.proposer_id = v_user.id or o.owner_id = v_user.id;

  return jsonb_build_object('offers', v_offers, 'proposals', v_proposals);
end;
$$;

create function public.app_cpe_rest_exchange_publish(
  p_token text, p_kind text, p_offered_date date, p_wanted_date date
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_id uuid;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_kind not in ('swap', 'give', 'want') or p_kind is null then
    raise exception 'Tipo de publicación no válido';
  end if;
  if (p_kind = 'swap' and (p_offered_date is null or p_wanted_date is null or p_offered_date = p_wanted_date))
    or (p_kind = 'give' and (p_offered_date is null or p_wanted_date is not null))
    or (p_kind = 'want' and (p_offered_date is not null or p_wanted_date is null)) then
    raise exception 'Selecciona los días correspondientes';
  end if;
  if (p_offered_date is not null and (p_offered_date < v_today or p_offered_date > v_today + 180))
    or (p_wanted_date is not null and (p_wanted_date < v_today or p_wanted_date > v_today + 180)) then
    raise exception 'Selecciona días futuros de los próximos seis meses';
  end if;
  if p_offered_date is not null and public.app_cpe_rest_day_code(v_user.chapa, p_offered_date) not in ('DS', 'FS') then
    raise exception 'Solo puedes ofrecer DS o FS confirmados en tu portal';
  end if;
  if p_offered_date is not null and public.app_cpe_rest_day_code(v_user.chapa, p_offered_date) is null then
    raise exception 'El día ofrecido no está confirmado en tu portal';
  end if;
  if p_wanted_date is not null and public.app_cpe_rest_day_code(v_user.chapa, p_wanted_date) is distinct from '' then
    raise exception 'El día que buscas debe figurar como laborable en tu portal';
  end if;
  if (select count(*) from public.app_cpe_rest_offers where owner_id = v_user.id and status = 'open') >= 20 then
    raise exception 'Tienes demasiadas publicaciones abiertas';
  end if;
  if exists (select 1 from public.app_cpe_rest_offers where owner_id = v_user.id
      and kind = p_kind and offered_date is not distinct from p_offered_date
      and wanted_date is not distinct from p_wanted_date and status = 'open') then
    raise exception 'Ya tienes publicada esa oferta';
  end if;
  insert into public.app_cpe_rest_offers (owner_id, kind, offered_date, wanted_date)
  values (v_user.id, p_kind, p_offered_date, p_wanted_date) returning id into v_id;
  return v_id;
end;
$$;

create function public.app_cpe_rest_exchange_propose(p_token text, p_offer_id uuid, p_offered_date date default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_offer public.app_cpe_rest_offers;
  v_id uuid;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_offer from public.app_cpe_rest_offers where id = p_offer_id for update;
  if v_offer.id is null or v_offer.status <> 'open' then raise exception 'La publicación ya no está disponible'; end if;
  if v_offer.owner_id = v_user.id then raise exception 'No puedes responder a tu propia publicación'; end if;
  if v_offer.offered_date < v_today or v_offer.wanted_date < v_today then
    raise exception 'La publicación ha vencido';
  end if;
  if v_offer.offered_date is not null
     and public.app_cpe_rest_day_code(v_user.chapa, v_offer.offered_date) is distinct from '' then
    raise exception 'El día ofrecido por el compañero debe ser laborable para ti';
  end if;
  if v_offer.kind = 'give' then
    if p_offered_date is not null then raise exception 'Una cesión no requiere otro día'; end if;
  else
    if p_offered_date is distinct from v_offer.wanted_date then
      raise exception 'Debes ofrecer el día solicitado en la publicación';
    end if;
    if public.app_cpe_rest_day_code(v_user.chapa, p_offered_date) is distinct from 'DS'
       and public.app_cpe_rest_day_code(v_user.chapa, p_offered_date) is distinct from 'FS' then
      raise exception 'Solo puedes proponer un DS o FS confirmado en tu portal';
    end if;
  end if;
  insert into public.app_cpe_rest_proposals (offer_id, proposer_id, offered_date)
  values (p_offer_id, v_user.id, p_offered_date) returning id into v_id;
  insert into public.app_cpe_user_notifications (
    user_id, chapa, event_type, title, body, entity_key, change_hash, target_tab, metadata
  )
  select owner.id, owner.chapa, 'rest_proposal', 'Nueva propuesta de descanso',
    'Un compañero ha respondido a tu publicación.', p_offer_id::text,
    v_id::text, 'descansos', jsonb_build_object('offerId', p_offer_id, 'proposalId', v_id)
  from public.app_cpe_users owner where owner.id = v_offer.owner_id;
  return v_id;
end;
$$;

create function public.app_cpe_rest_exchange_decide(p_token text, p_proposal_id uuid, p_accept boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_offer public.app_cpe_rest_offers;
  v_proposal public.app_cpe_rest_proposals;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select o.* into v_offer from public.app_cpe_rest_offers o
  join public.app_cpe_rest_proposals p on p.offer_id = o.id
  where p.id = p_proposal_id for update of o;
  select * into v_proposal from public.app_cpe_rest_proposals where id = p_proposal_id for update;
  if v_offer.id is null or v_offer.owner_id <> v_user.id or v_offer.status <> 'open'
     or v_proposal.status <> 'pending' then raise exception 'La propuesta ya no se puede gestionar'; end if;
  if coalesce(p_accept, false) then
    if v_offer.offered_date < (now() at time zone 'Europe/Madrid')::date
       or v_offer.wanted_date < (now() at time zone 'Europe/Madrid')::date then
      raise exception 'La publicación ha vencido';
    end if;
    if v_offer.offered_date is not null and public.app_cpe_rest_day_code(v_user.chapa, v_offer.offered_date) is distinct from 'DS'
       and v_offer.offered_date is not null and public.app_cpe_rest_day_code(v_user.chapa, v_offer.offered_date) is distinct from 'FS' then
      raise exception 'Tu descanso ya no está confirmado';
    end if;
    if v_offer.wanted_date is not null
       and public.app_cpe_rest_day_code(v_user.chapa, v_offer.wanted_date) is distinct from '' then
      raise exception 'El día solicitado ya no figura como laborable para ti';
    end if;
    if v_proposal.offered_date is not null and not exists (
      select 1 from public.app_cpe_users proposer
      where proposer.id = v_proposal.proposer_id
        and public.app_cpe_rest_day_code(proposer.chapa, v_proposal.offered_date) in ('DS', 'FS')
    ) then
      raise exception 'El descanso del compañero ya no está confirmado';
    end if;
    if v_offer.offered_date is not null and not exists (
      select 1 from public.app_cpe_users proposer
      where proposer.id = v_proposal.proposer_id
        and public.app_cpe_rest_day_code(proposer.chapa, v_offer.offered_date) = ''
    ) then
      raise exception 'El día ofrecido ya no figura como laborable para el compañero';
    end if;
    update public.app_cpe_rest_offers set status = 'agreed' where id = v_offer.id;
    update public.app_cpe_rest_proposals set status = case when id = p_proposal_id then 'accepted' else 'rejected' end
    where offer_id = v_offer.id and status = 'pending';
  else
    update public.app_cpe_rest_proposals set status = 'rejected' where id = p_proposal_id;
  end if;
  insert into public.app_cpe_user_notifications (
    user_id, chapa, event_type, title, body, entity_key, change_hash, target_tab, metadata
  )
  select proposer.id, proposer.chapa, 'rest_response',
    case when coalesce(p_accept, false) then 'Propuesta aceptada' else 'Propuesta rechazada' end,
    case when coalesce(p_accept, false)
      then 'Hablad en el portal oficial para tramitar el cambio. Aún no modifica tu calendario.'
      else 'Puedes buscar otra publicación en el tablón.' end,
    v_offer.id::text, p_proposal_id::text || case when coalesce(p_accept, false) then ':accepted' else ':rejected' end,
    'descansos', jsonb_build_object('offerId', v_offer.id, 'proposalId', p_proposal_id)
  from public.app_cpe_users proposer where proposer.id = v_proposal.proposer_id;
  return true;
end;
$$;

create function public.app_cpe_rest_exchange_cancel(p_token text, p_offer_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
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

create function public.app_cpe_rest_exchange_withdraw(p_token text, p_proposal_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  update public.app_cpe_rest_proposals set status = 'withdrawn'
  where id = p_proposal_id and proposer_id = v_user.id and status = 'pending';
  if not found then raise exception 'Solo puedes retirar tus propuestas pendientes'; end if;
  return true;
end;
$$;

revoke all on function public.app_cpe_rest_exchange_list(text) from public, anon, authenticated;
revoke all on function public.app_cpe_rest_exchange_publish(text, text, date, date) from public, anon, authenticated;
revoke all on function public.app_cpe_rest_exchange_propose(text, uuid, date) from public, anon, authenticated;
revoke all on function public.app_cpe_rest_exchange_decide(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.app_cpe_rest_exchange_cancel(text, uuid) from public, anon, authenticated;
revoke all on function public.app_cpe_rest_exchange_withdraw(text, uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_list(text) to anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_publish(text, text, date, date) to anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_propose(text, uuid, date) to anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_decide(text, uuid, boolean) to anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_cancel(text, uuid) to anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_withdraw(text, uuid) to anon, authenticated;
