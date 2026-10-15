-- Opening a proposal from its offer or a notification must make an
-- individually hidden conversation visible again for that participant.
create or replace function public.app_cpe_exchange_restore(
  p_token text, p_type text, p_proposal_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_type = 'rest' then
    if not exists (
      select 1 from public.app_cpe_rest_proposals p
      join public.app_cpe_rest_offers o on o.id = p.offer_id
      where p.id = p_proposal_id
        and (p.proposer_id = v_user.id or o.owner_id = v_user.id)
    ) then raise exception 'Conversación no disponible'; end if;
  elsif p_type = 'vacation' then
    if not exists (
      select 1 from public.app_cpe_vacation_proposals p
      join public.app_cpe_vacation_offers o on o.id = p.offer_id
      where p.id = p_proposal_id
        and (p.proposer_id = v_user.id or o.owner_id = v_user.id)
    ) then raise exception 'Conversación no disponible'; end if;
  else
    raise exception 'Tipo de conversación incorrecto';
  end if;

  update public.app_cpe_exchange_thread_reads
  set hidden_at = null
  where user_id = v_user.id and exchange_type = p_type
    and proposal_id = p_proposal_id and hidden_at is not null;
  return true;
end;
$$;

revoke all on function public.app_cpe_exchange_restore(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.app_cpe_exchange_restore(text, text, uuid)
  to anon, authenticated;
