-- A chave da emissão automática precisa caber na tela.
--
-- `nf_config` tinha só política de leitura, então ligar a emissão automática
-- exigia um UPDATE no banco. Um interruptor que só existe em SQL não é um
-- interruptor: é um recado para chamar alguém. E o modo `previa` só cumpre o
-- papel dele — ensaiar um dia e então liberar — se liberar for um clique de quem
-- olhou o ensaio.
--
-- A permissão segue a mesma regra que a Edge Function aplica na emissão e que o
-- AppLayout aplica na navegação: quem tem cargo "parcerias" fica de fora.

drop policy if exists nf_config_atualizar on public.nf_config;
create policy nf_config_atualizar on public.nf_config
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(lower(trim(p.cargo)), '') <> 'parcerias'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(lower(trim(p.cargo)), '') <> 'parcerias'
    )
  );
