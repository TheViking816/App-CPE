create table if not exists public.app_cpe_portal_snapshots (
  id uuid primary key default gen_random_uuid(),
  chapa text not null unique,
  source text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists app_cpe_portal_snapshots_updated_idx
  on public.app_cpe_portal_snapshots (updated_at desc);

alter table public.app_cpe_portal_snapshots enable row level security;

drop policy if exists "App CPE portal snapshots are not directly readable" on public.app_cpe_portal_snapshots;
create policy "App CPE portal snapshots are not directly readable"
  on public.app_cpe_portal_snapshots
  for select
  to anon, authenticated
  using (false);

create or replace function public.app_cpe_get_portal_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_snapshot public.app_cpe_portal_snapshots;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select * into v_snapshot
  from public.app_cpe_portal_snapshots
  where chapa = v_user.chapa;

  if v_snapshot.id is null then
    return jsonb_build_object(
      'ok', true,
      'chapa', v_user.chapa,
      'updatedAt', null,
      'payload', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'chapa', v_snapshot.chapa,
    'source', v_snapshot.source,
    'updatedAt', v_snapshot.updated_at,
    'payload', v_snapshot.payload
  );
end;
$$;

grant execute on function public.app_cpe_get_portal_snapshot(text) to anon, authenticated;
