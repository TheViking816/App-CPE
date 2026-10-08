-- Rest offers are manually entered, while identity, date, ownership and proposal checks stay enforced.
CREATE OR REPLACE FUNCTION public.app_cpe_rest_exchange_publish(p_token text, p_kind text, p_offered_date date, p_wanted_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if (p_offered_date is not null and (p_offered_date <= v_today or p_offered_date > v_today + 180))
    or (p_wanted_date is not null and (p_wanted_date <= v_today or p_wanted_date > v_today + 180)) then
    raise exception 'Selecciona días futuros de los próximos seis meses';
  end if;
  if (select count(*) from public.app_cpe_rest_offers
      where owner_id = v_user.id and status = 'open'
        and (offered_date is null or offered_date > v_today)
        and (wanted_date is null or wanted_date > v_today)) >= 20 then
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
$function$;

CREATE OR REPLACE FUNCTION public.app_cpe_rest_exchange_update(p_token text, p_offer_id uuid, p_kind text, p_offered_date date, p_wanted_date date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if (p_offered_date is not null and (p_offered_date <= v_today or p_offered_date > v_today + 180))
    or (p_wanted_date is not null and (p_wanted_date <= v_today or p_wanted_date > v_today + 180)) then
    raise exception 'Selecciona días futuros de los próximos seis meses';
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
$function$;

CREATE OR REPLACE FUNCTION public.app_cpe_rest_exchange_propose(p_token text, p_offer_id uuid, p_offered_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_offer.offered_date <= v_today or v_offer.wanted_date <= v_today then
    raise exception 'La publicación ha vencido';
  end if;
  if v_offer.kind = 'give' then
    if p_offered_date is not null then raise exception 'Una cesión no requiere otro día'; end if;
  else
    if p_offered_date is distinct from v_offer.wanted_date then
      raise exception 'Debes ofrecer el día solicitado en la publicación';
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
$function$;

CREATE OR REPLACE FUNCTION public.app_cpe_rest_exchange_decide(p_token text, p_proposal_id uuid, p_accept boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if v_offer.offered_date <= (now() at time zone 'Europe/Madrid')::date
       or v_offer.wanted_date <= (now() at time zone 'Europe/Madrid')::date then
      raise exception 'La publicación ha vencido';
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
$function$;

