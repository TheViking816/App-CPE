-- Direct conversations are separate from exchange proposals. App CPE uses
-- opaque sessions, so every exposed RPC validates that session explicitly.
alter table public.app_cpe_sessions add column if not exists last_seen_at timestamptz;
create index if not exists app_cpe_sessions_presence_idx
  on public.app_cpe_sessions (user_id, last_seen_at desc)
  where is_support = false;

create table public.app_cpe_direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.app_cpe_users(id) on delete cascade,
  user_high_id uuid not null references public.app_cpe_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint app_cpe_direct_conversations_order check (user_low_id < user_high_id),
  constraint app_cpe_direct_conversations_pair unique (user_low_id, user_high_id)
);
create index app_cpe_direct_conversations_high_idx
  on public.app_cpe_direct_conversations (user_high_id, created_at desc);

create table public.app_cpe_direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.app_cpe_direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.app_cpe_users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index app_cpe_direct_messages_recent_idx
  on public.app_cpe_direct_messages (conversation_id, created_at desc);

create table public.app_cpe_direct_reads (
  conversation_id uuid not null references public.app_cpe_direct_conversations(id) on delete cascade,
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.app_cpe_direct_conversations enable row level security;
alter table public.app_cpe_direct_messages enable row level security;
alter table public.app_cpe_direct_reads enable row level security;
revoke all on public.app_cpe_direct_conversations, public.app_cpe_direct_messages,
  public.app_cpe_direct_reads from public, anon, authenticated;

create function private.app_cpe_direct_actor(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.app_cpe_sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now() and not coalesce(s.is_support, false);
  if v_user_id is null then raise exception 'Sesion no valida'; end if;
  return v_user_id;
end;
$$;
revoke all on function private.app_cpe_direct_actor(text) from public, anon, authenticated;

create function public.app_cpe_direct_touch(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  update public.app_cpe_sessions set last_seen_at = now()
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and user_id = v_user_id and expires_at > now();
  return found;
end;
$$;

create function public.app_cpe_direct_directory(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'chapa', u.chapa,
      'name', coalesce(nullif(btrim(u.display_name), ''), 'Usuario ' || u.chapa),
      'online', exists(select 1 from public.app_cpe_sessions s
        where s.user_id = u.id and s.expires_at > now()
          and not coalesce(s.is_support, false)
          and s.last_seen_at >= now() - interval '15 minutes')
    ) order by
      (exists(select 1 from public.app_cpe_sessions s where s.user_id = u.id
        and s.expires_at > now() and not coalesce(s.is_support, false)
        and s.last_seen_at >= now() - interval '15 minutes')) desc,
      coalesce(nullif(btrim(u.display_name), ''), 'Usuario ' || u.chapa), u.chapa), '[]'::jsonb)
    from public.app_cpe_users u where u.id <> v_user_id);
end;
$$;

create function public.app_cpe_direct_start(p_token text, p_chapa text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_other_id uuid; v_conversation_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  select id into v_other_id from public.app_cpe_users where chapa = btrim(p_chapa);
  if v_other_id is null or v_other_id = v_user_id then
    raise exception 'Usuario no disponible';
  end if;
  insert into public.app_cpe_direct_conversations (user_low_id, user_high_id)
  values (least(v_user_id, v_other_id), greatest(v_user_id, v_other_id))
  on conflict (user_low_id, user_high_id) do update
    set user_low_id = excluded.user_low_id
  returning id into v_conversation_id;
  return v_conversation_id;
end;
$$;

create function public.app_cpe_direct_threads(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'counterpartChapa', other.chapa,
      'counterpartName', coalesce(nullif(btrim(other.display_name), ''), 'Usuario ' || other.chapa),
      'online', exists(select 1 from public.app_cpe_sessions s
        where s.user_id = other.id and s.expires_at > now()
          and not coalesce(s.is_support, false)
          and s.last_seen_at >= now() - interval '15 minutes'),
      'lastMessage', m.body, 'lastAt', coalesce(m.created_at, c.created_at),
      'unread', (select count(*) from public.app_cpe_direct_messages unread
        where unread.conversation_id = c.id and unread.sender_id <> v_user_id
          and unread.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
    ) order by coalesce(m.created_at, c.created_at) desc), '[]'::jsonb)
    from public.app_cpe_direct_conversations c
    join public.app_cpe_users other
      on other.id = case when c.user_low_id = v_user_id then c.user_high_id else c.user_low_id end
    left join public.app_cpe_direct_reads r on r.conversation_id = c.id and r.user_id = v_user_id
    left join lateral (select body, created_at from public.app_cpe_direct_messages
      where conversation_id = c.id order by created_at desc limit 1) m on true
    where c.user_low_id = v_user_id or c.user_high_id = v_user_id);
end;
$$;

create function public.app_cpe_direct_messages(p_token text, p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  if not exists(select 1 from public.app_cpe_direct_conversations c where c.id = p_conversation_id
    and (c.user_low_id = v_user_id or c.user_high_id = v_user_id)) then
    raise exception 'Conversacion no disponible';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', messages.id, 'body', messages.body,
      'createdAt', messages.created_at, 'isOwn', messages.sender_id = v_user_id
    ) order by messages.created_at), '[]'::jsonb)
    from (select id, body, created_at, sender_id from public.app_cpe_direct_messages
      where conversation_id = p_conversation_id order by created_at desc limit 100) messages);
end;
$$;

create function public.app_cpe_direct_send(p_token text, p_conversation_id uuid, p_body text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  if not exists(select 1 from public.app_cpe_direct_conversations c where c.id = p_conversation_id
    and (c.user_low_id = v_user_id or c.user_high_id = v_user_id)) then
    raise exception 'Conversacion no disponible';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 500 then
    raise exception 'El mensaje debe tener entre 1 y 500 caracteres';
  end if;
  insert into public.app_cpe_direct_messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_user_id, btrim(p_body));
  return true;
end;
$$;

create function public.app_cpe_direct_mark_read(p_token text, p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  if not exists(select 1 from public.app_cpe_direct_conversations c where c.id = p_conversation_id
    and (c.user_low_id = v_user_id or c.user_high_id = v_user_id)) then
    raise exception 'Conversacion no disponible';
  end if;
  insert into public.app_cpe_direct_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_user_id, now())
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(public.app_cpe_direct_reads.last_read_at, excluded.last_read_at);
  return true;
end;
$$;

revoke all on function public.app_cpe_direct_touch(text), public.app_cpe_direct_directory(text),
  public.app_cpe_direct_start(text,text), public.app_cpe_direct_threads(text),
  public.app_cpe_direct_messages(text,uuid), public.app_cpe_direct_send(text,uuid,text),
  public.app_cpe_direct_mark_read(text,uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_direct_touch(text), public.app_cpe_direct_directory(text),
  public.app_cpe_direct_start(text,text), public.app_cpe_direct_threads(text),
  public.app_cpe_direct_messages(text,uuid), public.app_cpe_direct_send(text,uuid,text),
  public.app_cpe_direct_mark_read(text,uuid) to anon, authenticated;
