-- Hide an exchange conversation for one participant without deleting the
-- proposal or the other participant's messages. A later message reopens it.
alter table public.app_cpe_exchange_thread_reads
  add column if not exists hidden_at timestamptz;

create or replace function public.app_cpe_exchange_visible_threads(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_threads jsonb;
  v_is_support boolean := false;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(s.is_support, false) into v_is_support
  from public.app_cpe_sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.user_id = v_user.id and s.expires_at > now();
  v_threads := public.app_cpe_exchange_threads(p_token);
  return (select coalesce(jsonb_agg(t.thread order by t.position), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_threads, '[]'::jsonb)) with ordinality as t(thread, position)
    left join public.app_cpe_exchange_thread_reads r
      on r.user_id = v_user.id and r.exchange_type = t.thread->>'type'
        and r.proposal_id = (t.thread->>'proposalId')::uuid
    where coalesce(v_is_support, false) or r.hidden_at is null
      or (t.thread->>'lastAt')::timestamptz > r.hidden_at);
end;
$$;

create or replace function public.app_cpe_exchange_delete(p_token text, p_type text, p_proposal_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_is_support boolean := false;
  v_now timestamptz := now();
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select coalesce(s.is_support, false) into v_is_support
  from public.app_cpe_sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.user_id = v_user.id and s.expires_at > now();
  if coalesce(v_is_support, false) then raise exception 'No se puede eliminar en modo soporte'; end if;
  if p_type = 'rest' then
    if not exists (select 1 from public.app_cpe_rest_proposals p
      join public.app_cpe_rest_offers o on o.id = p.offer_id
      where p.id = p_proposal_id and (p.proposer_id = v_user.id or o.owner_id = v_user.id)) then
      raise exception 'Conversación no disponible';
    end if;
  elsif p_type = 'vacation' then
    if not exists (select 1 from public.app_cpe_vacation_proposals p
      join public.app_cpe_vacation_offers o on o.id = p.offer_id
      where p.id = p_proposal_id and (p.proposer_id = v_user.id or o.owner_id = v_user.id)) then
      raise exception 'Conversación no disponible';
    end if;
  else
    raise exception 'Tipo de conversación incorrecto';
  end if;
  insert into public.app_cpe_exchange_thread_reads
    (user_id, exchange_type, proposal_id, last_read_at, hidden_at)
  values (v_user.id, p_type, p_proposal_id, v_now, v_now)
  on conflict (user_id, exchange_type, proposal_id) do update
    set last_read_at = greatest(public.app_cpe_exchange_thread_reads.last_read_at, excluded.last_read_at),
        hidden_at = excluded.hidden_at;
  return true;
end;
$$;

-- Preserve read receipts while restricting the current user's view to
-- messages received after they removed the conversation.
create or replace function public.app_cpe_rest_exchange_messages(p_token text, p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_proposer_id uuid;
  v_owner_id uuid;
  v_recipient_read_at timestamptz;
  v_hidden_at timestamptz;
  v_is_support boolean := false;
  v_messages jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select p.proposer_id, o.owner_id into v_proposer_id, v_owner_id
  from public.app_cpe_rest_proposals p
  join public.app_cpe_rest_offers o on o.id = p.offer_id
  where p.id = p_proposal_id;
  if v_user.id is distinct from v_proposer_id and v_user.id is distinct from v_owner_id then
    raise exception 'Conversación no disponible';
  end if;
  select coalesce(s.is_support, false) into v_is_support
  from public.app_cpe_sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.user_id = v_user.id and s.expires_at > now();
  select last_read_at into v_recipient_read_at
  from public.app_cpe_exchange_thread_reads
  where user_id = case when v_user.id = v_owner_id then v_proposer_id else v_owner_id end
    and exchange_type = 'rest' and proposal_id = p_proposal_id;
  if not coalesce(v_is_support, false) then
    select hidden_at into v_hidden_at from public.app_cpe_exchange_thread_reads
    where user_id = v_user.id and exchange_type = 'rest' and proposal_id = p_proposal_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'body', m.body, 'createdAt', m.created_at,
    'isOwn', m.sender_id = v_user.id,
    'senderName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero'),
    'readAt', case when m.sender_id = v_user.id and v_recipient_read_at >= m.created_at
      then v_recipient_read_at else null end
  ) order by m.created_at, m.id), '[]'::jsonb) into v_messages
  from (select * from public.app_cpe_rest_messages
        where proposal_id = p_proposal_id and created_at > coalesce(v_hidden_at, '-infinity'::timestamptz)
        order by created_at desc, id desc limit 200) m
  join public.app_cpe_users u on u.id = m.sender_id;
  return v_messages;
end;
$$;

create or replace function public.app_cpe_vacation_exchange_messages(p_token text, p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_proposer_id uuid;
  v_owner_id uuid;
  v_recipient_read_at timestamptz;
  v_hidden_at timestamptz;
  v_is_support boolean := false;
  v_messages jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select p.proposer_id, o.owner_id into v_proposer_id, v_owner_id
  from public.app_cpe_vacation_proposals p
  join public.app_cpe_vacation_offers o on o.id = p.offer_id
  where p.id = p_proposal_id;
  if v_user.id is distinct from v_proposer_id and v_user.id is distinct from v_owner_id then
    raise exception 'Conversación no disponible';
  end if;
  select coalesce(s.is_support, false) into v_is_support
  from public.app_cpe_sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.user_id = v_user.id and s.expires_at > now();
  select last_read_at into v_recipient_read_at
  from public.app_cpe_exchange_thread_reads
  where user_id = case when v_user.id = v_owner_id then v_proposer_id else v_owner_id end
    and exchange_type = 'vacation' and proposal_id = p_proposal_id;
  if not coalesce(v_is_support, false) then
    select hidden_at into v_hidden_at from public.app_cpe_exchange_thread_reads
    where user_id = v_user.id and exchange_type = 'vacation' and proposal_id = p_proposal_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'body', m.body, 'createdAt', m.created_at,
    'isOwn', m.sender_id = v_user.id,
    'senderName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero'),
    'readAt', case when m.sender_id = v_user.id and v_recipient_read_at >= m.created_at
      then v_recipient_read_at else null end
  ) order by m.created_at, m.id), '[]'::jsonb) into v_messages
  from (select * from public.app_cpe_vacation_messages
        where proposal_id = p_proposal_id and created_at > coalesce(v_hidden_at, '-infinity'::timestamptz)
        order by created_at desc, id desc limit 200) m
  join public.app_cpe_users u on u.id = m.sender_id;
  return v_messages;
end;
$$;

revoke all on function public.app_cpe_exchange_visible_threads(text) from public, anon, authenticated;
revoke all on function public.app_cpe_exchange_delete(text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_exchange_visible_threads(text) to anon, authenticated;
grant execute on function public.app_cpe_exchange_delete(text, text, uuid) to anon, authenticated;
