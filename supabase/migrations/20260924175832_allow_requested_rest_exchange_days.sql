-- A requested SL may be the day a worker wants to receive; FH is excluded.
-- The day offered by that worker must still be a confirmed DS or FS.
-- Keep each existing RPC's token checks, limits and grants intact.
do $migration$
declare
  change record;
  definition text;
begin
  for change in
    select * from (values
      ('public.app_cpe_rest_exchange_publish(text,text,date,date)',
       'public.app_cpe_rest_day_code(v_user.chapa, p_wanted_date) is distinct from ''''',
       'coalesce(public.app_cpe_rest_day_code(v_user.chapa, p_wanted_date), ''?'') not in ('''', ''SL'')',
       'El día que buscas debe figurar como laborable en tu portal',
       'El día que buscas debe estar disponible en tu portal'),
      ('public.app_cpe_rest_exchange_update(text,uuid,text,date,date)',
       'public.app_cpe_rest_day_code(v_user.chapa, p_wanted_date) is distinct from ''''',
       'coalesce(public.app_cpe_rest_day_code(v_user.chapa, p_wanted_date), ''?'') not in ('''', ''SL'')',
       'El día que buscas debe figurar como laborable en tu portal',
       'El día que buscas debe estar disponible en tu portal'),
      ('public.app_cpe_rest_exchange_propose(text,uuid,date)',
       'public.app_cpe_rest_day_code(v_user.chapa, v_offer.offered_date) is distinct from ''''',
       'coalesce(public.app_cpe_rest_day_code(v_user.chapa, v_offer.offered_date), ''?'') not in ('''', ''SL'')',
       'El día ofrecido por el compañero debe ser laborable para ti',
       'El día ofrecido por el compañero debe estar disponible para ti'),
      ('public.app_cpe_rest_exchange_decide(text,uuid,boolean)',
       'public.app_cpe_rest_day_code(v_user.chapa, v_offer.wanted_date) is distinct from ''''',
       'coalesce(public.app_cpe_rest_day_code(v_user.chapa, v_offer.wanted_date), ''?'') not in ('''', ''SL'')',
       'El día solicitado ya no figura como laborable para ti',
       'El día solicitado ya no está disponible para ti')
    ) as replacements(signature, old_check, new_check, old_error, new_error)
  loop
    definition := pg_get_functiondef(to_regprocedure(change.signature));
    if definition is null or strpos(definition, change.old_check) = 0
       or strpos(definition, change.old_error) = 0 then
      raise exception 'No se reconoce la definición de %', change.signature;
    end if;
    definition := replace(definition, change.old_check, change.new_check);
    definition := replace(definition, change.old_error, change.new_error);
    if change.signature = 'public.app_cpe_rest_exchange_decide(text,uuid,boolean)' then
      if strpos(definition, 'public.app_cpe_rest_day_code(proposer.chapa, v_offer.offered_date) = ''''') = 0 then
        raise exception 'No se reconoce la comprobación del segundo trabajador';
      end if;
      definition := replace(definition,
        'public.app_cpe_rest_day_code(proposer.chapa, v_offer.offered_date) = ''''',
        'public.app_cpe_rest_day_code(proposer.chapa, v_offer.offered_date) in ('''', ''SL'')');
      definition := replace(definition,
        'El día ofrecido ya no figura como laborable para el compañero',
        'El día ofrecido ya no está disponible para el compañero');
    end if;
    execute definition;
  end loop;
end;
$migration$;
