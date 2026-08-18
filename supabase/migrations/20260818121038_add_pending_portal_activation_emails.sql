alter table public.app_cpe_users
  add column if not exists email text,
  add column if not exists portal_activation_status text not null default 'active'
    check (portal_activation_status in ('pending', 'active')),
  add column if not exists portal_activated_at timestamptz;

create table if not exists public.app_cpe_activation_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  kind text not null check (kind in ('admin_pending', 'user_activated')),
  recipient text not null,
  chapa text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, kind)
);

alter table public.app_cpe_activation_email_outbox enable row level security;
revoke all on table public.app_cpe_activation_email_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.app_cpe_activation_email_outbox to service_role;

create or replace function public.app_cpe_public_user(p_user public.app_cpe_users, p_token text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'token', p_token,
    'chapa', p_user.chapa,
    'email', p_user.email,
    'specialties', p_user.specialties,
    'portalActivationStatus', p_user.portal_activation_status,
    'portalActivatedAt', p_user.portal_activated_at,
    'createdAt', p_user.created_at
  );
$$;

create or replace function public.app_cpe_register(p_chapa text, p_password text, p_specialties text[], p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_token text;
  v_chapa text;
  v_email text;
  v_specialties text[];
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);
  v_email := lower(trim(coalesce(p_email, '')));
  if length(coalesce(p_password, '')) < 4 then raise exception 'La contraseña debe tener al menos 4 caracteres'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Introduce un correo electrónico válido'; end if;
  v_specialties := coalesce(p_specialties, '{}'::text[]);
  if cardinality(v_specialties) is null or cardinality(v_specialties) = 0 then raise exception 'Selecciona al menos una especialidad'; end if;

  insert into public.app_cpe_users (chapa, password_hash, specialties, email, portal_activation_status)
  values (v_chapa, crypt(p_password, gen_salt('bf')), v_specialties, v_email, 'pending')
  returning * into v_user;
  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user, v_token);
exception
  when unique_violation then raise exception 'Esa chapa ya está registrada';
end;
$$;

revoke all on function public.app_cpe_register(text, text, text[], text) from public;
grant execute on function public.app_cpe_register(text, text, text[], text) to anon, authenticated;

create or replace function private.app_cpe_queue_pending_activation_email()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_user public.app_cpe_users;
begin
  select * into v_user from public.app_cpe_users where chapa = new.chapa;
  if v_user.id is not null and v_user.portal_activation_status = 'pending' and v_user.email is not null then
    insert into public.app_cpe_activation_email_outbox (user_id, kind, recipient, chapa)
    values (v_user.id, 'admin_pending', 'portalestibavlc@gmail.com', v_user.chapa)
    on conflict (user_id, kind) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists app_cpe_queue_pending_activation_email on public.app_cpe_portal_auto_sync;
create trigger app_cpe_queue_pending_activation_email
after insert or update of portal_password_secret_id on public.app_cpe_portal_auto_sync
for each row execute function private.app_cpe_queue_pending_activation_email();

create or replace function private.app_cpe_activate_user_after_first_sync()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_user public.app_cpe_users;
begin
  if new.status <> 'completed' or old.status is not distinct from new.status or new.request_kind = 'document' then return new; end if;
  update public.app_cpe_users
  set portal_activation_status = 'active', portal_activated_at = coalesce(portal_activated_at, now()), updated_at = now()
  where chapa = new.chapa and portal_activation_status = 'pending'
  returning * into v_user;
  if v_user.id is not null and v_user.email is not null then
    insert into public.app_cpe_activation_email_outbox (user_id, kind, recipient, chapa)
    values (v_user.id, 'user_activated', v_user.email, v_user.chapa)
    on conflict (user_id, kind) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists app_cpe_activate_user_after_first_sync on public.app_cpe_portal_sync_jobs;
create trigger app_cpe_activate_user_after_first_sync
after update of status on public.app_cpe_portal_sync_jobs
for each row execute function private.app_cpe_activate_user_after_first_sync();
