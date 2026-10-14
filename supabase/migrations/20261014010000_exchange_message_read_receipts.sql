-- Exchange threads already record each participant's last read time. Expose
-- that time only on the sender's own messages, as direct chats do.
create or replace function public.app_cpe_rest_exchange_messages(p_token text, p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_proposer_id uuid;
  v_owner_id uuid;
  v_recipient_read_at timestamptz;
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
  select last_read_at into v_recipient_read_at
  from public.app_cpe_exchange_thread_reads
  where user_id = case when v_user.id = v_owner_id then v_proposer_id else v_owner_id end
    and exchange_type = 'rest' and proposal_id = p_proposal_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'body', m.body, 'createdAt', m.created_at,
    'isOwn', m.sender_id = v_user.id,
    'senderName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero'),
    'readAt', case when m.sender_id = v_user.id and v_recipient_read_at >= m.created_at
      then v_recipient_read_at else null end
  ) order by m.created_at, m.id), '[]'::jsonb) into v_messages
  from (select * from public.app_cpe_rest_messages
        where proposal_id = p_proposal_id order by created_at desc, id desc limit 200) m
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
  select last_read_at into v_recipient_read_at
  from public.app_cpe_exchange_thread_reads
  where user_id = case when v_user.id = v_owner_id then v_proposer_id else v_owner_id end
    and exchange_type = 'vacation' and proposal_id = p_proposal_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'body', m.body, 'createdAt', m.created_at,
    'isOwn', m.sender_id = v_user.id,
    'senderName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero'),
    'readAt', case when m.sender_id = v_user.id and v_recipient_read_at >= m.created_at
      then v_recipient_read_at else null end
  ) order by m.created_at, m.id), '[]'::jsonb) into v_messages
  from (select * from public.app_cpe_vacation_messages
        where proposal_id = p_proposal_id order by created_at desc, id desc limit 200) m
  join public.app_cpe_users u on u.id = m.sender_id;
  return v_messages;
end;
$$;
