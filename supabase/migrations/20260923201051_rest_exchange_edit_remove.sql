-- Keep only active or agreed publications. Removed offers disappear entirely.
delete from public.app_cpe_rest_offers where status = 'cancelled';

create or replace function public.app_cpe_rest_exchange_list(p_token text)
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
    'ownerName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero'),
    'ownerChapa', u.chapa,
    'professionalGroup', s.payload #>> '{descansos,worker,professionalGroup}',
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
    'proposerName', coalesce(nullif(split_part(btrim(proposer.display_name), ' ', 1), ''), 'Compañero'),
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

create or replace function public.app_cpe_rest_exchange_cancel(p_token text, p_offer_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  delete from public.app_cpe_rest_offers
  where id = p_offer_id and owner_id = v_user.id and status = 'open';
  if not found then raise exception 'Solo puedes retirar tus publicaciones abiertas'; end if;
  return true;
end;
$$;

create function public.app_cpe_rest_exchange_update(
  p_token text, p_offer_id uuid, p_kind text, p_offered_date date, p_wanted_date date
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_offer public.app_cpe_rest_offers;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_offer from public.app_cpe_rest_offers where id = p_offer_id for update;
  if v_offer.id is null or v_offer.owner_id <> v_user.id or v_offer.status <> 'open' then
    raise exception 'Solo puedes editar tus publicaciones abiertas';
  end if;
  if exists (select 1 from public.app_cpe_rest_proposals
    where offer_id = p_offer_id and status = 'pending') then
    raise exception 'Responde o rechaza las propuestas pendientes antes de editar';
  end if;
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
  if exists (select 1 from public.app_cpe_rest_offers where owner_id = v_user.id
      and id <> p_offer_id and kind = p_kind and offered_date is not distinct from p_offered_date
      and wanted_date is not distinct from p_wanted_date and status = 'open') then
    raise exception 'Ya tienes publicada esa oferta';
  end if;
  update public.app_cpe_rest_offers
  set kind = p_kind, offered_date = p_offered_date, wanted_date = p_wanted_date
  where id = p_offer_id;
  return true;
end;
$$;

revoke all on function public.app_cpe_rest_exchange_update(text, uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_update(text, uuid, text, date, date) to anon, authenticated;
