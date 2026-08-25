create or replace function public.app_cpe_forum_list(
  p_token text,
  p_limit integer default 50,
  p_before_id bigint default null
)
returns table (
  id bigint,
  author_chapa text,
  author_name text,
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
    case when m.author_chapa = '72683' then 'Administrador' else m.author_name end,
    m.message,
    m.created_at
  from public.app_cpe_forum_messages m
  where p_before_id is null or m.id < p_before_id
  order by m.id desc
  limit v_limit;
end;
$$;

create or replace function public.app_cpe_forum_post(
  p_token text,
  p_message text
)
returns table (
  id bigint,
  author_chapa text,
  author_name text,
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
  insert into public.app_cpe_forum_messages (
    user_id,
    author_chapa,
    author_name,
    message
  ) values (
    v_user.id,
    v_user.chapa,
    v_author_name,
    v_message
  )
  returning
    app_cpe_forum_messages.id,
    app_cpe_forum_messages.author_chapa,
    app_cpe_forum_messages.author_name,
    app_cpe_forum_messages.message,
    app_cpe_forum_messages.created_at;
end;
$$;

revoke all on function public.app_cpe_forum_list(text, integer, bigint) from public, anon, authenticated;
revoke all on function public.app_cpe_forum_post(text, text) from public, anon, authenticated;

grant execute on function public.app_cpe_forum_list(text, integer, bigint) to anon, authenticated;
grant execute on function public.app_cpe_forum_post(text, text) to anon, authenticated;

update public.app_cpe_forum_messages
set message = 'Bienvenidos al foro de App CPE. La aplicación todavía está en fase beta. Podéis comentar aquí cualquier error o fallo para que podamos revisarlo y hacer la mejor app posible. Este espacio también es vuestro para hablar y compartir lo que queráis entre compañeros.'
where author_chapa = '72683'
  and message like 'Bienvenidos al foro de App CPE.%';
