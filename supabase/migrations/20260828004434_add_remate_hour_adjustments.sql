create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_cpe_remate_hours (
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  jornal_key text not null,
  hours smallint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, jornal_key),
  constraint app_cpe_remate_hours_key_length check (length(jornal_key) between 12 and 300),
  constraint app_cpe_remate_hours_value check (hours in (1, 2))
);

alter table private.app_cpe_remate_hours enable row level security;
revoke all on table private.app_cpe_remate_hours from public, anon, authenticated;

create or replace function public.app_cpe_get_remate_hours(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_hours jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(jsonb_object_agg(jornal_key, hours), '{}'::jsonb)
  into v_hours
  from private.app_cpe_remate_hours
  where user_id = v_user.id;
  return v_hours;
end;
$$;

create or replace function public.app_cpe_set_remate_hours(
  p_token text,
  p_jornal_key text,
  p_hours integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_hours integer := coalesce(p_hours, 0);
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if length(coalesce(p_jornal_key, '')) < 12
    or length(p_jornal_key) > 300
    or p_jornal_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\|'
  then
    raise exception 'Jornal no valido';
  end if;
  if v_hours not in (0, 1, 2) then
    raise exception 'Las horas de remate deben ser 0, 1 o 2';
  end if;

  if v_hours > 0 then
    insert into private.app_cpe_remate_hours (user_id, jornal_key, hours, updated_at)
    values (v_user.id, p_jornal_key, v_hours, now())
    on conflict (user_id, jornal_key) do update
      set hours = excluded.hours, updated_at = excluded.updated_at;
  else
    delete from private.app_cpe_remate_hours
    where user_id = v_user.id and jornal_key = p_jornal_key;
  end if;

  return jsonb_build_object(
    'ok', true,
    'jornalKey', p_jornal_key,
    'hours', v_hours
  );
end;
$$;

revoke all on function public.app_cpe_get_remate_hours(text) from public, anon, authenticated;
revoke all on function public.app_cpe_set_remate_hours(text, text, integer) from public, anon, authenticated;
grant execute on function public.app_cpe_get_remate_hours(text) to anon, authenticated;
grant execute on function public.app_cpe_set_remate_hours(text, text, integer) to anon, authenticated;
