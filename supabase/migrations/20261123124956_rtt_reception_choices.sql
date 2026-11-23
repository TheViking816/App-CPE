-- App CPE uses validated opaque session tokens (not Supabase Auth JWTs).
-- Keep preferences private; each RPC resolves the owner from that token.
create table private.app_cpe_reception_choices (
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  jornal_key text not null check (length(jornal_key) between 12 and 100),
  has_reception boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, jornal_key)
);
alter table private.app_cpe_reception_choices enable row level security;
revoke all on private.app_cpe_reception_choices from public, anon, authenticated;

create function public.app_cpe_get_reception_choices(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.id is null then raise exception 'Sesión no válida'; end if;
  return coalesce((select jsonb_object_agg(jornal_key, has_reception)
    from private.app_cpe_reception_choices where user_id = v_user.id), '{}'::jsonb);
end;
$$;

create function public.app_cpe_set_reception_choice(p_token text, p_jornal_key text, p_has_reception boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.id is null then raise exception 'Sesión no válida'; end if;
  if p_jornal_key is null or length(p_jornal_key) > 100
    or p_jornal_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](02-08|08-14|14-20|20-02)[|](TRASTAINERS_RTT|CONTAINER)$'
    or p_has_reception is null then
    raise exception 'Respuesta de recepción y entrega no válida';
  end if;
  insert into private.app_cpe_reception_choices(user_id, jornal_key, has_reception)
  values (v_user.id, p_jornal_key, p_has_reception)
  on conflict (user_id, jornal_key) do update
    set has_reception = excluded.has_reception, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_cpe_get_reception_choices(text) from public, anon, authenticated;
revoke all on function public.app_cpe_set_reception_choice(text, text, boolean) from public, anon, authenticated;
grant execute on function public.app_cpe_get_reception_choices(text) to anon, authenticated;
grant execute on function public.app_cpe_set_reception_choice(text, text, boolean) to anon, authenticated;
