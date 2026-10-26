create table private.app_cpe_part_opens (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  parte text not null,
  work_date date not null,
  shift text not null,
  opened_at timestamptz not null default now()
);
create index app_cpe_part_opens_recent_idx on private.app_cpe_part_opens(opened_at desc, id desc);
alter table private.app_cpe_part_opens enable row level security;
revoke all on private.app_cpe_part_opens from public, anon, authenticated;

create function public.app_cpe_track_part_open(p_token text, p_parte text, p_work_date date, p_shift text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa = '72683' or exists (
    select 1 from public.app_cpe_sessions s
    where s.token_hash = pg_catalog.encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
      and s.expires_at > now() and s.is_support
  ) then return false; end if;
  if p_parte !~ '^[0-9]{1,12}$' or p_work_date is null or p_shift !~ '^[0-9]{2}-[0-9]{2}$' then
    raise exception 'Parte no válido';
  end if;
  insert into private.app_cpe_part_opens(user_id, parte, work_date, shift)
  values(v_user.id, p_parte, p_work_date, p_shift);
  return true;
end;
$$;

create function public.app_cpe_admin_part_open_monitor(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin public.app_cpe_users; v_recent jsonb;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa is distinct from '72683' then raise exception 'Acceso de administrador requerido'; end if;
  select coalesce(jsonb_agg(to_jsonb(activity) order by activity.opened_at desc, activity.id desc), '[]'::jsonb)
  into v_recent from (
    select e.id, u.chapa, u.display_name, e.parte, e.work_date, e.shift, e.opened_at
    from private.app_cpe_part_opens e join public.app_cpe_users u on u.id=e.user_id
    order by e.opened_at desc, e.id desc limit 200
  ) activity;
  return v_recent;
end;
$$;

revoke all on function public.app_cpe_track_part_open(text,text,date,text),
  public.app_cpe_admin_part_open_monitor(text) from public, anon, authenticated;
grant execute on function public.app_cpe_track_part_open(text,text,date,text),
  public.app_cpe_admin_part_open_monitor(text) to anon, authenticated;
