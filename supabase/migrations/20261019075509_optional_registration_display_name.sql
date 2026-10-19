-- Keep the six-argument registration available for existing app versions.
-- Both calls run in one transaction: an invalid name leaves no account/session.
create or replace function public.app_cpe_register_manual_profile_named(
  p_chapa text, p_password text, p_email text,
  p_professional_group text, p_rest_group text, p_specialties text[],
  p_display_name text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_session jsonb;
begin
  v_session := public.app_cpe_register_manual_profile(
    p_chapa, p_password, p_email, p_professional_group, p_rest_group, p_specialties
  );
  if nullif(pg_catalog.btrim(coalesce(p_display_name, '')), '') is not null then
    v_session := public.app_cpe_update_profile(
      v_session->>'token', p_display_name,
      coalesce((v_session->>'forumShowChapa')::boolean, false)
    );
  end if;
  return v_session;
end;
$$;

revoke all on function public.app_cpe_register_manual_profile_named(text,text,text,text,text,text[],text)
  from public, anon, authenticated;
grant execute on function public.app_cpe_register_manual_profile_named(text,text,text,text,text,text[],text)
  to anon, authenticated;
