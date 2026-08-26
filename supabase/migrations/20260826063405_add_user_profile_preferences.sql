alter table public.app_cpe_users
  add column if not exists forum_show_chapa boolean not null default false;

create or replace function public.app_cpe_public_user(
  p_user public.app_cpe_users,
  p_token text
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'token', p_token,
    'chapa', p_user.chapa,
    'email', p_user.email,
    'displayName', p_user.display_name,
    'forumShowChapa', p_user.forum_show_chapa,
    'specialties', p_user.specialties,
    'portalActivationStatus', p_user.portal_activation_status,
    'portalActivatedAt', p_user.portal_activated_at,
    'createdAt', p_user.created_at
  );
$$;

create or replace function public.app_cpe_update_profile(
  p_token text,
  p_display_name text,
  p_forum_show_chapa boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
  v_display_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '[[:space:]]+', ' ', 'g');
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if char_length(v_display_name) < 1 or char_length(v_display_name) > 40 then
    raise exception 'El nombre debe tener entre 1 y 40 caracteres';
  end if;
  if v_display_name ~ '[[:cntrl:]<>]' then
    raise exception 'El nombre contiene caracteres no permitidos';
  end if;

  update public.app_cpe_users
  set display_name = v_display_name,
      forum_show_chapa = coalesce(p_forum_show_chapa, false),
      updated_at = now()
  where id = v_user.id
  returning * into v_updated;

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

revoke all on function public.app_cpe_update_profile(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.app_cpe_update_profile(text, text, boolean)
  to anon, authenticated;

-- Los nombres y la visibilidad de la chapa se resuelven desde el perfil
-- actual para que los cambios afecten tambien a mensajes ya publicados.
drop function if exists public.app_cpe_forum_list(text, integer, bigint);
create function public.app_cpe_forum_list(
  p_token text,
  p_limit integer default 50,
  p_before_id bigint default null
)
returns table (
  id bigint,
  author_chapa text,
  author_name text,
  author_show_chapa boolean,
  message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  select * into v_user
  from public.app_cpe_user_from_token(p_token);

  if v_user.id is null then
    raise exception 'Sesion no valida';
  end if;

  return query
  select
    m.id,
    m.author_chapa,
    case
      when m.author_chapa = '72683' then 'Administrador'
      else coalesce(nullif(btrim(author.display_name), ''), m.author_name)
    end,
    case when m.author_chapa = '72683' then false else author.forum_show_chapa end,
    m.message,
    m.created_at
  from public.app_cpe_forum_messages m
  join public.app_cpe_users author on author.id = m.user_id
  where p_before_id is null or m.id < p_before_id
  order by m.id desc
  limit v_limit;
end;
$$;

drop function if exists public.app_cpe_forum_post(text, text);
create function public.app_cpe_forum_post(
  p_token text,
  p_message text
)
returns table (
  id bigint,
  author_chapa text,
  author_name text,
  author_show_chapa boolean,
  message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_message text := btrim(coalesce(p_message, ''));
  v_author_name text;
begin
  select * into v_user
  from public.app_cpe_user_from_token(p_token);

  if v_user.id is null then
    raise exception 'Sesion no valida';
  end if;
  if char_length(v_message) < 1 then
    raise exception 'Escribe un mensaje';
  end if;
  if char_length(v_message) > 500 then
    raise exception 'El mensaje no puede superar 500 caracteres';
  end if;
  if exists (
    select 1
    from public.app_cpe_forum_messages recent
    where recent.user_id = v_user.id
      and recent.created_at > now() - interval '2 seconds'
  ) then
    raise exception 'Espera un momento antes de enviar otro mensaje';
  end if;

  v_author_name := public.app_cpe_forum_author_name(v_user.id);

  return query
  with inserted as (
    insert into public.app_cpe_forum_messages (user_id, author_chapa, author_name, message)
    values (v_user.id, v_user.chapa, v_author_name, v_message)
    returning
      app_cpe_forum_messages.id,
      app_cpe_forum_messages.author_chapa,
      app_cpe_forum_messages.author_name,
      app_cpe_forum_messages.message,
      app_cpe_forum_messages.created_at
  )
  select
    inserted.id,
    inserted.author_chapa,
    case when v_user.chapa = '72683' then 'Administrador' else v_author_name end,
    case when v_user.chapa = '72683' then false else v_user.forum_show_chapa end,
    inserted.message,
    inserted.created_at
  from inserted;
end;
$$;

revoke all on function public.app_cpe_forum_list(text, integer, bigint)
  from public, anon, authenticated;
revoke all on function public.app_cpe_forum_post(text, text)
  from public, anon, authenticated;
grant execute on function public.app_cpe_forum_list(text, integer, bigint)
  to anon, authenticated;
grant execute on function public.app_cpe_forum_post(text, text)
  to anon, authenticated;
