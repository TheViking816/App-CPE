-- Manual-only Noray personal sync. No cron, trigger or automatic portal request.
create table if not exists private.app_cpe_personal_noray_snapshots (
  chapa text primary key references public.app_cpe_users(chapa) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table private.app_cpe_personal_noray_snapshots enable row level security;
revoke all on private.app_cpe_personal_noray_snapshots from public, anon, authenticated;

create table if not exists private.app_cpe_personal_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued','running','completed','stopped')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,
  total_count integer not null default 0,
  completed_count integer not null default 0,
  current_chapa text,
  message text
);
create index if not exists app_cpe_personal_sync_runs_latest_idx on private.app_cpe_personal_sync_runs(requested_at desc);
alter table private.app_cpe_personal_sync_runs enable row level security;
revoke all on private.app_cpe_personal_sync_runs from public, anon, authenticated;

create table if not exists private.app_cpe_personal_sync_items (
  run_id uuid not null references private.app_cpe_personal_sync_runs(id) on delete cascade,
  chapa text not null references public.app_cpe_users(chapa) on delete cascade,
  status text not null default 'pending' check (status in ('pending','running','completed')),
  primary key (run_id, chapa)
);
alter table private.app_cpe_personal_sync_items enable row level security;
revoke all on private.app_cpe_personal_sync_items from public, anon, authenticated;

create table if not exists private.app_cpe_personal_sync_nodes (
  worker_id text primary key,
  state text not null check (state in ('idle','running')),
  seen_at timestamptz not null default now()
);
alter table private.app_cpe_personal_sync_nodes enable row level security;
revoke all on private.app_cpe_personal_sync_nodes from public, anon, authenticated;

create or replace function public.app_cpe_get_personal_noray_snapshot(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return (select s.payload from private.app_cpe_personal_noray_snapshots s where s.chapa = v_user.chapa);
end; $$;

create or replace function public.app_cpe_admin_personal_sync_status(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_run private.app_cpe_personal_sync_runs;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa <> '72683' then raise exception 'Acceso denegado' using errcode = '42501'; end if;
  select * into v_run from private.app_cpe_personal_sync_runs order by requested_at desc limit 1;
  return jsonb_build_object(
    'eligibleCount', (select count(*) from public.app_cpe_users u
      join private.app_cpe_manual_noray_section_links l on l.chapa = u.chapa and l.section = 'vacaciones'
      where u.portal_activation_status = 'active'),
    'pcOnline', exists(select 1 from private.app_cpe_personal_sync_nodes where seen_at > now() - interval '45 seconds'),
    'status', v_run.status, 'requestedAt', v_run.requested_at, 'startedAt', v_run.started_at,
    'finishedAt', v_run.finished_at, 'totalCount', v_run.total_count,
    'completedCount', v_run.completed_count, 'currentChapa', v_run.current_chapa,
    'message', v_run.message
  );
end; $$;

create or replace function public.app_cpe_admin_request_personal_sync(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_run private.app_cpe_personal_sync_runs; v_total integer;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa <> '72683' then raise exception 'Acceso denegado' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72683, 20261024);
  if not exists(select 1 from private.app_cpe_personal_sync_nodes where seen_at > now() - interval '45 seconds')
    then raise exception 'El agente del PC no está conectado'; end if;
  if exists(select 1 from private.app_cpe_personal_sync_runs
    where status = 'running' or (status = 'queued' and requested_at > now() - interval '2 minutes'))
    then raise exception 'Ya hay una sincronización pendiente o en curso'; end if;
  insert into private.app_cpe_personal_sync_runs default values returning * into v_run;
  insert into private.app_cpe_personal_sync_items(run_id, chapa)
    select v_run.id, u.chapa from public.app_cpe_users u
      join private.app_cpe_manual_noray_section_links l on l.chapa = u.chapa and l.section = 'vacaciones'
    where u.portal_activation_status = 'active';
  get diagnostics v_total = row_count;
  if v_total = 0 then raise exception 'No hay cuentas activas con enlace personal'; end if;
  update private.app_cpe_personal_sync_runs set total_count = v_total where id = v_run.id;
  return jsonb_build_object('id', v_run.id, 'status', 'queued', 'totalCount', v_total);
end; $$;

create or replace function public.app_cpe_personal_sync_heartbeat(p_worker_id text, p_state text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('idle','running') or length(trim(coalesce(p_worker_id,''))) not between 1 and 120
    then raise exception 'Estado no válido'; end if;
  insert into private.app_cpe_personal_sync_nodes(worker_id,state,seen_at)
    values (p_worker_id,p_state,now()) on conflict(worker_id)
    do update set state=excluded.state,seen_at=excluded.seen_at;
end; $$;

create or replace function public.app_cpe_personal_sync_claim(p_worker_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run private.app_cpe_personal_sync_runs;
begin
  if not exists(select 1 from private.app_cpe_personal_sync_nodes
    where worker_id=p_worker_id and seen_at > now()-interval '45 seconds') then raise exception 'Agente no registrado'; end if;
  update private.app_cpe_personal_sync_runs set status='stopped', finished_at=now(), message='La orden caducó sin ejecutarse'
    where status='queued' and requested_at < now()-interval '2 minutes';
  select * into v_run from private.app_cpe_personal_sync_runs
    where status='queued' and requested_at >= now()-interval '2 minutes'
    order by requested_at for update skip locked limit 1;
  if v_run.id is null then return null; end if;
  update private.app_cpe_personal_sync_runs set status='running', worker_id=p_worker_id, started_at=now()
    where id=v_run.id;
  return jsonb_build_object('id',v_run.id,'totalCount',v_run.total_count);
end; $$;

create or replace function public.app_cpe_personal_sync_next(p_run_id uuid, p_worker_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item private.app_cpe_personal_sync_items; v_link private.app_cpe_manual_noray_section_links;
begin
  if not exists(select 1 from private.app_cpe_personal_sync_runs
    where id=p_run_id and status='running' and worker_id=p_worker_id) then raise exception 'Orden no disponible'; end if;
  select * into v_item from private.app_cpe_personal_sync_items
    where run_id=p_run_id and status='pending' order by chapa for update skip locked limit 1;
  if v_item.chapa is null then
    update private.app_cpe_personal_sync_runs set status='completed',finished_at=now(),current_chapa=null,
      message='Sincronización finalizada' where id=p_run_id;
    return null;
  end if;
  select * into v_link from private.app_cpe_manual_noray_section_links
    where chapa=v_item.chapa and section='vacaciones';
  if v_link.chapa is null then raise exception 'Enlace personal no disponible'; end if;
  update private.app_cpe_personal_sync_items set status='running' where run_id=p_run_id and chapa=v_item.chapa;
  update private.app_cpe_personal_sync_runs set current_chapa=v_item.chapa where id=p_run_id;
  return jsonb_build_object('chapa',v_item.chapa,'rec',v_link.registro,'pwd',v_link.password_hash);
end; $$;

create or replace function public.app_cpe_personal_sync_save(p_run_id uuid,p_worker_id text,p_chapa text,p_snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_previous jsonb; v_history jsonb;
begin
  if not exists(select 1 from private.app_cpe_personal_sync_runs
    where id=p_run_id and status='running' and worker_id=p_worker_id and current_chapa=p_chapa)
    or not exists(select 1 from private.app_cpe_personal_sync_items
      where run_id=p_run_id and chapa=p_chapa and status='running') then raise exception 'Cuenta no asignada'; end if;
  if p_snapshot->>'chapa' is distinct from p_chapa or p_snapshot->>'schemaVersion' <> '1'
    or jsonb_typeof(p_snapshot->'journals'->'rows') <> 'array'
    or jsonb_typeof(p_snapshot->'rests'->'days') <> 'array'
    or jsonb_typeof(p_snapshot->'vacations'->'periods') <> 'array'
    or pg_catalog.octet_length(p_snapshot::text) > 2000000 then raise exception 'Datos incompletos'; end if;
  select payload into v_previous from private.app_cpe_personal_noray_snapshots where chapa=p_chapa for update;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_history
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

create or replace function public.app_cpe_personal_sync_stop(p_run_id uuid,p_worker_id text,p_message text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.app_cpe_personal_sync_runs set status='stopped',finished_at=now(),current_chapa=null,
    message=left(coalesce(p_message,'Detenida'),200)
    where id=p_run_id and status='running' and worker_id=p_worker_id;
end; $$;

revoke all on function public.app_cpe_get_personal_noray_snapshot(text),
  public.app_cpe_admin_personal_sync_status(text),public.app_cpe_admin_request_personal_sync(text),
  public.app_cpe_personal_sync_heartbeat(text,text),public.app_cpe_personal_sync_claim(text),
  public.app_cpe_personal_sync_next(uuid,text),public.app_cpe_personal_sync_save(uuid,text,text,jsonb),
  public.app_cpe_personal_sync_stop(uuid,text,text) from public,anon,authenticated;
grant execute on function public.app_cpe_get_personal_noray_snapshot(text),
  public.app_cpe_admin_personal_sync_status(text),public.app_cpe_admin_request_personal_sync(text) to anon,authenticated;
grant execute on function public.app_cpe_personal_sync_heartbeat(text,text),
  public.app_cpe_personal_sync_claim(text),public.app_cpe_personal_sync_next(uuid,text),
  public.app_cpe_personal_sync_save(uuid,text,text,jsonb),public.app_cpe_personal_sync_stop(uuid,text,text) to service_role;
