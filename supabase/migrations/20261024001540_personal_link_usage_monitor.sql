create table private.app_cpe_personal_link_opens (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  section text not null check (section in (
    'donde-voy','vacaciones','dobles','jornales','descansos',
    'chapero','chapero-especialidades','puertas','jornada-contratada'
  )),
  opened_at timestamptz not null default now()
);
create index app_cpe_personal_link_opens_recent_idx on private.app_cpe_personal_link_opens(opened_at desc, id desc);
create index app_cpe_personal_link_opens_user_idx on private.app_cpe_personal_link_opens(user_id, opened_at desc);
alter table private.app_cpe_personal_link_opens enable row level security;
revoke all on private.app_cpe_personal_link_opens from public, anon, authenticated;

create function public.app_cpe_track_personal_link_open(p_token text, p_section text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_section is null or p_section not in (
    'donde-voy','vacaciones','dobles','jornales','descansos',
    'chapero','chapero-especialidades','puertas','jornada-contratada'
  ) then raise exception 'Sección no válida'; end if;
  if v_user.chapa = '72683' or exists (
    select 1 from public.app_cpe_sessions s
    where s.token_hash = pg_catalog.encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
      and s.expires_at > now() and s.is_support
  ) then return false; end if;
  insert into private.app_cpe_personal_link_opens(user_id, section) values(v_user.id, p_section);
  return true;
end;
$$;

create function public.app_cpe_admin_personal_link_monitor(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin public.app_cpe_users; v_recent jsonb; v_sections jsonb; v_opens bigint; v_users bigint;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa is distinct from '72683' then raise exception 'Acceso de administrador requerido'; end if;
  select count(*), count(distinct user_id) into v_opens,v_users
    from private.app_cpe_personal_link_opens where opened_at >= now() - interval '24 hours';
  select coalesce(jsonb_agg(to_jsonb(counts) order by counts.opens desc, counts.section), '[]'::jsonb)
    into v_sections from (
      select section,count(*) as opens from private.app_cpe_personal_link_opens
      where opened_at >= now() - interval '24 hours' group by section
    ) counts;
  select coalesce(jsonb_agg(to_jsonb(activity) order by activity.opened_at desc,activity.id desc), '[]'::jsonb)
    into v_recent from (
      select e.id,u.chapa,u.display_name,e.section,e.opened_at
      from private.app_cpe_personal_link_opens e join public.app_cpe_users u on u.id=e.user_id
      order by e.opened_at desc,e.id desc limit 200
    ) activity;
  return jsonb_build_object('opens24h',v_opens,'users24h',v_users,'sections',v_sections,'recent',v_recent);
end;
$$;

revoke all on function public.app_cpe_track_personal_link_open(text,text),
  public.app_cpe_admin_personal_link_monitor(text) from public, anon, authenticated;
grant execute on function public.app_cpe_track_personal_link_open(text,text),
  public.app_cpe_admin_personal_link_monitor(text) to anon, authenticated;
