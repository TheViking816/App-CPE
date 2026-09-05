create or replace function public.app_cpe_admin_request_pending_worker(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog, pg_temp as $$
declare v_admin public.app_cpe_users; v_command public.app_cpe_worker_commands;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app_cpe_pending_worker_request', 0));
  select * into v_command from public.app_cpe_worker_commands
  where command_type = 'pending_sync' and status = 'queued'
  order by requested_at limit 1;
  if v_command.id is null then
    insert into public.app_cpe_worker_commands(command_type, requested_by)
    values ('pending_sync', v_admin.chapa) returning * into v_command;
  end if;
  return jsonb_build_object('ok',true,'commandId',v_command.id,'status',v_command.status,'requestedAt',v_command.requested_at);
end;
$$;
revoke all on function public.app_cpe_admin_request_pending_worker(text) from public;
grant execute on function public.app_cpe_admin_request_pending_worker(text) to anon, authenticated;
