create table public.app_cpe_rest_messages (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.app_cpe_rest_proposals(id) on delete cascade,
  sender_id uuid not null references public.app_cpe_users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index app_cpe_rest_messages_thread_idx
  on public.app_cpe_rest_messages (proposal_id, created_at);
create index app_cpe_rest_messages_sender_idx
  on public.app_cpe_rest_messages (sender_id, created_at desc);

alter table public.app_cpe_rest_messages enable row level security;
revoke all on public.app_cpe_rest_messages from public, anon, authenticated;

alter table public.app_cpe_user_notifications
  drop constraint if exists app_cpe_user_notifications_event_type_check;
alter table public.app_cpe_user_notifications
  add constraint app_cpe_user_notifications_event_type_check check (event_type in (
    'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
    'rests_changed', 'vacations_changed', 'exceptions_changed',
    'rest_proposal', 'rest_response', 'rest_message'
  ));

create function public.app_cpe_rest_exchange_messages(p_token text, p_proposal_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_proposer_id uuid;
  v_owner_id uuid;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'body', m.body, 'createdAt', m.created_at,
    'isOwn', m.sender_id = v_user.id,
    'senderName', coalesce(nullif(split_part(btrim(u.display_name), ' ', 1), ''), 'Compañero')
  ) order by m.created_at, m.id), '[]'::jsonb) into v_messages
  from (select * from public.app_cpe_rest_messages
        where proposal_id = p_proposal_id order by created_at desc, id desc limit 200) m
  join public.app_cpe_users u on u.id = m.sender_id;
  return v_messages;
end;
$$;

create function public.app_cpe_rest_exchange_send_message(
  p_token text, p_proposal_id uuid, p_body text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_proposal public.app_cpe_rest_proposals;
  v_owner_id uuid;
  v_offer_status text;
  v_recipient_id uuid;
  v_message_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select * into v_proposal from public.app_cpe_rest_proposals
  where id = p_proposal_id for update;
  select owner_id, status into v_owner_id, v_offer_status
  from public.app_cpe_rest_offers where id = v_proposal.offer_id;
  if v_proposal.id is null or
     (v_user.id <> v_proposal.proposer_id and v_user.id <> v_owner_id) or
     v_proposal.status not in ('pending', 'accepted') or v_offer_status not in ('open', 'agreed') then
    raise exception 'Conversación no disponible';
  end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'El mensaje debe tener entre 1 y 500 caracteres';
  end if;
  if exists (select 1 from public.app_cpe_rest_messages
    where sender_id = v_user.id and created_at > now() - interval '3 seconds')
    or (select count(*) from public.app_cpe_rest_messages
        where sender_id = v_user.id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Espera antes de enviar otro mensaje';
  end if;
  v_recipient_id := case when v_user.id = v_owner_id then v_proposal.proposer_id else v_owner_id end;
  insert into public.app_cpe_rest_messages (proposal_id, sender_id, body)
  values (p_proposal_id, v_user.id, v_body) returning id into v_message_id;
  insert into public.app_cpe_user_notifications (
    user_id, chapa, event_type, title, body, entity_key, change_hash, target_tab, metadata
  )
  select recipient.id, recipient.chapa, 'rest_message', 'Nuevo mensaje privado',
    'Un compañero te ha escrito sobre una propuesta de descanso.',
    v_proposal.offer_id::text, v_message_id::text, 'descansos',
    jsonb_build_object('offerId', v_proposal.offer_id, 'proposalId', p_proposal_id)
  from public.app_cpe_users recipient where recipient.id = v_recipient_id;
  return v_message_id;
end;
$$;

revoke all on function public.app_cpe_rest_exchange_messages(text, uuid) from public, anon, authenticated;
revoke all on function public.app_cpe_rest_exchange_send_message(text, uuid, text) from public, anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_messages(text, uuid) to anon, authenticated;
grant execute on function public.app_cpe_rest_exchange_send_message(text, uuid, text) to anon, authenticated;
