alter table public.app_cpe_users
  add column if not exists irpf_rate numeric(4, 1) not null default 0;

alter table public.app_cpe_users
  drop constraint if exists app_cpe_users_irpf_rate_check;

alter table public.app_cpe_users
  add constraint app_cpe_users_irpf_rate_check
  check (irpf_rate >= 0 and irpf_rate <= 60);

create or replace function public.app_cpe_public_user(
  p_user public.app_cpe_users,
  p_token text
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'token', p_token,
    'chapa', p_user.chapa,
    'specialties', p_user.specialties,
    'irpfRate', p_user.irpf_rate,
    'createdAt', p_user.created_at
  );
$$;

create or replace function public.app_cpe_update_irpf(
  p_token text,
  p_irpf_rate numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
  v_irpf_rate numeric(4, 1);
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if p_irpf_rate is null or p_irpf_rate < 0 or p_irpf_rate > 60 then
    raise exception 'El IRPF debe estar entre 0 y 60';
  end if;

  v_irpf_rate := round(p_irpf_rate, 1);

  update public.app_cpe_users
  set irpf_rate = v_irpf_rate,
      updated_at = now()
  where id = v_user.id
  returning * into v_updated;

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

revoke all on function public.app_cpe_update_irpf(text, numeric) from public;
grant execute on function public.app_cpe_update_irpf(text, numeric) to anon, authenticated;
