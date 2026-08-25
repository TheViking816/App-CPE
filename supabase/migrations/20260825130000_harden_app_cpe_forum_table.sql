create index if not exists app_cpe_forum_messages_user_idx
  on public.app_cpe_forum_messages (user_id);

drop policy if exists app_cpe_forum_no_direct_access
  on public.app_cpe_forum_messages;

create policy app_cpe_forum_no_direct_access
  on public.app_cpe_forum_messages
  as restrictive
  for all
  to public
  using (false)
  with check (false);
