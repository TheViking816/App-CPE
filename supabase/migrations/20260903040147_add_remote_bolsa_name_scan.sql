alter table public.app_cpe_worker_commands
  drop constraint if exists app_cpe_worker_commands_command_type_check;

alter table public.app_cpe_worker_commands
  add constraint app_cpe_worker_commands_command_type_check
  check (command_type in ('pending_sync', 'current_month_all', 'bolsa_name_scan'));

create or replace function public.app_cpe_admin_request_bolsa_name_scan(p_token text)
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
  where command_type = 'bolsa_name_scan'
    and status in ('queued', 'claimed')
    and requested_at > now() - interval '6 hours'
  order by requested_at desc
  limit 1;

  if v_command.id is null then
    insert into public.app_cpe_worker_commands (command_type, requested_by)
    values ('bolsa_name_scan', v_admin.chapa)
    returning * into v_command;
  end if;

  return jsonb_build_object(
    'ok', true,
    'commandId', v_command.id,
    'commandType', v_command.command_type,
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
  v_pending public.app_cpe_worker_commands;
  v_current_month public.app_cpe_worker_commands;
  v_bolsa_names public.app_cpe_worker_commands;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;

  select * into v_node from public.app_cpe_worker_nodes order by last_seen_at desc limit 1;
  select * into v_pending from public.app_cpe_worker_commands where command_type = 'pending_sync' order by requested_at desc limit 1;
  select * into v_current_month from public.app_cpe_worker_commands where command_type = 'current_month_all' order by requested_at desc limit 1;
  select * into v_bolsa_names from public.app_cpe_worker_commands where command_type = 'bolsa_name_scan' order by requested_at desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'pcOnline', v_node.last_seen_at is not null and v_node.last_seen_at > now() - interval '45 seconds',
    'pcStatus', coalesce(v_node.status, 'offline'),
    'pcMessage', v_node.message,
    'lastSeenAt', v_node.last_seen_at,
    'pendingCommandStatus', v_pending.status,
    'pendingCommandMessage', v_pending.message,
    'currentMonthCommandStatus', v_current_month.status,
    'currentMonthCommandMessage', v_current_month.message,
    'bolsaNameScanCommandStatus', v_bolsa_names.status,
    'bolsaNameScanCommandMessage', v_bolsa_names.message
  );
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
  where status = 'queued'
    and command_type in ('pending_sync', 'current_month_all', 'bolsa_name_scan')
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

revoke all on function public.app_cpe_admin_request_bolsa_name_scan(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_request_bolsa_name_scan(text) to anon, authenticated;
