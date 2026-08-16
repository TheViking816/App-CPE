create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_cpe_relay_hours (
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  jornal_key text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, jornal_key),
  constraint app_cpe_relay_hours_key_length check (length(jornal_key) between 12 and 300)
);

alter table private.app_cpe_relay_hours enable row level security;
revoke all on table private.app_cpe_relay_hours from public, anon, authenticated;

create or replace function public.app_cpe_get_relay_hours(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_hours jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_object_agg(jornal_key, true), '{}'::jsonb)
  into v_hours
  from private.app_cpe_relay_hours
  where user_id = v_user.id;
  return v_hours;
end;
$$;

create or replace function public.app_cpe_set_relay_hour(
  p_token text,
  p_jornal_key text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if length(coalesce(p_jornal_key, '')) < 12
    or length(p_jornal_key) > 300
    or p_jornal_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\|'
  then
    raise exception 'Jornal no valido';
  end if;

  if coalesce(p_enabled, false) then
    insert into private.app_cpe_relay_hours (user_id, jornal_key, updated_at)
    values (v_user.id, p_jornal_key, now())
    on conflict (user_id, jornal_key) do update set updated_at = excluded.updated_at;
  else
    delete from private.app_cpe_relay_hours
    where user_id = v_user.id and jornal_key = p_jornal_key;
  end if;

  return jsonb_build_object(
    'ok', true,
    'jornalKey', p_jornal_key,
    'enabled', coalesce(p_enabled, false)
  );
end;
$$;

revoke all on function public.app_cpe_get_relay_hours(text) from public, anon, authenticated;
revoke all on function public.app_cpe_set_relay_hour(text, text, boolean) from public, anon, authenticated;
grant execute on function public.app_cpe_get_relay_hours(text) to anon, authenticated;
grant execute on function public.app_cpe_set_relay_hour(text, text, boolean) to anon, authenticated;
