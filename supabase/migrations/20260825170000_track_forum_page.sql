alter table public.app_cpe_usage_events
  drop constraint if exists app_cpe_usage_events_page_key_check;

alter table public.app_cpe_usage_events
  add constraint app_cpe_usage_events_page_key_check
  check (
    page_key is null
    or page_key in (
      'inicio',
      'contratacion',
      'sueldometro',
      'descansos',
      'excepciones',
      'vacaciones',
      'nominas',
      'estado',
      'puertas',
      'censo',
      'portal',
      'tablon',
      'enlaces',
      'foro'
    )
  );

create or replace function public.app_cpe_track_page_visit(
  p_token text,
  p_page text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_page text := lower(trim(coalesce(p_page, '')));
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if v_page not in (
    'inicio',
    'contratacion',
    'sueldometro',
    'descansos',
    'excepciones',
    'vacaciones',
    'nominas',
    'estado',
    'puertas',
    'censo',
    'portal',
    'tablon',
    'enlaces',
    'foro'
  ) then
    raise exception 'Página no permitida';
  end if;

  if v_user.chapa = '72683' then
    return jsonb_build_object('ok', true, 'tracked', false);
  end if;

  insert into public.app_cpe_usage_events (event_type, chapa, page_key, metadata)
  values (
    'page_visit',
    v_user.chapa,
    v_page,
    jsonb_build_object('page', v_page)
  );

  return jsonb_build_object('ok', true, 'tracked', true, 'page', v_page);
end;
$$;

revoke all on function public.app_cpe_track_page_visit(text, text) from public;
grant execute on function public.app_cpe_track_page_visit(text, text) to anon, authenticated;
