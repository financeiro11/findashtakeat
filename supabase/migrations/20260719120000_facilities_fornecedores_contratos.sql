-- Anexos de contrato no cadastro de fornecedor (Facilities). Lista de arquivos
-- (PDF/imagem) enviados na hora de criar/editar o fornecedor.
alter table public.facilities_fornecedores
  add column if not exists contratos jsonb not null default '[]'::jsonb;

-- Storage bucket público (mesmo padrão de playbook-assets/workspace-assets — app interno).
insert into storage.buckets (id, name, public)
values ('facilities-contratos', 'facilities-contratos', true)
on conflict (id) do nothing;

create policy "auth read facilities-contratos" on storage.objects
  for select to authenticated using (bucket_id = 'facilities-contratos');
create policy "public read facilities-contratos" on storage.objects
  for select to anon using (bucket_id = 'facilities-contratos');
create policy "auth upload facilities-contratos" on storage.objects
  for insert to authenticated with check (bucket_id = 'facilities-contratos');
create policy "auth update facilities-contratos" on storage.objects
  for update to authenticated using (bucket_id = 'facilities-contratos');
create policy "auth delete facilities-contratos" on storage.objects
  for delete to authenticated using (bucket_id = 'facilities-contratos');
