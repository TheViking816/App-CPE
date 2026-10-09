-- The app authenticates with its own session token. Each exposed RPC resolves that
-- token to one app_cpe_users row before it reads or writes this private table.
create table if not exists private.app_cpe_rest_day_overrides (
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  work_date date not null,
  day_type text not null check (day_type in ('REST', 'FA', 'WORK')),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_date)
);
alter table private.app_cpe_rest_day_overrides enable row level security;
revoke all on private.app_cpe_rest_day_overrides from public, anon, authenticated;

create function public.app_cpe_list_rest_day_overrides(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_rows jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_agg(jsonb_build_object('work_date', d.work_date, 'day_type', d.day_type)
    order by d.work_date), '[]'::jsonb)
    into v_rows from private.app_cpe_rest_day_overrides d where d.user_id = v_user.id;
  return v_rows;
end $$;
revoke all on function public.app_cpe_list_rest_day_overrides(text) from public, anon, authenticated;
grant execute on function public.app_cpe_list_rest_day_overrides(text) to anon, authenticated;

create function public.app_cpe_save_rest_day_override(p_token text, p_work_date date, p_day_type text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_row private.app_cpe_rest_day_overrides;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_work_date is null or p_work_date < date '2000-01-01'
    or p_work_date > (now() at time zone 'Europe/Madrid')::date + 366 then
    raise exception 'Fecha no válida';
  end if;
  if p_day_type is null or p_day_type not in ('REST', 'FA', 'WORK') then
    raise exception 'Tipo de día no válido';
  end if;
  insert into private.app_cpe_rest_day_overrides(user_id, work_date, day_type)
    values (v_user.id, p_work_date, p_day_type)
    on conflict (user_id, work_date) do update
      set day_type = excluded.day_type, updated_at = now()
    returning * into v_row;
  return jsonb_build_object('work_date', v_row.work_date, 'day_type', v_row.day_type);
end $$;
revoke all on function public.app_cpe_save_rest_day_override(text,date,text) from public, anon, authenticated;
grant execute on function public.app_cpe_save_rest_day_override(text,date,text) to anon, authenticated;

create function public.app_cpe_delete_rest_day_override(p_token text, p_work_date date)
returns boolean language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  delete from private.app_cpe_rest_day_overrides
    where user_id = v_user.id and work_date = p_work_date;
  return found;
end $$;
revoke all on function public.app_cpe_delete_rest_day_override(text,date) from public, anon, authenticated;
grant execute on function public.app_cpe_delete_rest_day_override(text,date) to anon, authenticated;
