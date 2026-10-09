-- A portal-observed group is authoritative. Manual selection fills the gap for
-- workers whose portal snapshot is unavailable.
create or replace function private.app_cpe_effective_professional_group(p_user_id uuid)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    public.app_cpe_professional_group_code(s.payload #>> '{descansos,worker,professionalGroup}'),
    u.professional_group
  )
  from public.app_cpe_users u
  left join public.app_cpe_portal_snapshots s on s.chapa = u.chapa
  where u.id = p_user_id;
$$;

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
    'professionalGroupSource', case when exists (
      select 1 from public.app_cpe_portal_snapshots s
      where s.chapa = p_user.chapa
        and nullif(s.payload #>> '{descansos,worker,professionalGroup}', '') is not null
    ) then 'portal' else 'manual' end,
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
    'professionalGroup', private.app_cpe_effective_professional_group(u.id),
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
    'professionalGroup', private.app_cpe_effective_professional_group(u.id),
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
