-- Vacation periods take precedence even when the portal marks the day blank.
create or replace function public.app_cpe_rest_day_code(p_chapa text, p_date date)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_code text;
begin
  select s.payload into v_snapshot
  from public.app_cpe_portal_snapshots s where s.chapa = p_chapa;

  select coalesce(d.value ->> 'code', '') into v_code
  from jsonb_array_elements(coalesce(v_snapshot #> '{descansos,months}', '[]'::jsonb)) m(value)
  cross join lateral jsonb_array_elements(coalesce(m.value -> 'days', '[]'::jsonb)) d(value)
  where (m.value ->> 'year')::integer = extract(year from p_date)::integer
    and (m.value ->> 'month')::integer = extract(month from p_date)::integer
    and (d.value ->> 'day')::integer = extract(day from p_date)::integer
  limit 1;

  if exists (
    select 1 from jsonb_array_elements(coalesce(v_snapshot #> '{vacaciones,rows}', '[]'::jsonb)) vacation(value)
    where vacation.value ->> 'inicio' ~ '^\d{1,2}/\d{1,2}/\d{4}$'
      and vacation.value ->> 'fin' ~ '^\d{1,2}/\d{1,2}/\d{4}$'
      and p_date between to_date(vacation.value ->> 'inicio', 'DD/MM/YYYY')
                     and to_date(vacation.value ->> 'fin', 'DD/MM/YYYY')
  ) then
    return 'VA';
  end if;
  return v_code;
end;
$$;
