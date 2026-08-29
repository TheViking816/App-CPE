create table if not exists public.app_cpe_bolsa_worker_directory (
  bolsa_chapa text primary key check (bolsa_chapa ~ '^80[0-9]{3}$'),
  censo_number integer generated always as (right(bolsa_chapa, 3)::integer) stored,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  source text not null default 'portalestibavlc' check (source in ('portalestibavlc', 'app_cpe', 'manual')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_cpe_bolsa_worker_directory_censo_idx
  on public.app_cpe_bolsa_worker_directory (censo_number);

alter table public.app_cpe_bolsa_worker_directory enable row level security;

revoke all on table public.app_cpe_bolsa_worker_directory from public, anon, authenticated;
grant select on table public.app_cpe_bolsa_worker_directory to anon, authenticated;
grant select, insert, update, delete on table public.app_cpe_bolsa_worker_directory to service_role;

drop policy if exists "Bolsa worker directory is publicly readable" on public.app_cpe_bolsa_worker_directory;
create policy "Bolsa worker directory is publicly readable"
on public.app_cpe_bolsa_worker_directory
for select
to anon, authenticated
using (true);

comment on table public.app_cpe_bolsa_worker_directory is
  'Directorio acumulativo de chapas de bolsa y nombres observados para completar los partes.';
