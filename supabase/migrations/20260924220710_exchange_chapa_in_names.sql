-- The badge number is visible in a published offer. Return it to both participants
-- of a proposal from the outset, so the inbox and proposal cards identify the
-- same colleague even when several people share a first name.
do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_old := $fragment$case when p.status = 'accepted'
        then case when o.owner_id = v_user.id then proposer.chapa else owner.chapa end
        else null end counterpart_chapa$fragment$;
  v_new := $fragment$case when o.owner_id = v_user.id then proposer.chapa else owner.chapa end counterpart_chapa$fragment$;
  v_definition := pg_get_functiondef('public.app_cpe_exchange_threads(text)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'Unexpected exchange inbox function; migration stopped';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := $fragment$case when p.status = 'accepted'
        then case when o.owner_id = v_user.id then proposer.chapa else owner.chapa end
        else null end,$fragment$;
  v_new := $fragment$case when o.owner_id = v_user.id then proposer.chapa else owner.chapa end,$fragment$;
  if position(v_old in v_definition) = 0 then
    raise exception 'Unexpected vacation inbox branch; migration stopped';
  end if;
  execute replace(v_definition, v_old, v_new);

  v_old := $fragment$'counterpartChapa', case when p.status = 'accepted'
      then case when p.proposer_id = v_user.id then owner.chapa else proposer.chapa end
      else null end$fragment$;
  v_new := $fragment$'counterpartChapa', case when p.proposer_id = v_user.id then owner.chapa else proposer.chapa end$fragment$;
  v_definition := pg_get_functiondef('public.app_cpe_rest_exchange_list(text)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'Unexpected rest exchange list function; migration stopped';
  end if;
  execute replace(v_definition, v_old, v_new);

  v_old := $fragment$'counterpartChapa',case when p.status='accepted'
      then case when p.proposer_id=v_user.id then owner.chapa else proposer.chapa end
      else null end$fragment$;
  v_new := $fragment$'counterpartChapa',case when p.proposer_id=v_user.id then owner.chapa else proposer.chapa end$fragment$;
  v_definition := pg_get_functiondef('public.app_cpe_vacation_exchange_list(text)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'Unexpected vacation exchange list function; migration stopped';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;
