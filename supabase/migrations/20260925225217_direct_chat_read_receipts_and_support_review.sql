-- Master-key sessions may review chats for the selected worker, but cannot
-- send, delete, start, or mark messages as read. Keep a minimal audit trail.
create table private.app_cpe_direct_support_audit (
  session_hash text not null,
  conversation_id uuid not null references public.app_cpe_direct_conversations(id) on delete cascade,
  selected_user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  primary key (session_hash, conversation_id)
);
create index app_cpe_direct_support_audit_recent_idx
  on private.app_cpe_direct_support_audit (last_viewed_at desc);
alter table private.app_cpe_direct_support_audit enable row level security;
revoke all on private.app_cpe_direct_support_audit from public, anon, authenticated;

-- Pin the administrator above online users without publishing his presence.
create or replace function public.app_cpe_direct_directory(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'chapa', u.chapa,
      'name', coalesce(nullif(btrim(u.display_name), ''), 'Usuario ' || u.chapa),
      'isAdmin', u.chapa = '72683',
      'online', case when u.chapa = '72683' then false else exists(
        select 1 from public.app_cpe_sessions s
        where s.user_id = u.id and s.expires_at > now()
          and not coalesce(s.is_support, false)
          and s.last_seen_at >= now() - interval '15 minutes') end
    ) order by
      (u.chapa = '72683') desc,
      (case when u.chapa = '72683' then false else exists(
        select 1 from public.app_cpe_sessions s where s.user_id = u.id
          and s.expires_at > now() and not coalesce(s.is_support, false)
          and s.last_seen_at >= now() - interval '15 minutes') end) desc,
      coalesce(nullif(btrim(u.display_name), ''), 'Usuario ' || u.chapa), u.chapa), '[]'::jsonb)
    from public.app_cpe_users u where u.id <> v_user.id);
end;
$$;

-- Thread list remains scoped to the selected worker. Support can see chats
-- they hid so a monitoring session does not miss historical failures.
create or replace function public.app_cpe_direct_threads(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_is_support boolean := false;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(s.is_support, false) into v_is_support
    from public.app_cpe_sessions s
    where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and s.user_id = v_user.id and s.expires_at > now();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'counterpartChapa', other.chapa,
      'counterpartName', coalesce(nullif(btrim(other.display_name), ''), 'Usuario ' || other.chapa),
      'isAdmin', other.chapa = '72683',
      'online', case when other.chapa = '72683' then false else exists(
        select 1 from public.app_cpe_sessions s
        where s.user_id = other.id and s.expires_at > now()
          and not coalesce(s.is_support, false)
          and s.last_seen_at >= now() - interval '15 minutes') end,
      'lastMessage', m.body, 'lastAt', m.created_at,
      'unread', (select count(*) from public.app_cpe_direct_messages unread
        where unread.conversation_id = c.id and unread.sender_id <> v_user.id
          and unread.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
    ) order by m.created_at desc), '[]'::jsonb)
    from public.app_cpe_direct_conversations c
    join public.app_cpe_users other
      on other.id = case when c.user_low_id = v_user.id then c.user_high_id else c.user_low_id end
    left join public.app_cpe_direct_reads r on r.conversation_id = c.id and r.user_id = v_user.id
    left join lateral (select id, body, created_at from public.app_cpe_direct_messages
      where conversation_id = c.id order by created_at desc limit 1) m on true
    where (c.user_low_id = v_user.id or c.user_high_id = v_user.id)
      and m.id is not null
      and (coalesce(v_is_support, false) or r.hidden_at is null or m.created_at > r.hidden_at));
end;
$$;

-- last_read_at belongs to the *recipient*, never to the sender. A support
-- review neither advances that timestamp nor creates a read receipt.
create or replace function public.app_cpe_direct_messages(p_token text, p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_is_support boolean := false;
  v_hidden_at timestamptz;
  v_recipient_read_at timestamptz;
  v_token_hash text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_token_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select coalesce(s.is_support, false) into v_is_support
    from public.app_cpe_sessions s
    where s.token_hash = v_token_hash and s.user_id = v_user.id and s.expires_at > now();
  if not exists(select 1 from public.app_cpe_direct_conversations c where c.id = p_conversation_id
    and (c.user_low_id = v_user.id or c.user_high_id = v_user.id)) then
    raise exception 'Conversacion no disponible';
  end if;
  if coalesce(v_is_support, false) then
    insert into private.app_cpe_direct_support_audit
      (session_hash, conversation_id, selected_user_id)
    values (v_token_hash, p_conversation_id, v_user.id)
    on conflict (session_hash, conversation_id) do update set last_viewed_at = now();
  else
    select hidden_at into v_hidden_at from public.app_cpe_direct_reads
      where conversation_id = p_conversation_id and user_id = v_user.id;
  end if;
  select r.last_read_at into v_recipient_read_at
    from public.app_cpe_direct_conversations c
    left join public.app_cpe_direct_reads r on r.conversation_id = c.id
      and r.user_id = case when c.user_low_id = v_user.id then c.user_high_id else c.user_low_id end
    where c.id = p_conversation_id;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', messages.id, 'body', messages.body,
      'createdAt', messages.created_at, 'isOwn', messages.sender_id = v_user.id,
      'senderChapa', messages.sender_chapa, 'recipientChapa', messages.recipient_chapa,
      'readAt', case when messages.sender_id = v_user.id
        and v_recipient_read_at >= messages.created_at then v_recipient_read_at else null end
    ) order by messages.created_at), '[]'::jsonb)
    from (select id, body, created_at, sender_id, sender_chapa, recipient_chapa
      from public.app_cpe_direct_messages
      where conversation_id = p_conversation_id
        and created_at > coalesce(v_hidden_at, '-infinity'::timestamptz)
      order by created_at desc limit 100) messages);
end;
$$;
