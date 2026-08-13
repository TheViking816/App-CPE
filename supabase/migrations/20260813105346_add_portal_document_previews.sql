create table if not exists public.app_cpe_portal_documents (
  channel text not null,
  chapa text not null,
  document_id text not null,
  title text not null,
  mime_type text not null default 'application/pdf',
  content_base64 text not null,
  updated_at timestamptz not null default now(),
  primary key (channel, chapa, document_id)
);

alter table public.app_cpe_portal_documents enable row level security;
revoke all on public.app_cpe_portal_documents from public, anon, authenticated;

create or replace function public.app_cpe_get_portal_document(
  p_token text,
  p_channel text,
  p_document_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_document public.app_cpe_portal_documents;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if length(coalesce(p_channel, '')) < 1 or length(p_channel) > 100 then
    raise exception 'Canal de documento no valido';
  end if;
  if length(coalesce(p_document_id, '')) < 1 or length(p_document_id) > 240 then
    raise exception 'Documento no valido';
  end if;

  select * into v_document
  from public.app_cpe_portal_documents
  where channel = p_channel
    and chapa = v_user.chapa
    and document_id = p_document_id;

  if v_document.document_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_document.document_id,
    'title', v_document.title,
    'mimeType', v_document.mime_type,
    'contentBase64', v_document.content_base64,
    'updatedAt', v_document.updated_at
  );
end;
$$;

revoke all on function public.app_cpe_get_portal_document(text, text, text) from public;
grant execute on function public.app_cpe_get_portal_document(text, text, text) to anon, authenticated;
