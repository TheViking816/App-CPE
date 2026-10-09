-- A portal group is the default until the worker chooses a different one.
alter table public.app_cpe_users
  add column if not exists professional_group_user_override boolean not null default false;

create or replace function private.app_cpe_effective_professional_group(p_user_id uuid)
returns text language sql stable set search_path = '' as $$
  select case when u.professional_group_user_override
    then u.professional_group
    else coalesce(
      public.app_cpe_professional_group_code(s.payload #>> '{descansos,worker,professionalGroup}'),
      u.professional_group
    ) end
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
    'professionalGroupSource', case
      when p_user.professional_group_user_override then 'manual'
      when exists (
        select 1 from public.app_cpe_portal_snapshots s
        where s.chapa = p_user.chapa
          and public.app_cpe_professional_group_code(s.payload #>> '{descansos,worker,professionalGroup}') is not null
      ) then 'portal'
      else 'manual' end,
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

create or replace function public.app_cpe_update_manual_profile(
  p_token text, p_professional_group text, p_rest_group text, p_specialties text[]
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
  v_portal_group text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  perform private.app_cpe_validate_manual_profile(p_professional_group, p_rest_group, p_specialties);
  select public.app_cpe_professional_group_code(s.payload #>> '{descansos,worker,professionalGroup}')
    into v_portal_group
    from public.app_cpe_portal_snapshots s where s.chapa = v_user.chapa;
  update public.app_cpe_users
    set professional_group = p_professional_group,
      professional_group_user_override = p_professional_group is distinct from v_portal_group,
      rest_group = p_rest_group,
      specialties = p_specialties,
      updated_at = now()
    where id = v_user.id returning * into v_updated;
  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;
