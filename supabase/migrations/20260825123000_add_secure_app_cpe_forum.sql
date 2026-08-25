alter table public.app_cpe_users
  add column if not exists display_name text;

alter table public.app_cpe_users
  drop constraint if exists app_cpe_users_display_name_length;

alter table public.app_cpe_users
  add constraint app_cpe_users_display_name_length
  check (display_name is null or char_length(btrim(display_name)) between 1 and 120);

with portal_names as (
  select
    u.id as user_id,
    btrim(worker.value ->> 'name') as worker_name,
    row_number() over (
      partition by u.id
      order by s.updated_at desc nulls last, s.id desc
    ) as match_order
  from public.app_cpe_users u
  join public.app_cpe_portal_snapshots s on true
  cross join lateral jsonb_path_query(
    s.payload,
    '$.** ? (@.code != null && @.name != null)'
  ) as worker(value)
  where regexp_replace(coalesce(worker.value ->> 'code', ''), '\D', '', 'g') = u.chapa
    and nullif(btrim(worker.value ->> 'name'), '') is not null
)
update public.app_cpe_users u
set display_name = p.worker_name
from portal_names p
where p.user_id = u.id
  and p.match_order = 1
  and nullif(btrim(u.display_name), '') is null;

update public.app_cpe_users
set display_name = 'Administrador'
where chapa = '72683';

create table if not exists public.app_cpe_forum_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  author_chapa text not null,
  author_name text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint app_cpe_forum_messages_author_chapa_format
    check (author_chapa ~ '^[0-9]{5}$'),
  constraint app_cpe_forum_messages_author_name_length
    check (char_length(btrim(author_name)) between 1 and 120),
  constraint app_cpe_forum_messages_message_length
    check (char_length(btrim(message)) between 1 and 500)
);

create index if not exists app_cpe_forum_messages_created_idx
  on public.app_cpe_forum_messages (created_at desc, id desc);

create index if not exists app_cpe_forum_messages_user_idx
  on public.app_cpe_forum_messages (user_id);

alter table public.app_cpe_forum_messages enable row level security;

create policy app_cpe_forum_no_direct_access
  on public.app_cpe_forum_messages
  as restrictive
  for all
  to public
  using (false)
  with check (false);

revoke all on table public.app_cpe_forum_messages from public, anon, authenticated;
revoke all on sequence public.app_cpe_forum_messages_id_seq from public, anon, authenticated;

create or replace function public.app_cpe_forum_author_name(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_name text;
begin
  select * into v_user
  from public.app_cpe_users
  where id = p_user_id;

  if v_user.id is null then
    raise exception 'Usuario no valido';
  end if;

  if v_user.chapa = '72683' then
    v_name := 'Administrador';
  else
    v_name := nullif(btrim(v_user.display_name), '');
  end if;

  if v_name is null then
    select nullif(btrim(worker.value ->> 'name'), '')
    into v_name
    from public.app_cpe_portal_snapshots s
    cross join lateral jsonb_path_query(
      s.payload,
      '$.** ? (@.code != null && @.name != null)'
    ) as worker(value)
    where regexp_replace(coalesce(worker.value ->> 'code', ''), '\D', '', 'g') = v_user.chapa
      and nullif(btrim(worker.value ->> 'name'), '') is not null
    order by s.updated_at desc nulls last, s.id desc
    limit 1;

    if v_name is not null then
      update public.app_cpe_users
      set display_name = v_name,
          updated_at = now()
      where id = v_user.id;
    end if;
  end if;

  return coalesce(v_name, 'Chapa ' || v_user.chapa);
end;
$$;

create or replace function public.app_cpe_forum_list(
  p_token text,
  p_limit integer default 50,
  p_before_id bigint default null
)
returns table (
  id bigint,
  author_chapa text,
  author_name text,
  message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  select * into v_user
  from public.app_cpe_user_from_token(p_token);

  if v_user.id is null then
    raise exception 'Sesion no valida';
  end if;

  return query
  select
    m.id,
    m.author_chapa,
    case when m.author_chapa = '72683' then 'Administrador' else m.author_name end,
    m.message,
    m.created_at
  from public.app_cpe_forum_messages m
  where p_before_id is null or m.id < p_before_id
  order by m.id desc
  limit v_limit;
end;
$$;

create or replace function public.app_cpe_forum_post(
  p_token text,
  p_message text
)
returns table (
  id bigint,
  author_chapa text,
  author_name text,
  message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_message text := btrim(coalesce(p_message, ''));
  v_author_name text;
begin
  select * into v_user
  from public.app_cpe_user_from_token(p_token);

  if v_user.id is null then
    raise exception 'Sesion no valida';
  end if;

  if char_length(v_message) < 1 then
    raise exception 'Escribe un mensaje';
  end if;

  if char_length(v_message) > 500 then
    raise exception 'El mensaje no puede superar 500 caracteres';
  end if;

  if exists (
    select 1
    from public.app_cpe_forum_messages recent
    where recent.user_id = v_user.id
      and recent.created_at > now() - interval '2 seconds'
  ) then
    raise exception 'Espera un momento antes de enviar otro mensaje';
  end if;

  v_author_name := public.app_cpe_forum_author_name(v_user.id);

  return query
  insert into public.app_cpe_forum_messages (
    user_id,
    author_chapa,
    author_name,
    message
  ) values (
    v_user.id,
    v_user.chapa,
    v_author_name,
    v_message
  )
  returning
    app_cpe_forum_messages.id,
    app_cpe_forum_messages.author_chapa,
    app_cpe_forum_messages.author_name,
    app_cpe_forum_messages.message,
    app_cpe_forum_messages.created_at;
end;
$$;

revoke all on function public.app_cpe_forum_author_name(uuid) from public, anon, authenticated;
revoke all on function public.app_cpe_forum_list(text, integer, bigint) from public, anon, authenticated;
revoke all on function public.app_cpe_forum_post(text, text) from public, anon, authenticated;

grant execute on function public.app_cpe_forum_list(text, integer, bigint) to anon, authenticated;
grant execute on function public.app_cpe_forum_post(text, text) to anon, authenticated;

insert into public.app_cpe_forum_messages (
  user_id,
  author_chapa,
  author_name,
  message
)
select
  u.id,
  u.chapa,
  'Administrador',
  'Bienvenidos al foro de App CPE. La aplicación todavía está en fase beta. Podéis comentar aquí cualquier error o fallo para que podamos revisarlo y hacer la mejor app posible. Este espacio también es vuestro para hablar y compartir lo que queráis entre compañeros.'
from public.app_cpe_users u
where u.chapa = '72683'
  and not exists (
    select 1
    from public.app_cpe_forum_messages m
    where m.author_chapa = '72683'
      and m.message like 'Bienvenidos al foro de App CPE.%'
  );
