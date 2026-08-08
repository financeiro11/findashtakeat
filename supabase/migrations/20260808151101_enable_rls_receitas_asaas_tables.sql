alter table public.receitas_caixa_asaas enable row level security;
alter table public.rc_asaas_finopstkt enable row level security;

drop policy if exists auth_read_receitas_caixa_asaas on public.receitas_caixa_asaas;
create policy auth_read_receitas_caixa_asaas
  on public.receitas_caixa_asaas
  for select
  to authenticated
  using (true);

drop policy if exists auth_read_rc_asaas_finopstkt on public.rc_asaas_finopstkt;
create policy auth_read_rc_asaas_finopstkt
  on public.rc_asaas_finopstkt
  for select
  to authenticated
  using (true);
