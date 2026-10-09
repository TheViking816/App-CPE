-- Correct the selected-holiday code and preserve any days saved under FA.
alter table private.app_cpe_rest_day_overrides
  drop constraint app_cpe_rest_day_overrides_day_type_check;
update private.app_cpe_rest_day_overrides set day_type = 'FS' where day_type = 'FA';
alter table private.app_cpe_rest_day_overrides
  add constraint app_cpe_rest_day_overrides_day_type_check
  check (day_type in ('REST', 'FS', 'WORK'));

create or replace function public.app_cpe_save_rest_day_override(p_token text, p_work_date date, p_day_type text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_row private.app_cpe_rest_day_overrides;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_work_date is null or p_work_date < date '2000-01-01'
    or p_work_date > (now() at time zone 'Europe/Madrid')::date + 366 then
    raise exception 'Fecha no válida';
  end if;
  if p_day_type is null or p_day_type not in ('REST', 'FS', 'WORK') then
    raise exception 'Tipo de día no válido';
  end if;
  insert into private.app_cpe_rest_day_overrides(user_id, work_date, day_type)
    values (v_user.id, p_work_date, p_day_type)
    on conflict (user_id, work_date) do update
      set day_type = excluded.day_type, updated_at = now()
    returning * into v_row;
  return jsonb_build_object('work_date', v_row.work_date, 'day_type', v_row.day_type);
end $$;
