create or replace function public.app_cpe_track_event(
  p_event_type text,
  p_chapa text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_chapa text := nullif(regexp_replace(coalesce(p_chapa, ''), '\D', '', 'g'), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if v_event_type not in (
    'app_open',
    'login',
    'register',
    'specialties_update',
    'portal_open',
    'portal_sync_started',
    'portal_sync_completed',
    'portal_sync_failed'
  ) then
    raise exception 'Evento no permitido';
  end if;

  if v_chapa is not null and length(v_chapa) > 5 then
    v_chapa := right(v_chapa, 5);
  end if;

  if v_chapa = '72683' then
    return jsonb_build_object('ok', true, 'tracked', false);
  end if;

  insert into public.app_cpe_usage_events (event_type, chapa, metadata)
  values (v_event_type, v_chapa, v_metadata);

  return jsonb_build_object('ok', true, 'tracked', true);
end;
$$;

revoke all on function public.app_cpe_track_event(text, text, jsonb) from public;
grant execute on function public.app_cpe_track_event(text, text, jsonb) to anon, authenticated;

create or replace function public.app_cpe_create_portal_sync_job(
  p_token text,
  p_portal_password text,
  p_security_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if length(coalesce(p_portal_password, '')) < 1 then
    raise exception 'Introduce la contrasena del portal';
  end if;

  delete from public.app_cpe_portal_sync_jobs
  where expires_at < now()
     or (chapa = v_user.chapa and status in ('completed', 'failed') and requested_at < now() - interval '1 hour');

  insert into public.app_cpe_portal_sync_jobs (chapa, portal_password, security_key)
  values (v_user.chapa, p_portal_password, nullif(p_security_key, ''))
  returning * into v_job;

  if v_user.chapa <> '72683' then
    insert into public.app_cpe_usage_events (event_type, chapa, metadata)
    values (
      'portal_sync_started',
      v_user.chapa,
      jsonb_build_object(
        'job_id', v_job.id,
        'with_primas_key', nullif(p_security_key, '') is not null
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'requestedAt', v_job.requested_at
  );
end;
$$;

revoke all on function public.app_cpe_create_portal_sync_job(text, text, text) from public;
grant execute on function public.app_cpe_create_portal_sync_job(text, text, text) to anon, authenticated;

create or replace function public.app_cpe_track_portal_sync_result()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if new.chapa = '72683'
     or new.status not in ('completed', 'failed')
     or new.status is not distinct from old.status then
    return new;
  end if;

  insert into public.app_cpe_usage_events (event_type, chapa, metadata)
  values (
    case when new.status = 'completed' then 'portal_sync_completed' else 'portal_sync_failed' end,
    new.chapa,
    jsonb_strip_nulls(jsonb_build_object(
      'job_id', new.id,
      'duration_seconds', extract(epoch from (coalesce(new.finished_at, now()) - coalesce(new.started_at, new.requested_at)))::integer,
      'message', case when new.status = 'failed' then new.message else null end
    ))
  );

  return new;
end;
$$;

revoke all on function public.app_cpe_track_portal_sync_result() from public;

drop trigger if exists app_cpe_portal_sync_result_usage on public.app_cpe_portal_sync_jobs;
create trigger app_cpe_portal_sync_result_usage
after update of status on public.app_cpe_portal_sync_jobs
for each row
execute function public.app_cpe_track_portal_sync_result();

create or replace view public.app_cpe_portal_usage_monitor
with (security_invoker = true)
as
select
  id,
  chapa,
  event_type,
  case event_type
    when 'portal_open' then 'Abre la pestana Portal'
    when 'portal_sync_started' then 'Introduce claves e inicia lectura'
    when 'portal_sync_completed' then 'Lectura completada'
    when 'portal_sync_failed' then 'Lectura fallida'
    else event_type
  end as action,
  metadata,
  created_at,
  updated_at
from public.app_cpe_usage_events
where event_type like 'portal_%'
order by created_at desc;

revoke all on public.app_cpe_portal_usage_monitor from anon, authenticated;

create or replace view public.app_cpe_usage_daily_stats
with (security_invoker = true)
as
select
  date_trunc('day', created_at)::date as day,
  count(*) filter (where event_type = 'app_open') as app_opens,
  count(*) filter (where event_type = 'login') as logins,
  count(*) filter (where event_type = 'register') as registrations,
  count(*) filter (where event_type = 'specialties_update') as specialties_updates,
  count(distinct chapa) filter (where chapa is not null) as unique_chapas,
  count(*) filter (where event_type = 'portal_open') as portal_opens,
  count(*) filter (where event_type = 'portal_sync_started') as portal_syncs_started,
  count(*) filter (where event_type = 'portal_sync_completed') as portal_syncs_completed,
  count(*) filter (where event_type = 'portal_sync_failed') as portal_syncs_failed
from public.app_cpe_usage_events
group by 1
order by 1 desc;

revoke all on public.app_cpe_usage_daily_stats from anon, authenticated;
