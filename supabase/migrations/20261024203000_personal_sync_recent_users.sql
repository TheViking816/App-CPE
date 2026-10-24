-- Only a manual admin request can queue a run; select users active in App CPE within seven days.
create or replace function public.app_cpe_admin_personal_sync_status(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_run private.app_cpe_personal_sync_runs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa <> '72683' then raise exception 'Acceso denegado' using errcode = '42501'; end if;
  update private.app_cpe_personal_sync_runs r set status='stopped',finished_at=now(),current_chapa=null,
    message='El agente del PC dejó de responder'
    where r.status='running' and not exists (
      select 1 from private.app_cpe_personal_sync_nodes n
      where n.worker_id=r.worker_id and n.seen_at > now()-interval '2 minutes');
  select * into v_run from private.app_cpe_personal_sync_runs order by requested_at desc limit 1;
  return jsonb_build_object(
    'eligibleCount', (select count(*) from public.app_cpe_users u
      join private.app_cpe_manual_noray_section_links l on l.chapa=u.chapa and l.section='vacaciones'
      where u.portal_activation_status='active'
        and greatest(u.created_at,coalesce((select max(s.last_seen_at) from public.app_cpe_sessions s
          where s.user_id=u.id and not coalesce(s.is_support,false)),'-infinity'::timestamptz)) >= now()-interval '7 days'),
    'inactiveCount', (select count(*) from public.app_cpe_users u
      join private.app_cpe_manual_noray_section_links l on l.chapa=u.chapa and l.section='vacaciones'
      where u.portal_activation_status='active'
        and greatest(u.created_at,coalesce((select max(s.last_seen_at) from public.app_cpe_sessions s
          where s.user_id=u.id and not coalesce(s.is_support,false)),'-infinity'::timestamptz)) < now()-interval '7 days'),
    'pcOnline', exists(select 1 from private.app_cpe_personal_sync_nodes where seen_at > now()-interval '45 seconds'),
    'status',v_run.status,'requestedAt',v_run.requested_at,'startedAt',v_run.started_at,
    'finishedAt',v_run.finished_at,'totalCount',v_run.total_count,
    'completedCount',v_run.completed_count,'currentChapa',v_run.current_chapa,'message',v_run.message);
end; $$;

create or replace function public.app_cpe_admin_request_personal_sync(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_run private.app_cpe_personal_sync_runs; v_total integer;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa <> '72683' then raise exception 'Acceso denegado' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72683,20261024);
  update private.app_cpe_personal_sync_runs r set status='stopped',finished_at=now(),current_chapa=null,
    message='El agente del PC dejó de responder'
    where r.status='running' and not exists (
      select 1 from private.app_cpe_personal_sync_nodes n
      where n.worker_id=r.worker_id and n.seen_at > now()-interval '2 minutes');
  if not exists(select 1 from private.app_cpe_personal_sync_nodes where seen_at > now()-interval '45 seconds')
    then raise exception 'El agente del PC no está conectado'; end if;
  if exists(select 1 from private.app_cpe_personal_sync_runs
    where status='running' or (status='queued' and requested_at > now()-interval '2 minutes'))
    then raise exception 'Ya hay una sincronización pendiente o en curso'; end if;
  insert into private.app_cpe_personal_sync_runs default values returning * into v_run;
  insert into private.app_cpe_personal_sync_items(run_id,chapa)
    select v_run.id,u.chapa from public.app_cpe_users u
      join private.app_cpe_manual_noray_section_links l on l.chapa=u.chapa and l.section='vacaciones'
    where u.portal_activation_status='active'
      and greatest(u.created_at,coalesce((select max(s.last_seen_at) from public.app_cpe_sessions s
        where s.user_id=u.id and not coalesce(s.is_support,false)),'-infinity'::timestamptz)) >= now()-interval '7 days';
  get diagnostics v_total=row_count;
  if v_total=0 then raise exception 'No hay cuentas recientes con enlace personal'; end if;
  update private.app_cpe_personal_sync_runs set total_count=v_total where id=v_run.id;
  return jsonb_build_object('id',v_run.id,'status','queued','totalCount',v_total);
end; $$;

revoke all on function public.app_cpe_admin_personal_sync_status(text),
  public.app_cpe_admin_request_personal_sync(text) from public,anon,authenticated;
grant execute on function public.app_cpe_admin_personal_sync_status(text),
  public.app_cpe_admin_request_personal_sync(text) to anon,authenticated;
