-- Store a short vacation period atomically in the same table used by Sueldómetro.
create function public.app_cpe_add_manual_vacation_range(p_token text, p_start date, p_end date)
returns integer language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_start is null or p_end is null or p_start < date '2000-01-01'
    or p_end < p_start or p_end - p_start > 30
    or p_end > (now() at time zone 'Europe/Madrid')::date + 366 then
    raise exception 'Selecciona entre 1 y 31 días de vacaciones válidos';
  end if;
  if exists (
    select 1 from private.app_cpe_manual_paid_days
    where user_id = v_user.id and work_date between p_start and p_end and concept_type = 'FM'
  ) then
    raise exception 'El periodo contiene días FM. Edítalos en Sueldómetro antes de añadir vacaciones';
  end if;
  insert into private.app_cpe_manual_paid_days(user_id, work_date, concept_type)
    select v_user.id, days.day::date, 'VA'
    from generate_series(p_start, p_end, interval '1 day') as days(day)
    on conflict (user_id, work_date) do update
      set concept_type = 'VA', updated_at = now();
  return p_end - p_start + 1;
end $$;
revoke all on function public.app_cpe_add_manual_vacation_range(text,date,date) from public, anon, authenticated;
grant execute on function public.app_cpe_add_manual_vacation_range(text,date,date) to anon, authenticated;
