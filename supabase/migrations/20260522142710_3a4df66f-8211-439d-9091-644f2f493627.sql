
create policy "playbook-assets read" on storage.objects for select using (bucket_id = 'playbook-assets');
create policy "playbook-assets insert" on storage.objects for insert to authenticated with check (bucket_id = 'playbook-assets');
create policy "playbook-assets update" on storage.objects for update to authenticated using (bucket_id = 'playbook-assets');
create policy "playbook-assets delete" on storage.objects for delete to authenticated using (bucket_id = 'playbook-assets');
