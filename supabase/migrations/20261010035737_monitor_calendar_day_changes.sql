-- Keep calendar edits in a private audit, including changes made from Sueldómetro.
create table if not exists private.app_cpe_calendar_day_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  source text not null check (source in ('rest', 'paid')),
  event_type text not null check (event_type in ('added', 'edited', 'deleted')),
  work_date date not null,
  previous_work_date date,
  day_type text,
  previous_day_type text,
  occurred_at timestamptz not null default now()
);
create index if not exists app_cpe_calendar_day_activity_at_idx
  on private.app_cpe_calendar_day_activity (occurred_at desc, id desc);
create index if not exists app_cpe_calendar_day_activity_user_idx
  on private.app_cpe_calendar_day_activity (user_id, occurred_at desc);
alter table private.app_cpe_calendar_day_activity enable row level security;
revoke all on private.app_cpe_calendar_day_activity from public, anon, authenticated;

create or replace function private.app_cpe_record_calendar_day_activity()
returns trigger language plpgsql
set search_path = private, public, pg_catalog, pg_temp as $$
declare
  v_source text := case tg_table_name
    when 'app_cpe_rest_day_overrides' then 'rest' else 'paid' end;
  v_old_type text;
  v_new_type text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_type := case when v_source = 'rest' then to_jsonb(old)->>'day_type' else to_jsonb(old)->>'concept_type' end;
  end if;
  if tg_op in ('UPDATE', 'INSERT') then
    v_new_type := case when v_source = 'rest' then to_jsonb(new)->>'day_type' else to_jsonb(new)->>'concept_type' end;
  end if;
  if tg_op = 'UPDATE' and old.work_date = new.work_date and v_old_type = v_new_type then
    return null;
  end if;
  insert into private.app_cpe_calendar_day_activity
    (user_id, source, event_type, work_date, previous_work_date, day_type, previous_day_type)
  values (
    case when tg_op = 'DELETE' then old.user_id else new.user_id end,
    v_source,
    case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'edited' else 'deleted' end,
    case when tg_op = 'DELETE' then old.work_date else new.work_date end,
    case when tg_op = 'UPDATE' then old.work_date else null end,
    v_new_type,
    v_old_type
  );
  return null;
end $$;
revoke all on function private.app_cpe_record_calendar_day_activity() from public, anon, authenticated;

drop trigger if exists app_cpe_rest_day_activity_trigger on private.app_cpe_rest_day_overrides;
create trigger app_cpe_rest_day_activity_trigger
after insert or update or delete on private.app_cpe_rest_day_overrides
for each row execute function private.app_cpe_record_calendar_day_activity();
drop trigger if exists app_cpe_paid_day_activity_trigger on private.app_cpe_manual_paid_days;
create trigger app_cpe_paid_day_activity_trigger
after insert or update or delete on private.app_cpe_manual_paid_days
for each row execute function private.app_cpe_record_calendar_day_activity();

create or replace function public.app_cpe_admin_calendar_day_activity(p_token text)
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
    select a.id, u.chapa, a.source, a.event_type, a.work_date,
      a.previous_work_date, a.day_type, a.previous_day_type, a.occurred_at
    from private.app_cpe_calendar_day_activity a
    join public.app_cpe_users u on u.id = a.user_id
    order by a.occurred_at desc, a.id desc
    limit 200
  ) activity;
  return v_rows;
end $$;
revoke all on function public.app_cpe_admin_calendar_day_activity(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_calendar_day_activity(text) to anon, authenticated;
