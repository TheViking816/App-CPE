-- El directorio compartido contiene nombres oficiales observados en partes.
-- Los alias elegidos por usuarios de PortalEstibaVLC viven en su tabla de
-- perfiles y no deben utilizarse para componer los equipos de los partes.
delete from public.app_cpe_bolsa_worker_directory
where source = 'portalestibavlc';

-- Un jornal se identifica por usuario, periodo, dia y jornada. El numero de
-- parte, el tipo y la grafia de la especialidad pueden completarse o cambiar
-- durante lecturas posteriores sin convertirlo en otro jornal.
with ranked as (
  select
    id,
    concat_ws('|',
      regexp_replace(lower(btrim(coalesce(metadata ->> 'period', ''))), '\s+', ' ', 'g'),
      lpad(regexp_replace(coalesce(metadata ->> 'day', ''), '[^0-9]', '', 'g'), 2, '0'),
      regexp_replace(coalesce(metadata ->> 'shift', ''), '[^0-9]', '', 'g')
    ) as canonical_key,
    row_number() over (
      partition by
        chapa,
        regexp_replace(lower(btrim(coalesce(metadata ->> 'period', ''))), '\s+', ' ', 'g'),
        lpad(regexp_replace(coalesce(metadata ->> 'day', ''), '[^0-9]', '', 'g'), 2, '0'),
        regexp_replace(coalesce(metadata ->> 'shift', ''), '[^0-9]', '', 'g')
      order by created_at desc, id desc
    ) as duplicate_order
  from public.app_cpe_user_notifications
  where event_type = 'new_journal'
), removed as (
  delete from public.app_cpe_user_notifications n
  using ranked r
  where n.id = r.id and r.duplicate_order > 1
)
update public.app_cpe_user_notifications n
set entity_key = r.canonical_key
from ranked r
where n.id = r.id and r.duplicate_order = 1;

create unique index if not exists app_cpe_user_notifications_one_new_journal_idx
  on public.app_cpe_user_notifications (chapa, event_type, entity_key)
  where event_type = 'new_journal';

create or replace function public.app_cpe_record_portal_notifications(
  p_chapa text,
  p_notifications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_item jsonb;
  v_inserted integer := 0;
begin
  select id into v_user_id
  from public.app_cpe_users
  where chapa = regexp_replace(coalesce(p_chapa, ''), '\D', '', 'g');

  if v_user_id is null then
    raise exception 'Usuario no encontrado';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_notifications, '[]'::jsonb)) > 50 then
    raise exception 'Lote de novedades no valido';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb)) loop
    if coalesce(v_item->>'eventType', '') not in (
      'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
      'rests_changed', 'vacations_changed', 'exceptions_changed'
    ) then
      continue;
    end if;
    if coalesce(v_item->>'targetTab', '') not in (
      'contratacion', 'sueldometro', 'nominas', 'descansos', 'vacaciones', 'excepciones'
    ) then
      continue;
    end if;
    if length(coalesce(v_item->>'entityKey', '')) < 1
       or length(coalesce(v_item->>'changeHash', '')) < 8 then
      continue;
    end if;

    insert into public.app_cpe_user_notifications (
      user_id, chapa, event_type, title, body, entity_key,
      change_hash, target_tab, metadata
    ) values (
      v_user_id,
      regexp_replace(coalesce(p_chapa, ''), '\D', '', 'g'),
      v_item->>'eventType',
      left(coalesce(v_item->>'title', 'Novedad del portal'), 140),
      left(coalesce(v_item->>'body', ''), 500),
      left(v_item->>'entityKey', 300),
      left(v_item->>'changeHash', 128),
      v_item->>'targetTab',
      coalesce(v_item->'metadata', '{}'::jsonb)
    )
    on conflict do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  delete from public.app_cpe_user_notifications
  where created_at < now() - interval '90 days';

  return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.app_cpe_record_portal_notifications(text, jsonb) from public, anon, authenticated;
grant execute on function public.app_cpe_record_portal_notifications(text, jsonb) to service_role;
