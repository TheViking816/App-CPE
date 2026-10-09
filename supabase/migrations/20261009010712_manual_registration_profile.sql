alter table public.app_cpe_users
  add column if not exists professional_group text,
  add column if not exists rest_group text;

do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'app_cpe_users_professional_group_check') then
    alter table public.app_cpe_users add constraint app_cpe_users_professional_group_check
      check (professional_group is null or professional_group in ('I', 'II', 'III', 'IV'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'app_cpe_users_rest_group_check') then
    alter table public.app_cpe_users add constraint app_cpe_users_rest_group_check
      check (rest_group is null or rest_group in ('A - N', 'A - V', 'B - N', 'B - V', 'C - N', 'C - V'));
  end if;
end $$;

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
  if p_professional_group is null or p_professional_group not in ('I', 'II', 'III', 'IV') then
    raise exception 'Selecciona un grupo profesional válido';
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
revoke all on function private.app_cpe_validate_manual_profile(text, text, text[]) from public, anon, authenticated;

create or replace function public.app_cpe_public_user(p_user public.app_cpe_users, p_token text)
returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'token', p_token,
    'chapa', p_user.chapa,
    'email', p_user.email,
    'displayName', p_user.display_name,
    'forumShowChapa', p_user.forum_show_chapa,
    'specialties', p_user.specialties,
    'professionalGroup', p_user.professional_group,
    'restGroup', p_user.rest_group,
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

create or replace function public.app_cpe_register_manual_profile(
  p_chapa text, p_password text, p_email text,
  p_professional_group text, p_rest_group text, p_specialties text[]
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_chapa text; v_email text; v_token text;
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);
  v_email := lower(trim(coalesce(p_email, '')));
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Introduce un correo válido'; end if;
  perform private.app_cpe_validate_manual_profile(p_professional_group, p_rest_group, p_specialties);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_register:' || v_chapa, 0));
  if exists(select 1 from public.app_cpe_users where chapa = v_chapa) then
    raise exception 'Esa chapa ya está registrada; inicia sesión con tu cuenta';
  end if;
  insert into public.app_cpe_users
    (chapa, password_hash, specialties, email, professional_group, rest_group, portal_activation_status)
  values
    (v_chapa, extensions.crypt(p_password, extensions.gen_salt('bf')),
     p_specialties, v_email, p_professional_group, p_rest_group, 'active')
  returning * into v_user;
  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user, v_token);
end;
$$;
revoke all on function public.app_cpe_register_manual_profile(text,text,text,text,text,text[]) from public, anon, authenticated;
grant execute on function public.app_cpe_register_manual_profile(text,text,text,text,text,text[]) to anon, authenticated;

create or replace function public.app_cpe_update_manual_profile(
  p_token text, p_professional_group text, p_rest_group text, p_specialties text[]
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_updated public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  perform private.app_cpe_validate_manual_profile(p_professional_group, p_rest_group, p_specialties);
  update public.app_cpe_users set professional_group = p_professional_group,
    rest_group = p_rest_group, specialties = p_specialties, updated_at = now()
  where id = v_user.id returning * into v_updated;
  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;
revoke all on function public.app_cpe_update_manual_profile(text,text,text,text[]) from public, anon, authenticated;
grant execute on function public.app_cpe_update_manual_profile(text,text,text,text[]) to anon, authenticated;

create or replace function public.app_cpe_rest_exchange_list(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_offers jsonb; v_proposals jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'kind', o.kind, 'offeredDate', o.offered_date,
    'wantedDate', o.wanted_date, 'status', o.status, 'createdAt', o.created_at,
    'isOwn', o.owner_id = v_user.id,
    'ownerName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero'),
    'ownerChapa', u.chapa,
    'professionalGroup', coalesce(u.professional_group, s.payload #>> '{descansos,worker,professionalGroup}'),
    'ownerGroup', coalesce(u.rest_group, s.payload #>> '{descansos,worker,group}')
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
    'counterpartChapa', case when p.proposer_id = v_user.id then owner.chapa else proposer.chapa end
  ) order by p.created_at desc), '[]'::jsonb) into v_proposals
  from public.app_cpe_rest_proposals p
  join public.app_cpe_rest_offers o on o.id = p.offer_id
  join public.app_cpe_users proposer on proposer.id = p.proposer_id
  join public.app_cpe_users owner on owner.id = o.owner_id
  where p.proposer_id = v_user.id or o.owner_id = v_user.id;

  return jsonb_build_object('offers', v_offers, 'proposals', v_proposals);
end;
$$;

create or replace function public.app_cpe_vacation_exchange_list(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_offers jsonb; v_proposals jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'offeredStart', o.offered_start, 'offeredEnd', o.offered_end,
    'wantedStart', o.wanted_start, 'wantedEnd', o.wanted_end,
    'status', o.status, 'createdAt', o.created_at, 'isOwn', o.owner_id = v_user.id,
    'ownerName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero'),
    'ownerChapa', u.chapa,
    'professionalGroup', coalesce(u.professional_group, s.payload #>> '{descansos,worker,professionalGroup}'),
    'restGroup', coalesce(u.rest_group, s.payload #>> '{descansos,worker,group}')
  ) order by o.created_at desc), '[]'::jsonb) into v_offers
  from public.app_cpe_vacation_offers o
  join public.app_cpe_users u on u.id = o.owner_id
  left join public.app_cpe_portal_snapshots s on s.chapa = u.chapa
  where o.status = 'open' or o.owner_id = v_user.id
    or exists (select 1 from public.app_cpe_vacation_proposals p where p.offer_id = o.id and p.proposer_id = v_user.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'offerId', p.offer_id, 'status', p.status, 'createdAt', p.created_at,
    'isOwn', p.proposer_id = v_user.id,
    'proposerName', coalesce(nullif(split_part(btrim(proposer.display_name), ' ', 1), ''), 'Compañero'),
    'counterpartChapa', case when p.proposer_id = v_user.id then owner.chapa else proposer.chapa end
  ) order by p.created_at desc), '[]'::jsonb) into v_proposals
  from public.app_cpe_vacation_proposals p
  join public.app_cpe_vacation_offers o on o.id = p.offer_id
  join public.app_cpe_users proposer on proposer.id = p.proposer_id
  join public.app_cpe_users owner on owner.id = o.owner_id
  where p.proposer_id = v_user.id or o.owner_id = v_user.id;
  return jsonb_build_object('offers', v_offers, 'proposals', v_proposals);
end;
$$;
