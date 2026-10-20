-- Training dates supplied by the app owner for the 40 new census chapas.
-- Keep assignments by chapa so workers do not need an account beforehand.
create table private.app_cpe_initial_paid_days (
  chapa text not null check (chapa ~ '^[0-9]{5}$'),
  work_date date not null,
  concept_type text not null check (concept_type in ('VA', 'FM')),
  primary key (chapa, work_date)
);
alter table private.app_cpe_initial_paid_days enable row level security;
revoke all on private.app_cpe_initial_paid_days from public, anon, authenticated;

insert into private.app_cpe_initial_paid_days(chapa, work_date, concept_type)
select chapa, day::date, 'FM'
from unnest(array[
  '72745','72746','72748','72749','72750','72751','72752','72753',
  '72754','72755','72756','72757','72758','72759','72760','72761',
  '72762','72763','72764','72765','72766','72767','72768','72769',
  '72770','72772','72773','72774','72775','72776','72777','72778',
  '72781','72782','72783','72784','72785','72786','72787','72788'
]) chapa
cross join generate_series(date '2026-10-19', date '2026-10-22', interval '1 day') day;

create function private.app_cpe_apply_initial_paid_days()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into private.app_cpe_manual_paid_days(user_id, work_date, concept_type)
  select new.id, d.work_date, d.concept_type
  from private.app_cpe_initial_paid_days d where d.chapa = new.chapa
  on conflict (user_id, work_date) do nothing;
  return new;
end;
$$;
revoke all on function private.app_cpe_apply_initial_paid_days() from public, anon, authenticated;

create trigger app_cpe_apply_initial_paid_days_trigger
after insert on public.app_cpe_users
for each row execute function private.app_cpe_apply_initial_paid_days();

-- Backfill accounts already registered, preserving existing VA/FM choices.
insert into private.app_cpe_manual_paid_days(user_id, work_date, concept_type)
select u.id, d.work_date, d.concept_type
from private.app_cpe_initial_paid_days d
join public.app_cpe_users u on u.chapa = d.chapa
on conflict (user_id, work_date) do nothing;
