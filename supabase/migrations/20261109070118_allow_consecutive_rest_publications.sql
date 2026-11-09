-- Allow separate rest offers to be published consecutively.
-- Keep the existing rolling daily limit, with an actionable error message.
create or replace function public.app_cpe_rest_offer_rate_limit()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (select count(*) from public.app_cpe_rest_offers o
      where o.owner_id = new.owner_id
        and o.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'Has alcanzado el límite de 30 publicaciones de descansos en 24 horas. Podrás publicar otra cuando la más antigua de esas publicaciones cumpla 24 horas.';
  end if;
  return new;
end;
$function$;
