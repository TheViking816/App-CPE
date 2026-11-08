-- Runs in production in a rolled-back transaction; no real account is changed.
begin;
do $$
declare v_user uuid; v_chapa text; v_reset jsonb; v_second jsonb; v_token text;
begin
  select n::text into v_chapa from generate_series(99000,99999) n
  where not exists(select 1 from public.app_cpe_users where chapa=n::text) limit 1;
  if v_chapa is null then raise exception 'No available test chapa'; end if;
  insert into public.app_cpe_users(chapa,password_hash,email)
  values(v_chapa,extensions.crypt('test-old-password',extensions.gen_salt('bf')),'test@example.invalid') returning id into v_user;
  v_reset := public.app_cpe_issue_password_reset(v_chapa,'integration-' || v_user);
  if v_reset->>'email' <> 'test@example.invalid' then raise exception 'Wrong recipient'; end if;
  if exists(select 1 from private.app_cpe_password_resets where token_hash=v_reset->>'token') then raise exception 'Token stored in plaintext'; end if;
  v_token := public.app_cpe_create_session(v_user);
  if not public.app_cpe_reset_password(v_reset->>'token','test-new-password') then raise exception 'Reset failed'; end if;
  if public.app_cpe_reset_password(v_reset->>'token','test-reused-password') then raise exception 'Token reused'; end if;
  if exists(select 1 from public.app_cpe_sessions where user_id=v_user) then raise exception 'Sessions not revoked'; end if;
  if not exists(select 1 from public.app_cpe_users where id=v_user and password_hash=extensions.crypt('test-new-password',password_hash)) then raise exception 'Password not updated'; end if;
  v_reset := public.app_cpe_issue_password_reset(v_chapa,'integration-' || v_user);
  update private.app_cpe_password_resets set expires_at=now()-interval '1 minute' where user_id=v_user;
  if public.app_cpe_reset_password(v_reset->>'token','test-expired-password') then raise exception 'Expired token accepted'; end if;
  v_second := public.app_cpe_issue_password_reset(v_chapa,'integration-' || v_user);
  if public.app_cpe_reset_password(v_reset->>'token','test-obsolete-password') then raise exception 'Superseded token accepted'; end if;
  if public.app_cpe_issue_password_reset(v_chapa,'integration-' || v_user) is not null then raise exception 'Rate limit failed'; end if;
  v_token := public.app_cpe_create_session(v_user);
  begin
    perform public.app_cpe_set_recovery_email(v_token,'wrong-password','new@example.invalid');
    raise exception 'Incorrect password accepted';
  exception when others then
    if SQLERRM <> 'La contraseña actual no es correcta' then raise; end if;
  end;
  perform public.app_cpe_set_recovery_email(v_token,'test-new-password','new@example.invalid');
  if exists(select 1 from private.app_cpe_password_resets where user_id=v_user) then raise exception 'Email change did not revoke tokens'; end if;
  if has_function_privilege('anon','public.app_cpe_issue_password_reset(text,text)','execute') or has_function_privilege('authenticated','public.app_cpe_reset_password(text,text)','execute') then raise exception 'Unsafe function permissions'; end if;
  if has_table_privilege('anon','private.app_cpe_password_resets','select') then raise exception 'Unsafe token permissions'; end if;
end $$;
rollback;
