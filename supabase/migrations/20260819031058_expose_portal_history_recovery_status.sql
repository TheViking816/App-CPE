create or replace function public.app_cpe_admin_portal_sync_users(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_users jsonb;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'chapa', users.chapa,
      'email', users.email,
      'activationStatus', users.portal_activation_status,
      'hasCredentials', coalesce(config.enabled, false) and config.portal_password_secret_id is not null,
      'hasSecurityKey', config.security_key_secret_id is not null,
      'hasPremiumHistory', coalesce(jsonb_array_length(
        case when jsonb_typeof(snapshot.payload #> '{primas,history}') = 'array'
          then snapshot.payload #> '{primas,history}' else '[]'::jsonb end
      ), 0) > 0,
      'premiumHistoryMonths', coalesce(jsonb_array_length(
        case when jsonb_typeof(snapshot.payload #> '{primas,history}') = 'array'
          then snapshot.payload #> '{primas,history}' else '[]'::jsonb end
      ), 0),
      'fullHistoryCompletedAt', snapshot.payload #>> '{sync,fullHistoryCompletedAt}',
      'lastSuccessAt', config.last_success_at,
      'jobStatus', jobs.status,
      'jobMessage', jobs.message,
      'triggerSource', jobs.trigger_source,
      'requestKind', jobs.request_kind,
      'requestedAt', jobs.requested_at,
      'startedAt', jobs.started_at,
      'finishedAt', jobs.finished_at
    ) order by
      case
        when users.portal_activation_status = 'pending' then 0
        when not (coalesce(jsonb_array_length(
          case when jsonb_typeof(snapshot.payload #> '{primas,history}') = 'array'
            then snapshot.payload #> '{primas,history}' else '[]'::jsonb end
        ), 0) > 0) then 1
        when jobs.status = 'failed' then 2
        when jobs.status in ('queued', 'running') then 3
        else 4
      end,
      users.chapa
  ), '[]'::jsonb)
  into v_users
  from public.app_cpe_users users
  left join public.app_cpe_portal_auto_sync config on config.chapa = users.chapa
  left join public.app_cpe_portal_sync_jobs jobs on jobs.chapa = users.chapa
  left join public.app_cpe_portal_snapshots snapshot on snapshot.chapa = users.chapa
  where users.chapa <> v_admin.chapa
    and (config.chapa is not null or users.portal_activation_status = 'pending');

  return jsonb_build_object('ok', true, 'users', v_users, 'generatedAt', now());
end;
$$;

revoke all on function public.app_cpe_admin_portal_sync_users(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_portal_sync_users(text) to anon, authenticated;
