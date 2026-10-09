-- Professional group is the portal vacation compatibility group (G-A, G-D,
-- G-III, SIN-F...), distinct from the salary calculation groups I-IV.
alter table public.app_cpe_users drop constraint if exists app_cpe_users_professional_group_check;
alter table public.app_cpe_users add constraint app_cpe_users_professional_group_check
  check (professional_group is null or professional_group ~ '^(G-[A-Z0-9]{1,5}|SIN-[A-Z0-9]{1,5})$');

create or replace function public.app_cpe_professional_group_code(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(btrim(coalesce(
    (regexp_match(coalesce(p_value, ''), '^[[:space:]]*\([[:space:]]*([A-Za-z0-9-]+)[[:space:]]*\)'))[1],
    p_value, ''
  ))), '');
$$;

create or replace function private.app_cpe_validate_manual_profile(
  p_professional_group text, p_rest_group text, p_specialties text[]
) returns void language plpgsql set search_path = '' as $$
declare
  v_allowed text[] := array[
    'conductor-1a', 'conductor-2a', 'clasificador', 'trastainers-rtt',
    'pol-conductor-1a', 'pol-conductor-2a', 'pol-especialista',
    'pol-trincador', 'pol-trinca-coches', 'mafis', 'apoyo-operacion',
    'container', 'pol-capataz', 'pol-sobordista', 'pol-elevadoras',
    'pol-reserva-g-iv'
  ];
begin
  if p_professional_group is null
    or p_professional_group !~ '^(G-[A-Z0-9]{1,5}|SIN-[A-Z0-9]{1,5})$' then
    raise exception 'Selecciona el grupo profesional que figura en el portal';
  end if;
  if p_rest_group is null or p_rest_group not in ('A - N', 'A - V', 'B - N', 'B - V', 'C - N', 'C - V') then
    raise exception 'Selecciona un grupo de descansos válido';
  end if;
  if coalesce(cardinality(p_specialties), 0) < 1
    or coalesce(cardinality(p_specialties), 0) > cardinality(v_allowed)
    or array_position(p_specialties, null) is not null
    or not coalesce(p_specialties <@ v_allowed, false)
    or (select count(distinct value) from unnest(p_specialties) as value) <> cardinality(p_specialties) then
    raise exception 'Selecciona al menos una especialidad válida';
  end if;
end;
$$;

create or replace function private.app_cpe_effective_professional_group(p_user_id uuid)
returns text language sql stable set search_path = '' as $$
  select public.app_cpe_professional_group_code(coalesce(
    u.professional_group, s.payload #>> '{descansos,worker,professionalGroup}'
  ))
  from public.app_cpe_users u
  left join public.app_cpe_portal_snapshots s on s.chapa = u.chapa
  where u.id = p_user_id;
$$;
revoke all on function private.app_cpe_effective_professional_group(uuid) from public, anon, authenticated;

create or replace function public.app_cpe_public_user(p_user public.app_cpe_users, p_token text)
returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'token', p_token,
    'chapa', p_user.chapa,
    'email', p_user.email,
    'displayName', p_user.display_name,
    'forumShowChapa', p_user.forum_show_chapa,
    'specialties', p_user.specialties,
    'professionalGroup', private.app_cpe_effective_professional_group(p_user.id),
    'restGroup', coalesce(p_user.rest_group, (
      select s.payload #>> '{descansos,worker,group}'
      from public.app_cpe_portal_snapshots s where s.chapa = p_user.chapa
    )),
    'irpfRate', p_user.irpf_rate,
    'portalActivationStatus', p_user.portal_activation_status,
    'portalActivatedAt', p_user.portal_activated_at,
    'createdAt', p_user.created_at,
    'supportAccess', coalesce((
      select s.is_support from public.app_cpe_sessions s
      where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
        and s.expires_at > now() limit 1
    ), false)
  );
$$;

create or replace function public.app_cpe_vacation_exchange_publish(
  p_token text, p_offered_start date, p_offered_end date,
  p_wanted_start date, p_wanted_end date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_id uuid;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if private.app_cpe_effective_professional_group(v_user.id) is null then
    raise exception 'Indica tu grupo profesional del portal en Ajustes → Mis datos';
  end if;
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
$$;

create or replace function public.app_cpe_vacation_exchange_propose(p_token text, p_offer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_offer public.app_cpe_vacation_offers; v_id uuid;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_user_group text; v_owner_group text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_offer from public.app_cpe_vacation_offers where id=p_offer_id for update;
  if v_offer.id is null or v_offer.status<>'open' or v_offer.offered_start<=v_today
    or v_offer.wanted_start<=v_today then raise exception 'La publicación ya no está disponible'; end if;
  if v_offer.owner_id=v_user.id then raise exception 'No puedes responder a tu propia publicación'; end if;
  v_user_group := private.app_cpe_effective_professional_group(v_user.id);
  v_owner_group := private.app_cpe_effective_professional_group(v_offer.owner_id);
  if v_user_group is null or v_owner_group is null or v_user_group <> v_owner_group then
    raise exception 'Solo puedes intercambiar vacaciones con tu mismo grupo profesional';
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

create or replace function public.app_cpe_vacation_exchange_decide(
  p_token text, p_proposal_id uuid, p_accept boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_offer public.app_cpe_vacation_offers;
  v_proposal public.app_cpe_vacation_proposals;
  v_owner_group text; v_proposer_group text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select o.* into v_offer from public.app_cpe_vacation_offers o
  join public.app_cpe_vacation_proposals p on p.offer_id=o.id
  where p.id=p_proposal_id for update of o;
  select * into v_proposal from public.app_cpe_vacation_proposals where id=p_proposal_id for update;
  if v_offer.id is null or v_offer.owner_id<>v_user.id or v_offer.status<>'open'
    or v_proposal.status<>'pending' then raise exception 'Propuesta no disponible'; end if;
  if coalesce(p_accept,false) then
    v_owner_group := private.app_cpe_effective_professional_group(v_offer.owner_id);
    v_proposer_group := private.app_cpe_effective_professional_group(v_proposal.proposer_id);
    if v_owner_group is null or v_proposer_group is null or v_owner_group <> v_proposer_group then
      raise exception 'Solo puedes aceptar intercambios de vacaciones de tu mismo grupo profesional';
    end if;
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
$$;
