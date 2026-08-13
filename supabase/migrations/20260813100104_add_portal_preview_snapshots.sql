create table if not exists public.app_cpe_portal_preview_snapshots (
  channel text not null,
  chapa text not null,
  source text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (channel, chapa)
);

alter table public.app_cpe_portal_preview_snapshots enable row level security;
revoke all on public.app_cpe_portal_preview_snapshots from public, anon, authenticated;

create or replace function public.app_cpe_get_portal_preview_snapshot(
  p_token text,
  p_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_snapshot public.app_cpe_portal_preview_snapshots;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if length(coalesce(p_channel, '')) < 1 or length(p_channel) > 100 then
    raise exception 'Canal de preview no valido';
  end if;

  select * into v_snapshot
  from public.app_cpe_portal_preview_snapshots
  where channel = p_channel and chapa = v_user.chapa;

  if v_snapshot.chapa is null then
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

revoke all on function public.app_cpe_get_portal_preview_snapshot(text, text) from public;
grant execute on function public.app_cpe_get_portal_preview_snapshot(text, text) to anon, authenticated;
