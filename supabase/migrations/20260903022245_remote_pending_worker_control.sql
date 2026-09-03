create table if not exists public.app_cpe_worker_commands (
  id uuid primary key default gen_random_uuid(),
  command_type text not null check (command_type in ('pending_sync')),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'completed', 'failed')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  worker_id text,
  message text
);

create index if not exists app_cpe_worker_commands_pending_idx
  on public.app_cpe_worker_commands (status, requested_at);

alter table public.app_cpe_worker_commands enable row level security;
revoke all on public.app_cpe_worker_commands from public, anon, authenticated;
grant select, insert, update on public.app_cpe_worker_commands to service_role;

create table if not exists public.app_cpe_worker_nodes (
  worker_id text primary key,
  status text not null default 'idle',
  message text,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_cpe_worker_nodes enable row level security;
revoke all on public.app_cpe_worker_nodes from public, anon, authenticated;
grant select, insert, update on public.app_cpe_worker_nodes to service_role;

create or replace function public.app_cpe_admin_request_pending_worker(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_command public.app_cpe_worker_commands;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;

  select * into v_command
  from public.app_cpe_worker_commands
  where command_type = 'pending_sync'
    and status in ('queued', 'claimed')
    and requested_at > now() - interval '6 hours'
  order by requested_at desc
  limit 1;

  if v_command.id is null then
    insert into public.app_cpe_worker_commands (command_type, requested_by)
    values ('pending_sync', v_admin.chapa)
    returning * into v_command;
  end if;

  return jsonb_build_object(
    'ok', true,
    'commandId', v_command.id,
    'status', v_command.status,
    'requestedAt', v_command.requested_at
  );
end;
$$;

create or replace function public.app_cpe_admin_worker_control_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_node public.app_cpe_worker_nodes;
  v_command public.app_cpe_worker_commands;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;

  select * into v_node from public.app_cpe_worker_nodes order by last_seen_at desc limit 1;
  select * into v_command from public.app_cpe_worker_commands order by requested_at desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'pcOnline', v_node.last_seen_at is not null and v_node.last_seen_at > now() - interval '45 seconds',
    'pcStatus', coalesce(v_node.status, 'offline'),
    'pcMessage', v_node.message,
    'lastSeenAt', v_node.last_seen_at,
    'commandId', v_command.id,
    'commandStatus', v_command.status,
    'commandMessage', v_command.message,
    'requestedAt', v_command.requested_at,
    'claimedAt', v_command.claimed_at,
    'finishedAt', v_command.finished_at
  );
end;
$$;

create or replace function public.app_cpe_worker_heartbeat(
  p_worker_id text,
  p_status text default 'idle',
  p_message text default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
begin
  insert into public.app_cpe_worker_nodes (worker_id, status, message, last_seen_at, updated_at)
  values (left(coalesce(nullif(trim(p_worker_id), ''), 'home-pc'), 120), left(coalesce(p_status, 'idle'), 40), left(p_message, 500), now(), now())
  on conflict (worker_id) do update
  set status = excluded.status,
      message = excluded.message,
      last_seen_at = now(),
      updated_at = now();
end;
$$;

create or replace function public.app_cpe_claim_worker_command(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_command public.app_cpe_worker_commands;
begin
  select * into v_command
  from public.app_cpe_worker_commands
  where status = 'queued' and command_type = 'pending_sync'
  order by requested_at
  for update skip locked
  limit 1;

  if v_command.id is null then return null; end if;

  update public.app_cpe_worker_commands
  set status = 'claimed', claimed_at = now(), worker_id = left(p_worker_id, 120), message = 'Orden recibida por el PC'
  where id = v_command.id
  returning * into v_command;

  return jsonb_build_object('id', v_command.id, 'commandType', v_command.command_type, 'requestedAt', v_command.requested_at);
end;
$$;

create or replace function public.app_cpe_finish_worker_command(
  p_id uuid,
  p_worker_id text,
  p_status text,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if p_status not in ('completed', 'failed') then raise exception 'Estado final no válido'; end if;
  update public.app_cpe_worker_commands
  set status = p_status,
      finished_at = now(),
      worker_id = left(p_worker_id, 120),
      message = left(p_message, 1000)
  where id = p_id and status = 'claimed' and worker_id = left(p_worker_id, 120);
end;
$$;

revoke all on function public.app_cpe_admin_request_pending_worker(text) from public, anon, authenticated;
revoke all on function public.app_cpe_admin_worker_control_status(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_request_pending_worker(text) to anon, authenticated;
grant execute on function public.app_cpe_admin_worker_control_status(text) to anon, authenticated;

revoke all on function public.app_cpe_worker_heartbeat(text, text, text) from public, anon, authenticated;
revoke all on function public.app_cpe_claim_worker_command(text) from public, anon, authenticated;
revoke all on function public.app_cpe_finish_worker_command(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_worker_heartbeat(text, text, text) to service_role;
grant execute on function public.app_cpe_claim_worker_command(text) to service_role;
grant execute on function public.app_cpe_finish_worker_command(uuid, text, text, text) to service_role;
