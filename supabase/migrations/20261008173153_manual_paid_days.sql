create table if not exists private.app_cpe_manual_paid_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  work_date date not null,
  concept_type text not null check (concept_type in ('VA', 'FM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);
create index if not exists app_cpe_manual_paid_days_user_date_idx
  on private.app_cpe_manual_paid_days(user_id, work_date desc);
alter table private.app_cpe_manual_paid_days enable row level security;
revoke all on private.app_cpe_manual_paid_days from public, anon, authenticated;

create or replace function public.app_cpe_list_manual_paid_days(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_rows jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_agg(to_jsonb(d) - 'user_id' order by work_date desc, created_at desc),'[]'::jsonb)
    into v_rows from private.app_cpe_manual_paid_days d where user_id = v_user.id;
  return v_rows;
end $$;
revoke all on function public.app_cpe_list_manual_paid_days(text) from public, anon, authenticated;
grant execute on function public.app_cpe_list_manual_paid_days(text) to anon, authenticated;

create or replace function public.app_cpe_save_manual_paid_day(p_token text, p_id uuid, p_work_date date, p_concept_type text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_row private.app_cpe_manual_paid_days;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_work_date is null or p_work_date < date '2000-01-01' or p_work_date > current_date + 366 then
    raise exception 'Fecha no válida';
  end if;
  if p_concept_type not in ('VA', 'FM') then raise exception 'Concepto no válido'; end if;
  if p_id is null then
    insert into private.app_cpe_manual_paid_days(user_id,work_date,concept_type)
      values(v_user.id,p_work_date,p_concept_type) returning * into v_row;
  else
    update private.app_cpe_manual_paid_days
      set work_date=p_work_date, concept_type=p_concept_type, updated_at=now()
      where id=p_id and user_id=v_user.id returning * into v_row;
    if not found then raise exception 'Día no encontrado'; end if;
  end if;
  return to_jsonb(v_row) - 'user_id';
exception when unique_violation then raise exception 'Este día ya está registrado';
end $$;
revoke all on function public.app_cpe_save_manual_paid_day(text,uuid,date,text) from public, anon, authenticated;
grant execute on function public.app_cpe_save_manual_paid_day(text,uuid,date,text) to anon, authenticated;

create or replace function public.app_cpe_delete_manual_paid_day(p_token text, p_id uuid)
returns boolean language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  delete from private.app_cpe_manual_paid_days where id=p_id and user_id=v_user.id;
  return found;
end $$;
revoke all on function public.app_cpe_delete_manual_paid_day(text,uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_delete_manual_paid_day(text,uuid) to anon, authenticated;
