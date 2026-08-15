alter table public.app_cpe_usage_events
  add column if not exists page_key text;

alter table public.app_cpe_usage_events
  add constraint app_cpe_usage_events_page_key_check
  check (
    page_key is null
    or page_key in (
      'inicio',
      'contratacion',
      'sueldometro',
      'descansos',
      'vacaciones',
      'nominas',
      'estado',
      'puertas',
      'censo',
      'portal',
      'tablon',
      'enlaces'
    )
  );

create index if not exists app_cpe_usage_events_page_created_idx
  on public.app_cpe_usage_events (page_key, created_at desc)
  where page_key is not null;

create or replace function public.app_cpe_track_page_visit(
  p_token text,
  p_page text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_page text := lower(trim(coalesce(p_page, '')));
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if v_page not in (
    'inicio',
    'contratacion',
    'sueldometro',
    'descansos',
    'vacaciones',
    'nominas',
    'estado',
    'puertas',
    'censo',
    'portal',
    'tablon',
    'enlaces'
  ) then
    raise exception 'Página no permitida';
  end if;

  if v_user.chapa = '72683' then
    return jsonb_build_object('ok', true, 'tracked', false);
  end if;

  insert into public.app_cpe_usage_events (event_type, chapa, page_key, metadata)
  values (
    'page_visit',
    v_user.chapa,
    v_page,
    jsonb_build_object('page', v_page)
  );

  return jsonb_build_object('ok', true, 'tracked', true, 'page', v_page);
end;
$$;

revoke all on function public.app_cpe_track_page_visit(text, text) from public;
grant execute on function public.app_cpe_track_page_visit(text, text) to anon, authenticated;

create or replace view public.app_cpe_usage_page_visits
with (security_invoker = true)
as
select
  id,
  chapa,
  page_key,
  created_at
from public.app_cpe_usage_events
where event_type = 'page_visit'
order by created_at desc;

revoke all on public.app_cpe_usage_page_visits from anon, authenticated;

create or replace view public.app_cpe_portal_usage_monitor
with (security_invoker = true)
as
select
  id,
  chapa,
  event_type,
  case
    when event_type = 'page_visit' then 'Visita: ' || page_key
    else 'Visita una sección del portal'
  end as action,
  jsonb_strip_nulls(jsonb_build_object('page', page_key, 'legacy', event_type = 'portal_open')) as metadata,
  created_at,
  updated_at
from public.app_cpe_usage_events
where event_type in ('portal_open', 'page_visit')
order by created_at desc;

revoke all on public.app_cpe_portal_usage_monitor from anon, authenticated;

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
  count(*) filter (where event_type = 'page_visit') as page_visits,
  count(*) filter (where event_type = 'page_visit' and page_key = 'sueldometro') as sueldometro_visits,
  count(*) filter (where event_type = 'page_visit' and page_key = 'descansos') as descansos_visits,
  count(*) filter (where event_type = 'page_visit' and page_key = 'vacaciones') as vacaciones_visits,
  count(*) filter (where event_type = 'page_visit' and page_key = 'nominas') as nominas_visits,
  count(*) filter (where event_type = 'tablon_general_open') as tablon_general_opens,
  count(*) filter (where event_type = 'password_change') as password_changes,
  count(distinct chapa) filter (where chapa is not null) as unique_chapas
from public.app_cpe_usage_events
group by 1
order by 1 desc;

revoke all on public.app_cpe_usage_daily_stats from anon, authenticated;
