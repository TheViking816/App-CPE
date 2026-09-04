alter table public.app_cpe_portal_auto_sync
  add column if not exists premium_history_email_pending_at timestamptz;
alter table public.app_cpe_activation_email_outbox drop constraint if exists app_cpe_activation_email_outbox_kind_check;
alter table public.app_cpe_activation_email_outbox add constraint app_cpe_activation_email_outbox_kind_check
  check (kind in ('admin_pending','user_activated','portal_credentials_rejected','premium_history_ready'));

create or replace function private.app_cpe_mark_premium_history_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.security_key_secret_id is null and new.security_key_secret_id is not null
     and old.portal_password_secret_id is not null
     and exists (select 1 from public.app_cpe_users where chapa=new.chapa and portal_activation_status='active')
     and not exists (select 1 from public.app_cpe_activation_email_outbox where chapa=new.chapa and kind='premium_history_ready')
  then new.premium_history_email_pending_at := now(); end if;
  return new;
end; $$;
revoke all on function private.app_cpe_mark_premium_history_email() from public,anon,authenticated;
create trigger app_cpe_mark_premium_history_email before update of security_key_secret_id
on public.app_cpe_portal_auto_sync for each row execute function private.app_cpe_mark_premium_history_email();

create or replace function private.app_cpe_queue_premium_history_email(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  j public.app_cpe_portal_sync_jobs;
  u public.app_cpe_users;
  s public.app_cpe_portal_snapshots;
  pending_at timestamptz;
begin
  select * into j from public.app_cpe_portal_sync_jobs where id=p_job_id;
  if j.status is distinct from 'completed' or j.request_kind is distinct from 'history' then return false; end if;
  select premium_history_email_pending_at into pending_at from public.app_cpe_portal_auto_sync
    where chapa=j.chapa for update;
  if pending_at is null then return false; end if;
  select * into u from public.app_cpe_users where chapa=j.chapa;
  if u.portal_activation_status is distinct from 'active' or nullif(trim(u.email),'') is null then return false; end if;
  select * into s from public.app_cpe_portal_snapshots where chapa=j.chapa;
  if s.payload #>> '{sync,inProgress}' is distinct from 'false'
    or s.payload #>> '{sync,partial}' is distinct from 'false'
    or coalesce(s.payload #> '{sync,warnings}', '[]'::jsonb) <> '[]'::jsonb
    or coalesce(s.payload #> '{primas,historyWarnings}', '[]'::jsonb) <> '[]'::jsonb
    or s.payload #>> '{sync,fullHistoryCompletedAt}' is null
    or (s.payload #>> '{sync,fullHistoryCompletedAt}')::timestamptz < j.started_at
    or s.payload #>> '{nominas,recognized}' is distinct from 'true'
    or s.payload #>> '{nominas,locked}' is distinct from 'false'
    or coalesce(jsonb_array_length(s.payload #> '{nominas,rows}'),0)=0
  then return false; end if;
  -- No aviso de éxito si falta algún PDF de la lista recuperada.
  if exists (
    select 1 from jsonb_array_elements(s.payload #> '{nominas,rows}') r
    where not exists (
      select 1 from public.app_cpe_portal_documents d
      where d.chapa=j.chapa and d.channel='main' and d.document_id=r->>'id'
        and length(coalesce(d.content_base64,''))>0
    )
  ) then return false; end if;
  insert into public.app_cpe_activation_email_outbox(user_id,kind,recipient,chapa)
    values(u.id,'premium_history_ready',u.email,u.chapa)
    on conflict(user_id,kind) do nothing;
  update public.app_cpe_portal_auto_sync set premium_history_email_pending_at=null where chapa=j.chapa;
  return true;
end; $$;
revoke all on function private.app_cpe_queue_premium_history_email(uuid) from public,anon,authenticated;
grant execute on function private.app_cpe_queue_premium_history_email(uuid) to service_role;

create or replace function private.app_cpe_premium_history_completed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='completed' and old.status is distinct from new.status then
    perform private.app_cpe_queue_premium_history_email(new.id);
  end if;
  return new;
end; $$;
revoke all on function private.app_cpe_premium_history_completed() from public,anon,authenticated;
create trigger app_cpe_premium_history_completed after update of status on public.app_cpe_portal_sync_jobs
for each row execute function private.app_cpe_premium_history_completed();
