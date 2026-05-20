insert into storage.buckets (id, name, public) values ('demonstracoes-pdf', 'demonstracoes-pdf', false) on conflict do nothing;

create policy "auth read dem pdf" on storage.objects for select to authenticated using (bucket_id = 'demonstracoes-pdf');
create policy "auth insert dem pdf" on storage.objects for insert to authenticated with check (bucket_id = 'demonstracoes-pdf');
create policy "auth update dem pdf" on storage.objects for update to authenticated using (bucket_id = 'demonstracoes-pdf');
create policy "auth delete dem pdf" on storage.objects for delete to authenticated using (bucket_id = 'demonstracoes-pdf');

alter table public.demonstracoes_contabeis add column if not exists pdf_path text;