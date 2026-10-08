-- Vacation offers use manually entered dates while portal data is unavailable.
-- Keep session, ownership, date, duplicate, and proposal checks intact.

CREATE OR REPLACE FUNCTION public.app_cpe_vacation_exchange_publish(p_token text, p_offered_start date, p_offered_end date, p_wanted_start date, p_wanted_end date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user public.app_cpe_users; v_id uuid; v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_offered_start is null or p_offered_end is null or p_wanted_start is null or p_wanted_end is null
    or p_offered_start <= v_today or p_wanted_start <= v_today
    or p_offered_end > v_today+365 or p_wanted_end > v_today+365
    or p_offered_start > p_offered_end or p_wanted_start > p_wanted_end
    or p_offered_end-p_offered_start <> p_wanted_end-p_wanted_start
    or p_offered_end-p_offered_start > 30 then
    raise exception 'Indica periodos futuros del mismo número de días (máximo 31)';
  end if;
  if (select count(*) from public.app_cpe_vacation_offers
      where owner_id=v_user.id and status='open'
        and offered_start > v_today and wanted_start > v_today) >= 20 then
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
$function$;

CREATE OR REPLACE FUNCTION public.app_cpe_vacation_exchange_update(p_token text, p_offer_id uuid, p_offered_start date, p_offered_end date, p_wanted_start date, p_wanted_end date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    or p_offered_start <= v_today or p_wanted_start <= v_today
    or p_offered_end > v_today+365 or p_wanted_end > v_today+365
    or p_offered_start > p_offered_end or p_wanted_start > p_wanted_end
    or p_offered_end-p_offered_start <> p_wanted_end-p_wanted_start
    or p_offered_end-p_offered_start > 30 then
    raise exception 'Indica periodos futuros del mismo número de días (máximo 31)';
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
$function$;

CREATE OR REPLACE FUNCTION public.app_cpe_vacation_exchange_propose(p_token text, p_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user public.app_cpe_users; v_offer public.app_cpe_vacation_offers; v_id uuid;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_offer from public.app_cpe_vacation_offers where id=p_offer_id for update;
  if v_offer.id is null or v_offer.status<>'open' or v_offer.offered_start<=v_today
    or v_offer.wanted_start<=v_today then raise exception 'La publicación ya no está disponible'; end if;
  if v_offer.owner_id=v_user.id then raise exception 'No puedes responder a tu propia publicación'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.app_cpe_vacation_exchange_decide(p_token text, p_proposal_id uuid, p_accept boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user public.app_cpe_users; v_offer public.app_cpe_vacation_offers;
  v_proposal public.app_cpe_vacation_proposals;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select o.* into v_offer from public.app_cpe_vacation_offers o
  join public.app_cpe_vacation_proposals p on p.offer_id=o.id
  where p.id=p_proposal_id for update of o;
  select * into v_proposal from public.app_cpe_vacation_proposals where id=p_proposal_id for update;
  if v_offer.id is null or v_offer.owner_id<>v_user.id or v_offer.status<>'open'
    or v_proposal.status<>'pending' then raise exception 'Propuesta no disponible'; end if;
  if coalesce(p_accept,false) then
    if v_offer.offered_start <= (now() at time zone 'Europe/Madrid')::date
      or v_offer.wanted_start <= (now() at time zone 'Europe/Madrid')::date then
      raise exception 'La publicación ha vencido';
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
$function$;
