create extension if not exists pgcrypto;

create table if not exists public.app_cpe_users (
  id uuid primary key default gen_random_uuid(),
  chapa text not null unique,
  password_hash text not null,
  specialties text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_cpe_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.app_cpe_users enable row level security;
alter table public.app_cpe_sessions enable row level security;

create or replace function public.app_cpe_normalize_chapa(p_chapa text)
returns text
language plpgsql
immutable
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_chapa, ''), '\D', '', 'g');
  if v_digits = '' then
    raise exception 'Chapa no valida';
  end if;
  if length(v_digits) >= 5 then
    return right(v_digits, 5);
  end if;
  return '7' || lpad(v_digits, 4, '0');
end;
$$;

create or replace function public.app_cpe_public_user(p_user public.app_cpe_users, p_token text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'token', p_token,
    'chapa', p_user.chapa,
    'specialties', p_user.specialties,
    'createdAt', p_user.created_at
  );
$$;

create or replace function public.app_cpe_create_session(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
begin
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.app_cpe_sessions (token_hash, user_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), p_user_id, now() + interval '180 days');
  return v_token;
end;
$$;

create or replace function public.app_cpe_register(p_chapa text, p_password text, p_specialties text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_token text;
  v_chapa text;
  v_specialties text[];
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'La contraseña debe tener al menos 4 caracteres';
  end if;

  v_specialties := coalesce(p_specialties, '{}'::text[]);
  if cardinality(v_specialties) is null or cardinality(v_specialties) = 0 then
    raise exception 'Selecciona al menos una especialidad';
  end if;

  insert into public.app_cpe_users (chapa, password_hash, specialties)
  values (v_chapa, crypt(p_password, gen_salt('bf')), v_specialties)
  returning * into v_user;

  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user, v_token);
exception
  when unique_violation then
    raise exception 'Esa chapa ya esta registrada';
end;
$$;

create or replace function public.app_cpe_login(p_chapa text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_token text;
begin
  select * into v_user
  from public.app_cpe_users
  where chapa = public.app_cpe_normalize_chapa(p_chapa);

  if v_user.id is null or v_user.password_hash <> crypt(coalesce(p_password, ''), v_user.password_hash) then
    raise exception 'Chapa o contraseña incorrecta';
  end if;

  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user, v_token);
end;
$$;

create or replace function public.app_cpe_user_from_token(p_token text)
returns public.app_cpe_users
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
begin
  delete from public.app_cpe_sessions where expires_at < now();

  select u.* into v_user
  from public.app_cpe_sessions s
  join public.app_cpe_users u on u.id = s.user_id
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now();

  if v_user.id is null then
    raise exception 'Sesion no valida';
  end if;

  return v_user;
end;
$$;

create or replace function public.app_cpe_update_specialties(p_token text, p_specialties text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
  v_specialties text[];
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_specialties := coalesce(p_specialties, '{}'::text[]);
  if cardinality(v_specialties) is null or cardinality(v_specialties) = 0 then
    raise exception 'Selecciona al menos una especialidad';
  end if;

  update public.app_cpe_users
  set specialties = v_specialties,
      updated_at = now()
  where id = v_user.id
  returning * into v_updated;

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

grant usage on schema public to anon, authenticated;
grant execute on function public.app_cpe_register(text, text, text[]) to anon, authenticated;
grant execute on function public.app_cpe_login(text, text) to anon, authenticated;
grant execute on function public.app_cpe_update_specialties(text, text[]) to anon, authenticated;
