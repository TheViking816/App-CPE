-- Prevent rapid re-posting after cancellation or proposal withdrawal.
create function public.app_cpe_rest_offer_rate_limit()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.app_cpe_rest_offers o
             where o.owner_id = new.owner_id and o.created_at > now() - interval '10 seconds')
     or (select count(*) from public.app_cpe_rest_offers o
         where o.owner_id = new.owner_id and o.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'Espera antes de publicar otro descanso';
  end if;
  return new;
end;
$$;

create function public.app_cpe_rest_proposal_rate_limit()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.app_cpe_rest_proposals p
             where p.proposer_id = new.proposer_id and p.created_at > now() - interval '10 seconds')
     or (select count(*) from public.app_cpe_rest_proposals p
         where p.proposer_id = new.proposer_id and p.created_at > now() - interval '24 hours') >= 40 then
    raise exception 'Espera antes de enviar otra propuesta';
  end if;
  return new;
end;
$$;

create trigger app_cpe_rest_offer_rate_limit
before insert on public.app_cpe_rest_offers
for each row execute function public.app_cpe_rest_offer_rate_limit();

create trigger app_cpe_rest_proposal_rate_limit
before insert on public.app_cpe_rest_proposals
for each row execute function public.app_cpe_rest_proposal_rate_limit();

revoke all on function public.app_cpe_rest_offer_rate_limit() from public, anon, authenticated;
revoke all on function public.app_cpe_rest_proposal_rate_limit() from public, anon, authenticated;
