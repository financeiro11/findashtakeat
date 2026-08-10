-- Imagens anexadas às conversas do Assistente.
--
-- `ai_messages.imagens` guarda os CAMINHOS no bucket, não os bytes: o base64 vai na
-- requisição da IA e morre ali. Sem esta coluna, reabrir a conversa mostrava uma pergunta
-- sobre uma imagem que não estava mais na tela.
alter table public.ai_messages
  add column if not exists imagens jsonb not null default '[]'::jsonb;

-- Bucket PRIVADO e por dono — ao contrário de playbook-assets/facilities-contratos, que
-- são material da empresa. Aqui é o print que a pessoa colou na conversa dela, e
-- `ai_conversations`/`ai_messages` já são visíveis só para o próprio usuário: um bucket
-- legível por todo mundo autenticado desfaria essa regra por fora.
insert into storage.buckets (id, name, public)
values ('assistente-imagens', 'assistente-imagens', false)
on conflict (id) do nothing;

-- A primeira pasta do caminho é o user_id de quem enviou — é o que amarra o arquivo ao dono.
create policy "dono le assistente-imagens" on storage.objects
  for select to authenticated
  using (bucket_id = 'assistente-imagens' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dono envia assistente-imagens" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assistente-imagens' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dono apaga assistente-imagens" on storage.objects
  for delete to authenticated
  using (bucket_id = 'assistente-imagens' and (storage.foldername(name))[1] = auth.uid()::text);
