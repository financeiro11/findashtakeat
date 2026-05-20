
insert into storage.buckets (id, name, public) values ('base-conhecimento-pdf', 'base-conhecimento-pdf', false) on conflict (id) do nothing;

create policy "auth read bk pdf" on storage.objects for select to authenticated using (bucket_id = 'base-conhecimento-pdf');
create policy "auth insert bk pdf" on storage.objects for insert to authenticated with check (bucket_id = 'base-conhecimento-pdf');
create policy "auth update bk pdf" on storage.objects for update to authenticated using (bucket_id = 'base-conhecimento-pdf');
create policy "auth delete bk pdf" on storage.objects for delete to authenticated using (bucket_id = 'base-conhecimento-pdf');
