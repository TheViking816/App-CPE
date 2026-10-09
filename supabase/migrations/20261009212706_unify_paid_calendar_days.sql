-- Import the saved portal VA periods into the same per-user table edited by
-- Sueldómetro and the personal calendars. Existing manual choices win.
with periods as (
  select u.id as user_id, period.value->>'inicio' as start_text,
    period.value->>'fin' as end_text
  from public.app_cpe_portal_snapshots snapshot
  join public.app_cpe_users u on u.chapa = snapshot.chapa
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(snapshot.payload #> '{vacaciones,rows}') = 'array'
      then snapshot.payload #> '{vacaciones,rows}' else '[]'::jsonb end
  ) period
), dates as (
  select user_id, start_text, end_text,
    to_date(start_text, 'DD/MM/YYYY') as start_date,
    to_date(end_text, 'DD/MM/YYYY') as end_date
  from periods
  where start_text ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    and end_text ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
), valid as (
  select user_id, start_date, end_date from dates
  where to_char(start_date, 'DD/MM/YYYY') = start_text
    and to_char(end_date, 'DD/MM/YYYY') = end_text
    and end_date between start_date and start_date + 370
)
insert into private.app_cpe_manual_paid_days(user_id, work_date, concept_type)
select distinct valid.user_id, day.value::date, 'VA'
from valid
cross join lateral generate_series(valid.start_date, valid.end_date, interval '1 day') day(value)
on conflict (user_id, work_date) do nothing;

-- FM was saved in both the rest history and availability snapshots.
with months as (
  select u.id as user_id, period.value as month_data
  from public.app_cpe_portal_snapshots snapshot
  join public.app_cpe_users u on u.chapa = snapshot.chapa
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(snapshot.payload #> '{descansos,months}') = 'array'
      then snapshot.payload #> '{descansos,months}' else '[]'::jsonb end
  ) period
  union all
  select u.id, period.value
  from public.app_cpe_portal_snapshots snapshot
  join public.app_cpe_users u on u.chapa = snapshot.chapa
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(snapshot.payload #> '{descansos,trainingHistory}') = 'array'
      then snapshot.payload #> '{descansos,trainingHistory}' else '[]'::jsonb end
  ) period
  union all
  select u.id, period.value
  from public.app_cpe_portal_snapshots snapshot
  join public.app_cpe_users u on u.chapa = snapshot.chapa
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(snapshot.payload #> '{disponibilidad,months}') = 'array'
      then snapshot.payload #> '{disponibilidad,months}' else '[]'::jsonb end
  ) period
), days as (
  select user_id,
    month_data->>'year' as year_text,
    month_data->>'month' as month_text,
    day.value->>'day' as day_text
  from months
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(month_data->'days') = 'array'
      then month_data->'days' else '[]'::jsonb end
  ) day
  where upper(trim(day.value->>'code')) = 'FM'
), parsed as (
  select user_id,
    year_text || '-' || lpad(month_text, 2, '0') || '-' || lpad(day_text, 2, '0') as date_text
  from days
  where year_text ~ '^20[0-9]{2}$'
    and month_text ~ '^([1-9]|1[0-2])$'
    and day_text ~ '^([1-9]|[12][0-9]|3[01])$'
), valid as (
  select user_id, to_date(date_text, 'YYYY-MM-DD') as work_date, date_text
  from parsed
)
insert into private.app_cpe_manual_paid_days(user_id, work_date, concept_type)
select distinct user_id, work_date, 'FM' from valid
where to_char(work_date, 'YYYY-MM-DD') = date_text
on conflict (user_id, work_date) do nothing;

-- The same atomic write is used for either VA or FM, including date ranges.
create function public.app_cpe_add_manual_paid_day_range(
  p_token text, p_start date, p_end date, p_concept_type text
)
returns integer language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_concept_type is null or p_concept_type not in ('VA', 'FM') then
    raise exception 'Concepto no válido';
  end if;
  if p_start is null or p_end is null or p_start < date '2000-01-01'
    or p_end < p_start or p_end - p_start > 30
    or p_end > (now() at time zone 'Europe/Madrid')::date + 366 then
    raise exception 'Selecciona entre 1 y 31 días válidos';
  end if;
  if exists (
    select 1 from private.app_cpe_manual_paid_days
    where user_id = v_user.id and work_date between p_start and p_end
      and concept_type <> p_concept_type
  ) then
    raise exception 'El periodo contiene días VA o FM de otro tipo. Edítalos por separado';
  end if;
  insert into private.app_cpe_manual_paid_days(user_id, work_date, concept_type)
    select v_user.id, day.value::date, p_concept_type
    from generate_series(p_start, p_end, interval '1 day') day(value)
    on conflict (user_id, work_date) do nothing;
  return p_end - p_start + 1;
end $$;
revoke all on function public.app_cpe_add_manual_paid_day_range(text,date,date,text) from public, anon, authenticated;
grant execute on function public.app_cpe_add_manual_paid_day_range(text,date,date,text) to anon, authenticated;
