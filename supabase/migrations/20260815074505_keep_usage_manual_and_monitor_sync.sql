-- `usage` is reserved for actions explicitly initiated in the app.
-- Portal refreshes are operational events and remain in app_cpe_portal_sync_jobs.
delete from public.app_cpe_usage_events
where event_type in (
  'portal_sync_started',
  'portal_sync_completed',
  'portal_sync_failed',
  'portal_sync_all_started'
);

create or replace function public.app_cpe_usage_manual_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.event_type in (
    'portal_sync_started',
    'portal_sync_completed',
    'portal_sync_failed',
    'portal_sync_all_started'
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.app_cpe_usage_manual_only() from public;

drop trigger if exists app_cpe_usage_manual_only on public.app_cpe_usage_events;
create trigger app_cpe_usage_manual_only
before insert on public.app_cpe_usage_events
for each row
execute function public.app_cpe_usage_manual_only();

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
  v_chapa text := nullif(regexp_replace(coalesce(p_chapa, ''), '\\D', '', 'g'), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if v_event_type not in (
    'app_open',
    'login',
    'register',
    'specialties_update',
    'portal_open',
    'tablon_general_open',
    'password_change'
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

create or replace view public.app_cpe_portal_usage_monitor
with (security_invoker = true)
as
select
  id,
  chapa,
  event_type,
  'Visita una sección del portal'::text as action,
  metadata,
  created_at,
  updated_at
from public.app_cpe_usage_events
where event_type = 'portal_open'
order by created_at desc;

revoke all on public.app_cpe_portal_usage_monitor from anon, authenticated;

create or replace view public.app_cpe_sync_portal_monitor
with (security_invoker = true)
as
select
  id,
  chapa,
  trigger_source,
  request_kind,
  document_id,
  status,
  message,
  requested_at,
  started_at,
  finished_at,
  expires_at,
  created_at
from public.app_cpe_portal_sync_jobs
order by requested_at desc;

revoke all on public.app_cpe_sync_portal_monitor from anon, authenticated;

drop view if exists public.app_cpe_usage_daily_stats;
create view public.app_cpe_usage_daily_stats
with (security_invoker = true)
as
select
  date_trunc('day', created_at)::date as day,
  count(*) as manual_events,
  count(*) filter (where event_type = 'app_open') as app_opens,
  count(*) filter (where event_type = 'login') as logins,
  count(*) filter (where event_type = 'register') as registrations,
  count(*) filter (where event_type = 'specialties_update') as specialties_updates,
  count(*) filter (where event_type = 'portal_open') as portal_section_visits,
  count(*) filter (where event_type = 'tablon_general_open') as tablon_general_opens,
  count(*) filter (where event_type = 'password_change') as password_changes,
  count(distinct chapa) filter (where chapa is not null) as unique_chapas
from public.app_cpe_usage_events
group by 1
order by 1 desc;

revoke all on public.app_cpe_usage_daily_stats from anon, authenticated;
