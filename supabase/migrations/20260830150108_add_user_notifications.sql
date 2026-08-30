create table if not exists public.app_cpe_user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  chapa text not null references public.app_cpe_users(chapa) on delete cascade,
  event_type text not null check (event_type in (
    'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
    'rests_changed', 'vacations_changed', 'exceptions_changed'
  )),
  title text not null,
  body text not null default '',
  entity_key text not null,
  change_hash text not null,
  target_tab text not null check (target_tab in (
    'contratacion', 'sueldometro', 'nominas', 'descansos', 'vacaciones', 'excepciones'
  )),
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chapa, event_type, entity_key, change_hash)
);

create index if not exists app_cpe_user_notifications_user_created_idx
  on public.app_cpe_user_notifications (user_id, created_at desc);

create index if not exists app_cpe_user_notifications_user_unread_idx
  on public.app_cpe_user_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.app_cpe_user_notifications enable row level security;
revoke all on public.app_cpe_user_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.app_cpe_user_notifications to service_role;

create or replace function public.app_cpe_record_portal_notifications(
  p_chapa text,
  p_notifications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_user_id uuid;
  v_item jsonb;
  v_inserted integer := 0;
begin
  select id into v_user_id
  from public.app_cpe_users
  where chapa = regexp_replace(coalesce(p_chapa, ''), '\D', '', 'g');

  if v_user_id is null then
    raise exception 'Usuario no encontrado';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_notifications, '[]'::jsonb)) > 50 then
    raise exception 'Lote de novedades no valido';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb)) loop
    if coalesce(v_item->>'eventType', '') not in (
      'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
      'rests_changed', 'vacations_changed', 'exceptions_changed'
    ) then
      continue;
    end if;
    if coalesce(v_item->>'targetTab', '') not in (
      'contratacion', 'sueldometro', 'nominas', 'descansos', 'vacaciones', 'excepciones'
    ) then
      continue;
    end if;
    if length(coalesce(v_item->>'entityKey', '')) < 1
       or length(coalesce(v_item->>'changeHash', '')) < 8 then
      continue;
    end if;

    insert into public.app_cpe_user_notifications (
      user_id, chapa, event_type, title, body, entity_key,
      change_hash, target_tab, metadata
    ) values (
      v_user_id,
      regexp_replace(coalesce(p_chapa, ''), '\D', '', 'g'),
      v_item->>'eventType',
      left(coalesce(v_item->>'title', 'Novedad del portal'), 140),
      left(coalesce(v_item->>'body', ''), 500),
      left(v_item->>'entityKey', 300),
      left(v_item->>'changeHash', 128),
      v_item->>'targetTab',
      coalesce(v_item->'metadata', '{}'::jsonb)
    )
    on conflict (chapa, event_type, entity_key, change_hash) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  delete from public.app_cpe_user_notifications
  where created_at < now() - interval '90 days';

  return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.app_cpe_record_portal_notifications(text, jsonb) from public, anon, authenticated;
grant execute on function public.app_cpe_record_portal_notifications(text, jsonb) to service_role;

create or replace function public.app_cpe_get_notifications(
  p_token text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_rows jsonb;
  v_unread integer;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select coalesce(jsonb_agg(to_jsonb(items) order by items.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, event_type as "eventType", title, body,
           entity_key as "entityKey", target_tab as "targetTab",
           metadata, read_at as "readAt", created_at as "createdAt"
    from public.app_cpe_user_notifications
    where user_id = v_user.id
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ) items;

  select count(*)::integer into v_unread
  from public.app_cpe_user_notifications
  where user_id = v_user.id and read_at is null;

  return jsonb_build_object('ok', true, 'unread', v_unread, 'rows', v_rows);
end;
$$;

revoke all on function public.app_cpe_get_notifications(text, integer) from public;
grant execute on function public.app_cpe_get_notifications(text, integer) to anon, authenticated;

create or replace function public.app_cpe_mark_notifications_read(
  p_token text,
  p_notification_id uuid default null,
  p_all boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated integer := 0;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  update public.app_cpe_user_notifications
  set read_at = coalesce(read_at, now())
  where user_id = v_user.id
    and read_at is null
    and (coalesce(p_all, false) or id = p_notification_id);
  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;

revoke all on function public.app_cpe_mark_notifications_read(text, uuid, boolean) from public;
grant execute on function public.app_cpe_mark_notifications_read(text, uuid, boolean) to anon, authenticated;
