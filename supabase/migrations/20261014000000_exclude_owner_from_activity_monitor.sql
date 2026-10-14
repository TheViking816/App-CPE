-- The owner's own changes are not activity to monitor. Keep historical rows
-- intact, but exclude them from the monitor and stop writing new ones.
create or replace function private.app_cpe_record_manual_jornal_activity()
returns trigger language plpgsql
set search_path = private, public, pg_catalog, pg_temp as $$
declare v_row private.app_cpe_manual_jornales;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if exists (select 1 from public.app_cpe_users where id = v_row.user_id and chapa = '72683') then
    return null;
  end if;
  insert into private.app_cpe_manual_jornal_activity
    (user_id, jornal_id, event_type, work_date, shift, specialty, worker_group, operation_type)
  values
    (v_row.user_id, v_row.id,
     case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'edited' else 'deleted' end,
     v_row.work_date, v_row.shift, v_row.specialty, v_row.worker_group, v_row.operation_type);
  return null;
end $$;

create or replace function private.app_cpe_record_calendar_day_activity()
returns trigger language plpgsql
set search_path = private, public, pg_catalog, pg_temp as $$
declare
  v_source text := case tg_table_name when 'app_cpe_rest_day_overrides' then 'rest' else 'paid' end;
  v_old_type text;
  v_new_type text;
  v_user_id uuid;
begin
  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if exists (select 1 from public.app_cpe_users where id = v_user_id and chapa = '72683') then
    return null;
  end if;
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
    v_user_id,
    v_source,
    case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'edited' else 'deleted' end,
    case when tg_op = 'DELETE' then old.work_date else new.work_date end,
    case when tg_op = 'UPDATE' then old.work_date else null end,
    v_new_type,
    v_old_type
  );
  return null;
end $$;

create or replace function public.app_cpe_admin_manual_jornal_activity(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_rows jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa <> '72683' then raise exception 'Acceso de administrador requerido'; end if;
  select coalesce(jsonb_agg(to_jsonb(activity) order by activity.occurred_at desc, activity.id desc), '[]'::jsonb)
  into v_rows
  from (
    select a.id, u.chapa, a.event_type, a.work_date, a.shift,
      a.specialty, a.worker_group, a.operation_type, a.occurred_at
    from private.app_cpe_manual_jornal_activity a
    join public.app_cpe_users u on u.id = a.user_id
    where u.chapa <> '72683'
    order by a.occurred_at desc, a.id desc
    limit 200
  ) activity;
  return v_rows;
end $$;

create or replace function public.app_cpe_admin_calendar_day_activity(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_rows jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa <> '72683' then raise exception 'Acceso de administrador requerido'; end if;
  select coalesce(jsonb_agg(to_jsonb(activity) order by activity.occurred_at desc, activity.id desc), '[]'::jsonb)
    into v_rows
  from (
    select a.id, u.chapa, a.source, a.event_type, a.work_date,
      a.previous_work_date, a.day_type, a.previous_day_type, a.occurred_at
    from private.app_cpe_calendar_day_activity a
    join public.app_cpe_users u on u.id = a.user_id
    where u.chapa <> '72683'
    order by a.occurred_at desc, a.id desc
    limit 200
  ) activity;
  return v_rows;
end $$;
