-- Keep a durable audit of manual jornal changes. The monitor is private to chapa 72683.
create table if not exists private.app_cpe_manual_jornal_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  jornal_id uuid not null,
  event_type text not null check (event_type in ('added', 'edited', 'deleted')),
  work_date date not null,
  shift text not null,
  specialty text not null,
  worker_group text not null,
  operation_type text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists app_cpe_manual_jornal_activity_at_idx
  on private.app_cpe_manual_jornal_activity (occurred_at desc, id desc);
create index if not exists app_cpe_manual_jornal_activity_user_idx
  on private.app_cpe_manual_jornal_activity (user_id, occurred_at desc);
alter table private.app_cpe_manual_jornal_activity enable row level security;
revoke all on private.app_cpe_manual_jornal_activity from public, anon, authenticated;

-- Include existing manual jornales without fabricating edits or deleted rows.
insert into private.app_cpe_manual_jornal_activity
  (user_id, jornal_id, event_type, work_date, shift, specialty, worker_group, operation_type, occurred_at)
select user_id, id, 'added', work_date, shift, specialty, worker_group, operation_type, created_at
from private.app_cpe_manual_jornales;

create or replace function private.app_cpe_record_manual_jornal_activity()
returns trigger language plpgsql
set search_path = private, public, pg_catalog, pg_temp as $$
declare v_row private.app_cpe_manual_jornales;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  insert into private.app_cpe_manual_jornal_activity
    (user_id, jornal_id, event_type, work_date, shift, specialty, worker_group, operation_type)
  values
    (v_row.user_id, v_row.id,
     case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'edited' else 'deleted' end,
     v_row.work_date, v_row.shift, v_row.specialty, v_row.worker_group, v_row.operation_type);
  return null;
end $$;
revoke all on function private.app_cpe_record_manual_jornal_activity() from public, anon, authenticated;

drop trigger if exists app_cpe_manual_jornal_activity_trigger on private.app_cpe_manual_jornales;
create trigger app_cpe_manual_jornal_activity_trigger
after insert or update or delete on private.app_cpe_manual_jornales
for each row execute function private.app_cpe_record_manual_jornal_activity();

create or replace function public.app_cpe_admin_manual_jornal_activity(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_rows jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa <> '72683' then
    raise exception 'Acceso de administrador requerido';
  end if;
  select coalesce(jsonb_agg(to_jsonb(activity) order by activity.occurred_at desc, activity.id desc), '[]'::jsonb)
  into v_rows
  from (
    select a.id, u.chapa, a.event_type, a.work_date, a.shift,
      a.specialty, a.worker_group, a.operation_type, a.occurred_at
    from private.app_cpe_manual_jornal_activity a
    join public.app_cpe_users u on u.id = a.user_id
    order by a.occurred_at desc, a.id desc
    limit 200
  ) activity;
  return v_rows;
end $$;
revoke all on function public.app_cpe_admin_manual_jornal_activity(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_manual_jornal_activity(text) to anon, authenticated;
