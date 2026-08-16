-- Usage analytics are intentionally ephemeral. The page-visits object is a
-- view over this table, so pruning the base table applies to both objects.
delete from public.app_cpe_usage_events
where created_at < now() - interval '24 hours';

select cron.schedule(
  'app-cpe-usage-retention-24h',
  '7 * * * *',
  $$delete from public.app_cpe_usage_events where created_at < now() - interval '24 hours'$$
);

create or replace function public.app_cpe_get_usage_monitor(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_result jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if v_user.chapa <> '72683' then
    raise exception 'Acceso de administrador requerido';
  end if;

  with
  bounds as (
    select now() as window_end, now() - interval '24 hours' as window_start
  ),
  recent as (
    select e.*
    from public.app_cpe_usage_events e, bounds b
    where e.created_at >= b.window_start
  ),
  hourly_source as (
    select
      date_trunc('hour', created_at) as bucket,
      count(*) filter (where event_type = 'page_visit')::int as views,
      count(distinct chapa) filter (where chapa is not null)::int as users
    from recent
    group by 1
  ),
  hourly as (
    select
      series.bucket,
      coalesce(source.views, 0) as views,
      coalesce(source.users, 0) as users
    from (
      select generate_series(
        date_trunc('hour', now()) - interval '23 hours',
        date_trunc('hour', now()),
        interval '1 hour'
      ) as bucket
    ) series
    left join hourly_source source using (bucket)
    order by series.bucket
  ),
  user_rows as (
    select
      chapa,
      count(*)::int as events,
      count(*) filter (where event_type = 'page_visit')::int as views,
      min(created_at) as first_seen,
      max(created_at) as last_seen,
      (array_agg(page_key order by created_at desc) filter (where page_key is not null))[1] as last_page
    from recent
    where chapa is not null
    group by chapa
  ),
  page_rows as (
    select
      page_key,
      count(*)::int as views,
      count(distinct chapa)::int as users,
      max(created_at) as last_visit
    from recent
    where event_type = 'page_visit' and page_key is not null
    group by page_key
  ),
  event_rows as (
    select event_type, count(*)::int as total
    from recent
    group by event_type
  )
  select jsonb_build_object(
    'generatedAt', b.window_end,
    'windowStart', b.window_start,
    'retentionHours', 24,
    'summary', jsonb_build_object(
      'uniqueUsers', (select count(distinct chapa) from recent where chapa is not null),
      'activeNow', (select count(distinct chapa) from recent where chapa is not null and created_at >= now() - interval '15 minutes'),
      'pageViews', (select count(*) from recent where event_type = 'page_visit'),
      'appOpens', (select count(*) from recent where event_type = 'app_open'),
      'logins', (select count(*) from recent where event_type in ('login', 'support_login')),
      'totalEvents', (select count(*) from recent),
      'registeredUsers', (select count(*) from public.app_cpe_users),
      'peakHourlyUsers', coalesce((select max(users) from hourly), 0),
      'peakHourlyViews', coalesce((select max(views) from hourly), 0)
    ),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('at', bucket, 'views', views, 'users', users) order by bucket)
      from hourly
    ), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('page', page_key, 'views', views, 'users', users, 'lastVisit', last_visit) order by views desc, page_key)
      from page_rows
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object('chapa', chapa, 'events', events, 'views', views, 'firstSeen', first_seen, 'lastSeen', last_seen, 'lastPage', last_page, 'active', last_seen >= now() - interval '15 minutes') order by last_seen desc)
      from user_rows
    ), '[]'::jsonb),
    'eventTypes', coalesce((
      select jsonb_agg(jsonb_build_object('type', event_type, 'total', total) order by total desc, event_type)
      from event_rows
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', item.id, 'chapa', item.chapa, 'type', item.event_type, 'page', item.page_key, 'at', item.created_at) order by item.created_at desc)
      from (
        select id, chapa, event_type, page_key, created_at
        from recent
        order by created_at desc
        limit 100
      ) item
    ), '[]'::jsonb)
  ) into v_result
  from bounds b;

  return v_result;
end;
$$;

revoke all on function public.app_cpe_get_usage_monitor(text) from public;
grant execute on function public.app_cpe_get_usage_monitor(text) to anon, authenticated;
