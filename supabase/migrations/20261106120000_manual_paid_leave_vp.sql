alter table private.app_cpe_manual_paid_days
  drop constraint if exists app_cpe_manual_paid_days_concept_type_check;
alter table private.app_cpe_manual_paid_days
  add constraint app_cpe_manual_paid_days_concept_type_check
  check (concept_type in ('VA', 'FM', 'VP'));

create or replace function public.app_cpe_save_manual_paid_day(p_token text, p_id uuid, p_work_date date, p_concept_type text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_row private.app_cpe_manual_paid_days;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_work_date is null or p_work_date < date '2000-01-01'
    or p_work_date > (now() at time zone 'Europe/Madrid')::date + 366 then
    raise exception 'Fecha no válida';
  end if;
  if p_concept_type is null or p_concept_type not in ('VA', 'FM', 'VP') then
    raise exception 'Concepto no válido';
  end if;
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

create or replace function public.app_cpe_add_manual_paid_day_range(
  p_token text, p_start date, p_end date, p_concept_type text
)
returns integer language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_concept_type is null or p_concept_type not in ('VA', 'FM', 'VP') then
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
    raise exception 'El periodo contiene días VA, FM o VP de otro tipo. Edítalos por separado';
  end if;
  insert into private.app_cpe_manual_paid_days(user_id, work_date, concept_type)
    select v_user.id, day.value::date, p_concept_type
    from generate_series(p_start, p_end, interval '1 day') day(value)
    on conflict (user_id, work_date) do nothing;
  return p_end - p_start + 1;
end $$;
revoke all on function public.app_cpe_add_manual_paid_day_range(text,date,date,text) from public, anon, authenticated;
grant execute on function public.app_cpe_add_manual_paid_day_range(text,date,date,text) to anon, authenticated;
