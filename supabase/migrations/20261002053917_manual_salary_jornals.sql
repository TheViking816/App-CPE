-- User-entered salary estimates are kept apart from official portal snapshots.
create table if not exists private.app_cpe_manual_salary_jornals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  work_date date not null,
  shift text not null check (shift in ('02-08','06-12','08-14','14-20','18-00','19-01','20-02')),
  worker_group text not null check (worker_group in ('I','II','III','IV')),
  operation_type text not null check (operation_type in ('ESTIBA','RECEPCION_ENTREGA')),
  specialty text not null default '',
  company text not null default '',
  part_number text not null default '',
  vessel text not null default '',
  premium_mode text not null default 'none' check (premium_mode in ('none','direct','movements')),
  premium_amount numeric(10,2),
  movements integer,
  movement_rate numeric(10,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date, shift),
  check (premium_amount is null or premium_amount between 0 and 99999.99),
  check (movements is null or movements between 0 and 100000),
  check (movement_rate is null or movement_rate between 0 and 9999.9999)
);

alter table private.app_cpe_manual_salary_jornals enable row level security;
revoke all on private.app_cpe_manual_salary_jornals from public, anon, authenticated;

create or replace function public.app_cpe_get_manual_salary_jornals(p_token text)
returns jsonb language plpgsql security definer
set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', j.id, 'date', j.work_date, 'shift', j.shift,
      'group', j.worker_group, 'operationType', j.operation_type,
      'specialty', j.specialty, 'company', j.company,
      'part', j.part_number, 'vessel', j.vessel,
      'premiumMode', j.premium_mode, 'premiumAmount', j.premium_amount,
      'movements', j.movements, 'movementRate', j.movement_rate
    ) order by j.work_date desc, j.shift)
    from private.app_cpe_manual_salary_jornals j where j.user_id = v_user.id
  ), '[]'::jsonb);
end $$;

create or replace function public.app_cpe_save_manual_salary_jornal(p_token text, p_entry jsonb)
returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_date date;
  v_shift text := trim(coalesce(p_entry->>'shift',''));
  v_group text := upper(trim(coalesce(p_entry->>'group','II')));
  v_operation text := upper(trim(coalesce(p_entry->>'operationType','ESTIBA')));
  v_mode text := lower(trim(coalesce(p_entry->>'premiumMode','none')));
  v_amount numeric(10,2);
  v_movements integer;
  v_rate numeric(10,4);
  v_row private.app_cpe_manual_salary_jornals;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then raise exception 'Jornal no válido'; end if;
  begin v_date := (p_entry->>'date')::date;
  exception when others then raise exception 'Fecha no válida'; end;
  if v_date is null or v_date < date '2020-01-01' or v_date > current_date + 31 then raise exception 'Fecha fuera de rango'; end if;
  if v_shift not in ('02-08','06-12','08-14','14-20','18-00','19-01','20-02') then raise exception 'Jornada no válida'; end if;
  if v_group not in ('I','II','III','IV') or v_operation not in ('ESTIBA','RECEPCION_ENTREGA') then raise exception 'Tarifa no válida'; end if;
  if v_mode not in ('none','direct','movements') then raise exception 'Tipo de prima no válido'; end if;
  if length(coalesce(p_entry->>'specialty','')) > 100 or length(coalesce(p_entry->>'company','')) > 150
    or length(coalesce(p_entry->>'part','')) > 30 or length(coalesce(p_entry->>'vessel','')) > 150 then
    raise exception 'Texto demasiado largo';
  end if;
  if v_mode = 'direct' then
    v_amount := round((p_entry->>'premiumAmount')::numeric, 2);
    if v_amount is null or v_amount < 0 or v_amount > 99999.99 then raise exception 'Prima no válida'; end if;
  elsif v_mode = 'movements' then
    v_movements := (p_entry->>'movements')::integer;
    v_rate := (p_entry->>'movementRate')::numeric;
    if v_movements is null or v_movements < 0 or v_movements > 100000
      or v_rate is null or v_rate < 0 or v_rate > 9999.9999 then raise exception 'Movimientos o tarifa no válidos'; end if;
    v_amount := round(v_movements * v_rate, 2);
    if v_amount > 99999.99 then raise exception 'Prima fuera de rango'; end if;
  end if;
  insert into private.app_cpe_manual_salary_jornals as j
    (user_id, work_date, shift, worker_group, operation_type, specialty, company,
     part_number, vessel, premium_mode, premium_amount, movements, movement_rate)
  values (v_user.id, v_date, v_shift, v_group, v_operation,
    trim(coalesce(p_entry->>'specialty','')), trim(coalesce(p_entry->>'company','')),
    trim(coalesce(p_entry->>'part','')), trim(coalesce(p_entry->>'vessel','')),
    v_mode, v_amount, v_movements, v_rate)
  on conflict (user_id, work_date, shift) do update set
    worker_group = excluded.worker_group, operation_type = excluded.operation_type,
    specialty = excluded.specialty, company = excluded.company,
    part_number = excluded.part_number, vessel = excluded.vessel,
    premium_mode = excluded.premium_mode, premium_amount = excluded.premium_amount,
    movements = excluded.movements, movement_rate = excluded.movement_rate,
    updated_at = now()
  returning * into v_row;
  return jsonb_build_object('ok',true,'id',v_row.id,'date',v_row.work_date,'shift',v_row.shift,
    'premiumAmount',v_row.premium_amount);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Importe o movimientos no válidos';
end $$;

create or replace function public.app_cpe_delete_manual_salary_jornal(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = '' as $$
declare v_user public.app_cpe_users; v_count integer;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  delete from private.app_cpe_manual_salary_jornals where id = p_id and user_id = v_user.id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'deleted',v_count > 0);
end $$;

revoke all on function public.app_cpe_get_manual_salary_jornals(text) from public, anon, authenticated;
revoke all on function public.app_cpe_save_manual_salary_jornal(text,jsonb) from public, anon, authenticated;
revoke all on function public.app_cpe_delete_manual_salary_jornal(text,uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_get_manual_salary_jornals(text) to anon, authenticated;
grant execute on function public.app_cpe_save_manual_salary_jornal(text,jsonb) to anon, authenticated;
grant execute on function public.app_cpe_delete_manual_salary_jornal(text,uuid) to anon, authenticated;
