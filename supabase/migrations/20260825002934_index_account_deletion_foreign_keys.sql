create index if not exists app_cpe_portal_documents_chapa_idx
  on public.app_cpe_portal_documents (chapa);

create index if not exists app_cpe_portal_preview_snapshots_chapa_idx
  on public.app_cpe_portal_preview_snapshots (chapa);
