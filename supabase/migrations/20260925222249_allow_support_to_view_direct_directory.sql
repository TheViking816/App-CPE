-- Master-key sessions may see the colleague directory, but cannot open,
-- read or send private chats as the selected worker. Other direct-chat RPCs
-- continue to require private.app_cpe_direct_actor (personal sessions only).
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
      (case when u.chapa = '72683' then false else exists(
        select 1 from public.app_cpe_sessions s where s.user_id = u.id
          and s.expires_at > now() and not coalesce(s.is_support, false)
          and s.last_seen_at >= now() - interval '15 minutes') end) desc,
      coalesce(nullif(btrim(u.display_name), ''), 'Usuario ' || u.chapa), u.chapa), '[]'::jsonb)
    from public.app_cpe_users u where u.id <> v_user.id);
end;
$$;

-- Preserve the existing hidden/deleted-chat filtering while concealing the
-- administrator's presence in both the user list and existing chat cards.
create or replace function public.app_cpe_direct_threads(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
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
        where unread.conversation_id = c.id and unread.sender_id <> v_user_id
          and unread.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
    ) order by m.created_at desc), '[]'::jsonb)
    from public.app_cpe_direct_conversations c
    join public.app_cpe_users other
      on other.id = case when c.user_low_id = v_user_id then c.user_high_id else c.user_low_id end
    left join public.app_cpe_direct_reads r on r.conversation_id = c.id and r.user_id = v_user_id
    left join lateral (select id, body, created_at from public.app_cpe_direct_messages
      where conversation_id = c.id order by created_at desc limit 1) m on true
    where (c.user_low_id = v_user_id or c.user_high_id = v_user_id)
      and m.id is not null
      and (r.hidden_at is null or m.created_at > r.hidden_at));
end;
$$;
