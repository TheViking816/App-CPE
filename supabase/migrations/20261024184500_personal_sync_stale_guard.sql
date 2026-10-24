-- Permit a new manual request if the previous PC process disappeared.
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
      where u.portal_activation_status='active'),
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
    where u.portal_activation_status='active';
  get diagnostics v_total=row_count;
  if v_total=0 then raise exception 'No hay cuentas activas con enlace personal'; end if;
  update private.app_cpe_personal_sync_runs set total_count=v_total where id=v_run.id;
  return jsonb_build_object('id',v_run.id,'status','queued','totalCount',v_total);
end; $$;

create or replace function public.app_cpe_personal_sync_save(p_run_id uuid,p_worker_id text,p_chapa text,p_snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_previous jsonb; v_history jsonb;
begin
  if not exists(select 1 from private.app_cpe_personal_sync_runs
    where id=p_run_id and status='running' and worker_id=p_worker_id and current_chapa=p_chapa)
    or not exists(select 1 from private.app_cpe_personal_sync_items
      where run_id=p_run_id and chapa=p_chapa and status='running') then raise exception 'Cuenta no asignada'; end if;
  if p_snapshot->>'chapa' is distinct from p_chapa or p_snapshot->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_snapshot->'journals'->'rows') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'rests'->'days') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'vacations'->'periods') is distinct from 'array'
    or pg_catalog.octet_length(p_snapshot::text) > 2000000 then raise exception 'Datos incompletos'; end if;
  select payload into v_previous from private.app_cpe_personal_noray_snapshots where chapa=p_chapa for update;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_history
    from jsonb_array_elements(coalesce(v_previous->'journalHistory',
      case when v_previous->'journals' is not null then jsonb_build_array(v_previous->'journals') else '[]'::jsonb end)) item
    where (item->>'year',item->>'month') is distinct from
      (p_snapshot->'journals'->>'year',p_snapshot->'journals'->>'month');
  p_snapshot := jsonb_set(p_snapshot,'{journalHistory}',v_history || jsonb_build_array(p_snapshot->'journals'));
  insert into private.app_cpe_personal_noray_snapshots(chapa,payload,updated_at)
    values(p_chapa,p_snapshot,now()) on conflict(chapa) do update set payload=excluded.payload,updated_at=now();
  update private.app_cpe_personal_sync_items set status='completed' where run_id=p_run_id and chapa=p_chapa;
  update private.app_cpe_personal_sync_runs set completed_count=completed_count+1,current_chapa=null where id=p_run_id;
end; $$;

revoke all on function public.app_cpe_admin_personal_sync_status(text),
  public.app_cpe_admin_request_personal_sync(text),
  public.app_cpe_personal_sync_save(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_cpe_admin_personal_sync_status(text),
  public.app_cpe_admin_request_personal_sync(text) to anon,authenticated;
grant execute on function public.app_cpe_personal_sync_save(uuid,text,text,jsonb) to service_role;
