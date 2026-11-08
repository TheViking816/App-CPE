-- Only the recovery Edge Function may issue or consume tokens.
create table if not exists private.app_cpe_password_resets (
  token_hash text primary key,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists app_cpe_password_resets_user_idx on private.app_cpe_password_resets(user_id);
alter table private.app_cpe_password_resets enable row level security;
revoke all on private.app_cpe_password_resets from public, anon, authenticated;

create table if not exists private.app_cpe_recovery_limits (
  bucket text primary key,
  started_at timestamptz not null,
  attempts integer not null
);
alter table private.app_cpe_recovery_limits enable row level security;
revoke all on private.app_cpe_recovery_limits from public, anon, authenticated;

create or replace function public.app_cpe_issue_password_reset(p_chapa text, p_ip_hash text)
returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_token text; v_bucket text; v_attempts integer;
begin
  -- Locks and counters also cover unknown chapas to limit enumeration and spam.
  foreach v_bucket in array array['ip:' || p_ip_hash, 'chapa:' || p_chapa] loop
    insert into private.app_cpe_recovery_limits(bucket,started_at,attempts)
    values(v_bucket,now(),1)
    on conflict(bucket) do update set
      attempts = case when app_cpe_recovery_limits.started_at < now()-interval '1 hour' then 1 else app_cpe_recovery_limits.attempts+1 end,
      started_at = case when app_cpe_recovery_limits.started_at < now()-interval '1 hour' then now() else app_cpe_recovery_limits.started_at end
    returning attempts into v_attempts;
    if v_attempts > (case when v_bucket like 'ip:%' then 10 else 3 end) then return null; end if;
  end loop;
  select * into v_user from public.app_cpe_users where chapa = public.app_cpe_normalize_chapa(p_chapa) for update;
  if v_user.id is null or coalesce(trim(v_user.email),'') = '' then return null; end if;
  delete from private.app_cpe_password_resets where user_id=v_user.id or expires_at < now();
  delete from private.app_cpe_recovery_limits where started_at < now()-interval '2 days';
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into private.app_cpe_password_resets(token_hash,user_id,email,expires_at)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),v_user.id,trim(v_user.email),now()+interval '1 hour');
  return jsonb_build_object('token',v_token,'email',trim(v_user.email));
end $$;

create or replace function public.app_cpe_reset_password(p_token text, p_password text)
returns boolean language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare v_reset private.app_cpe_password_resets; v_user public.app_cpe_users;
begin
  if p_token !~ '^[a-f0-9]{64}$' or length(coalesce(p_password,'')) < 8 or octet_length(p_password) > 72 then return false; end if;
  select * into v_reset from private.app_cpe_password_resets
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  if v_reset.user_id is null then return false; end if;
  -- Same lock order as issuance: user first, then token. Recheck after locking.
  select * into v_user from public.app_cpe_users where id=v_reset.user_id for update;
  select * into v_reset from private.app_cpe_password_resets
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at > now() for update;
  if v_reset.user_id is null or v_reset.email is distinct from trim(v_user.email) then return false; end if;
  update public.app_cpe_users set password_hash=extensions.crypt(p_password,extensions.gen_salt('bf')),updated_at=now() where id=v_reset.user_id;
  delete from public.app_cpe_sessions where user_id=v_reset.user_id;
  delete from private.app_cpe_password_resets where user_id=v_reset.user_id;
  return true;
end $$;

create or replace function public.app_cpe_cancel_password_reset(p_token text)
returns void language sql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
  delete from private.app_cpe_password_resets where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
$$;
revoke all on function public.app_cpe_issue_password_reset(text,text) from public, anon, authenticated;
revoke all on function public.app_cpe_reset_password(text,text) from public, anon, authenticated;
revoke all on function public.app_cpe_cancel_password_reset(text) from public, anon, authenticated;
grant execute on function public.app_cpe_issue_password_reset(text,text) to service_role;
grant execute on function public.app_cpe_reset_password(text,text) to service_role;
grant execute on function public.app_cpe_cancel_password_reset(text) to service_role;

-- A logged-in user must confirm their real password to change recovery email.
create or replace function public.app_cpe_set_recovery_email(p_token text, p_password text, p_email text)
returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_email text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  perform 1 from public.app_cpe_users where id=v_user.id for update;
  select * into v_user from public.app_cpe_users where id=v_user.id;
  if v_user.password_hash <> extensions.crypt(coalesce(p_password,''),v_user.password_hash) then raise exception 'La contraseña actual no es correcta'; end if;
  v_email := lower(trim(coalesce(p_email,'')));
  if length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Introduce un correo válido'; end if;
  update public.app_cpe_users set email=v_email,updated_at=now() where id=v_user.id returning * into v_user;
  delete from private.app_cpe_password_resets where user_id=v_user.id;
  return public.app_cpe_public_user(v_user,p_token);
end $$;
revoke all on function public.app_cpe_set_recovery_email(text,text,text) from public, anon, authenticated;
grant execute on function public.app_cpe_set_recovery_email(text,text,text) to anon, authenticated;
