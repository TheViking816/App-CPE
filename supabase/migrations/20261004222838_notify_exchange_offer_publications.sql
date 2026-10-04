-- One feed item per recipient and newly published offer. The private triggers run
-- only after a successful insert, so failed publications never notify anyone.
alter table public.app_cpe_user_notifications
  drop constraint app_cpe_user_notifications_event_type_check;
alter table public.app_cpe_user_notifications
  add constraint app_cpe_user_notifications_event_type_check check (event_type in (
    'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
    'rests_changed', 'vacations_changed', 'exceptions_changed',
    'rest_proposal', 'rest_response', 'rest_message',
    'vacation_proposal', 'vacation_response', 'vacation_message',
    'direct_message', 'rest_offer_published', 'vacation_offer_published'
  ));

create function private.app_cpe_notify_rest_offer_published()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_author public.app_cpe_users;
  v_name text;
  v_title text;
  v_body text;
begin
  select * into v_author from public.app_cpe_users where id = new.owner_id;
  v_name := coalesce(nullif(pg_catalog.btrim(v_author.display_name), ''), 'Usuario');
  v_title := case new.kind
    when 'swap' then 'Nuevo intercambio de descansos'
    when 'give' then 'Nueva cesión de descanso'
    else 'Nueva solicitud de cesión'
  end;
  v_body := v_name || ' · ' || v_author.chapa || ' ' || case new.kind
    when 'swap' then 'ofrece el ' || pg_catalog.to_char(new.offered_date, 'DD/MM/YYYY')
      || ' y busca el ' || pg_catalog.to_char(new.wanted_date, 'DD/MM/YYYY') || '.'
    when 'give' then 'cede el ' || pg_catalog.to_char(new.offered_date, 'DD/MM/YYYY') || '.'
    else 'busca un descanso para el ' || pg_catalog.to_char(new.wanted_date, 'DD/MM/YYYY') || '.'
  end;

  insert into public.app_cpe_user_notifications
    (user_id, chapa, event_type, title, body, entity_key, change_hash,
     target_tab, metadata, created_at)
  select recipient.id, recipient.chapa, 'rest_offer_published', v_title, v_body,
    new.id::text, new.id::text, 'descansos',
    pg_catalog.jsonb_build_object('offerId', new.id, 'kind', new.kind), new.created_at
  from public.app_cpe_users recipient
  on conflict (chapa, event_type, entity_key, change_hash) do nothing;
  return new;
end;
$$;
revoke all on function private.app_cpe_notify_rest_offer_published() from public, anon, authenticated;
create trigger app_cpe_rest_offer_published_notification
  after insert on public.app_cpe_rest_offers
  for each row when (new.status = 'open')
  execute function private.app_cpe_notify_rest_offer_published();

create function private.app_cpe_notify_vacation_offer_published()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_author public.app_cpe_users;
  v_name text;
  v_offered text;
  v_wanted text;
begin
  select * into v_author from public.app_cpe_users where id = new.owner_id;
  v_name := coalesce(nullif(pg_catalog.btrim(v_author.display_name), ''), 'Usuario');
  v_offered := pg_catalog.to_char(new.offered_start, 'DD/MM/YYYY');
  v_wanted := pg_catalog.to_char(new.wanted_start, 'DD/MM/YYYY');
  if new.offered_end <> new.offered_start then
    v_offered := v_offered || '–' || pg_catalog.to_char(new.offered_end, 'DD/MM/YYYY');
  end if;
  if new.wanted_end <> new.wanted_start then
    v_wanted := v_wanted || '–' || pg_catalog.to_char(new.wanted_end, 'DD/MM/YYYY');
  end if;

  insert into public.app_cpe_user_notifications
    (user_id, chapa, event_type, title, body, entity_key, change_hash,
     target_tab, metadata, created_at)
  select recipient.id, recipient.chapa, 'vacation_offer_published',
    'Nuevo intercambio de vacaciones',
    v_name || ' · ' || v_author.chapa || ' ofrece ' || v_offered || ' y busca ' || v_wanted || '.',
    new.id::text, new.id::text, 'vacaciones',
    pg_catalog.jsonb_build_object('offerId', new.id), new.created_at
  from public.app_cpe_users recipient
  on conflict (chapa, event_type, entity_key, change_hash) do nothing;
  return new;
end;
$$;
revoke all on function private.app_cpe_notify_vacation_offer_published() from public, anon, authenticated;
create trigger app_cpe_vacation_offer_published_notification
  after insert on public.app_cpe_vacation_offers
  for each row when (new.status = 'open')
  execute function private.app_cpe_notify_vacation_offer_published();
