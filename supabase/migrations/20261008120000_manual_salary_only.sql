-- The saved portal snapshot remains read-only so existing jornal history survives.
create table if not exists private.app_cpe_manual_jornales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  work_date date not null,
  shift text not null check (shift in ('02-08','06-12','08-14','14-20','18-00','19-01','20-02')),
  specialty text not null check (length(trim(specialty)) between 1 and 100),
  worker_group text not null check (worker_group in ('I','II','III','IV')),
  operation_type text not null check (operation_type in ('ESTIBA','RECEPCION_ENTREGA')),
  premium numeric(10,2) not null default 0 check (premium between 0 and 99999.99),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_cpe_manual_jornales_user_date_idx
  on private.app_cpe_manual_jornales(user_id, work_date desc);
alter table private.app_cpe_manual_jornales enable row level security;
revoke all on private.app_cpe_manual_jornales from public, anon, authenticated;

create or replace function public.app_cpe_register_manual(p_chapa text, p_password text, p_email text)
returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_chapa text; v_email text; v_token text;
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);
  v_email := lower(trim(coalesce(p_email,'')));
  if length(coalesce(p_password,'')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Introduce un correo válido'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_register:' || v_chapa, 0));
  if exists(select 1 from public.app_cpe_users where chapa = v_chapa) then raise exception 'Esa chapa ya está registrada; inicia sesión con tu cuenta'; end if;
  insert into public.app_cpe_users(chapa,password_hash,specialties,email,portal_activation_status)
  values(v_chapa,extensions.crypt(p_password,extensions.gen_salt('bf')),'{}'::text[],v_email,'active')
  returning * into v_user;
  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user,v_token);
end $$;
revoke all on function public.app_cpe_register_manual(text,text,text) from public, anon, authenticated;
grant execute on function public.app_cpe_register_manual(text,text,text) to anon, authenticated;

create or replace function public.app_cpe_get_saved_salary_history(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_payload jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select payload into v_payload from public.app_cpe_portal_snapshots where chapa=v_user.chapa;
  return jsonb_build_object('payload',jsonb_build_object(
    'jornales',coalesce(v_payload->'jornales','{}'::jsonb),
    'primas',coalesce(v_payload->'primas','{}'::jsonb)
  ));
end $$;
revoke all on function public.app_cpe_get_saved_salary_history(text) from public, anon, authenticated;
grant execute on function public.app_cpe_get_saved_salary_history(text) to anon, authenticated;

create or replace function public.app_cpe_list_manual_jornales(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_rows jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_agg(to_jsonb(j) - 'user_id' order by work_date desc, created_at desc),'[]'::jsonb)
  into v_rows from private.app_cpe_manual_jornales j where user_id=v_user.id;
  return v_rows;
end $$;
revoke all on function public.app_cpe_list_manual_jornales(text) from public, anon, authenticated;
grant execute on function public.app_cpe_list_manual_jornales(text) to anon, authenticated;

create or replace function public.app_cpe_save_manual_jornal(
  p_token text, p_id uuid, p_work_date date, p_shift text, p_specialty text,
  p_worker_group text, p_operation_type text, p_premium numeric, p_notes text
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
  if p_premium is null or p_premium < 0 or p_premium > 99999.99 then raise exception 'Prima no válida'; end if;
  if length(coalesce(p_notes,'')) > 500 then raise exception 'Notas demasiado largas'; end if;
  if p_id is null then
    insert into private.app_cpe_manual_jornales(user_id,work_date,shift,specialty,worker_group,operation_type,premium,notes)
    values(v_user.id,p_work_date,p_shift,trim(p_specialty),p_worker_group,p_operation_type,round(p_premium,2),coalesce(p_notes,'')) returning * into v_row;
  else
    update private.app_cpe_manual_jornales set work_date=p_work_date,shift=p_shift,specialty=trim(p_specialty),
      worker_group=p_worker_group,operation_type=p_operation_type,premium=round(p_premium,2),notes=coalesce(p_notes,''),updated_at=now()
    where id=p_id and user_id=v_user.id returning * into v_row;
    if v_row.id is null then raise exception 'Jornal no encontrado'; end if;
  end if;
  return to_jsonb(v_row) - 'user_id';
end $$;
revoke all on function public.app_cpe_save_manual_jornal(text,uuid,date,text,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.app_cpe_save_manual_jornal(text,uuid,date,text,text,text,text,numeric,text) to anon, authenticated;

create or replace function public.app_cpe_delete_manual_jornal(p_token text,p_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  delete from private.app_cpe_manual_jornales where id=p_id and user_id=v_user.id;
  if not found then raise exception 'Jornal no encontrado'; end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.app_cpe_delete_manual_jornal(text,uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_delete_manual_jornal(text,uuid) to anon, authenticated;

-- No scheduled requests to the employer portal; retain usage retention and historical snapshots.
do $$ declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname like 'app_cpe_refresh_%' or jobname = 'app-cpe-pause-inactive-portal-syncs' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end $$;
update public.app_cpe_portal_sync_jobs set status='failed', message='Sincronización desactivada: Sueldómetro manual', finished_at=now()
where status in ('queued','running');
update public.app_cpe_worker_commands set status='failed', message='Sincronización desactivada: Sueldómetro manual', finished_at=now()
where status in ('queued','running','pending','claimed');

-- Old builds may remain open in browser tabs. Remove their ability to enqueue portal work.
do $$ declare v_func record;
begin
  for v_func in select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (
      p.proname like 'app_cpe%portal%'
      or p.proname like 'app_cpe%worker%'
      or p.proname='app_cpe_run_scheduled_refresh'
    )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',v_func.signature);
  end loop;
end $$;
revoke execute on function public.app_cpe_register(text,text,text[],text) from public,anon,authenticated;
revoke execute on function public.app_cpe_register(text,text,text[]) from public,anon,authenticated;
