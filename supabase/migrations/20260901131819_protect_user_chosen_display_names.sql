create or replace function private.app_cpe_protect_user_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.display_name is distinct from old.display_name
     and pg_catalog.current_setting('app_cpe.allow_profile_display_name_update', true) is distinct from 'on' then
    new.display_name := old.display_name;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_protect_user_display_name()
  from public, anon, authenticated;

drop trigger if exists app_cpe_protect_user_display_name
  on public.app_cpe_users;
create trigger app_cpe_protect_user_display_name
before update of display_name on public.app_cpe_users
for each row
execute function private.app_cpe_protect_user_display_name();

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

  perform pg_catalog.set_config('app_cpe.allow_profile_display_name_update', 'on', true);
  update public.app_cpe_users
  set display_name = v_display_name,
      forum_show_chapa = coalesce(p_forum_show_chapa, false),
      updated_at = now()
  where id = v_user.id
  returning * into v_updated;
  perform pg_catalog.set_config('app_cpe.allow_profile_display_name_update', 'off', true);

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

revoke all on function public.app_cpe_update_profile(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.app_cpe_update_profile(text, text, boolean)
  to anon, authenticated;
