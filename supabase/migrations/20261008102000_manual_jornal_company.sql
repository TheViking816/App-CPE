alter table private.app_cpe_manual_jornales
  add column if not exists company text not null default '' check (length(company) <= 100),
  add column if not exists vessel text not null default '' check (length(vessel) <= 100);

create or replace function public.app_cpe_save_manual_jornal_v2(
  p_token text, p_id uuid, p_work_date date, p_shift text, p_specialty text,
  p_worker_group text, p_operation_type text, p_company text, p_vessel text, p_premium numeric, p_notes text
) returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_row private.app_cpe_manual_jornales;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_work_date is null or p_work_date < date '2000-01-01' or p_work_date > current_date + 366 then raise exception 'Fecha no válida'; end if;
  if p_shift not in ('02-08','06-12','08-14','14-20','18-00','19-01','20-02') then raise exception 'Turno no válido'; end if;
  if length(trim(coalesce(p_specialty,''))) not between 1 and 100 then raise exception 'Especialidad no válida'; end if;
  if p_worker_group not in ('I','II','III','IV') then raise exception 'Grupo no válido'; end if;
  if p_operation_type not in ('ESTIBA','RECEPCION_ENTREGA') then raise exception 'Operación no válida'; end if;
  if length(trim(coalesce(p_company,''))) > 100 then raise exception 'Empresa no válida'; end if;
  if length(trim(coalesce(p_vessel,''))) > 100 then raise exception 'Buque no válido'; end if;
  if p_premium is null or p_premium < 0 or p_premium > 99999.99 then raise exception 'Prima no válida'; end if;
  if length(coalesce(p_notes,'')) > 500 then raise exception 'Notas demasiado largas'; end if;
  if p_id is null then
    insert into private.app_cpe_manual_jornales(user_id,work_date,shift,specialty,worker_group,operation_type,company,vessel,premium,notes)
    values(v_user.id,p_work_date,p_shift,trim(p_specialty),p_worker_group,p_operation_type,trim(coalesce(p_company,'')),trim(coalesce(p_vessel,'')),round(p_premium,2),coalesce(p_notes,'')) returning * into v_row;
  else
    update private.app_cpe_manual_jornales set work_date=p_work_date,shift=p_shift,specialty=trim(p_specialty),
      worker_group=p_worker_group,operation_type=p_operation_type,company=trim(coalesce(p_company,'')),vessel=trim(coalesce(p_vessel,'')),
      premium=round(p_premium,2),notes=coalesce(p_notes,''),updated_at=now()
    where id=p_id and user_id=v_user.id returning * into v_row;
    if v_row.id is null then raise exception 'Jornal no encontrado'; end if;
  end if;
  return to_jsonb(v_row) - 'user_id';
end $$;
revoke all on function public.app_cpe_save_manual_jornal_v2(text,uuid,date,text,text,text,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.app_cpe_save_manual_jornal_v2(text,uuid,date,text,text,text,text,text,text,numeric,text) to anon, authenticated;
revoke execute on function public.app_cpe_save_manual_jornal(text,uuid,date,text,text,text,text,numeric,text) from public, anon, authenticated;
