-- Destravar (e travar de volta) um mês pelo painel da DRE/DFC.
--
-- Quando `demonstracoes_mes_trancado` nasceu, só o import do tracker
-- (service_role) trancava e ninguém destrancava: a planilha fechada era a única
-- autoridade sobre "este mês acabou". Na prática isso virou um beco sem saída —
-- o import de 18/07/2026 trancou Jul-26 junto com os outros 30 meses, mas julho
-- ainda estava correndo e entrou pela metade (27 de 63 contas no DRE, nenhuma
-- linha de receita). Dali em diante o omie-sync passou a pular a coluna para
-- sempre, e não havia como sair disso pela interface.
--
-- Agora `authenticated` pode destravar e travar de volta, sempre por ação
-- explícita no painel. `origem` continua registrando a procedência: o import
-- grava o nome do arquivo, a trava feita na mão grava 'painel'.

grant insert, delete on public.demonstracoes_mes_trancado to authenticated;

drop policy if exists "auth_destrava_mes" on public.demonstracoes_mes_trancado;
create policy "auth_destrava_mes" on public.demonstracoes_mes_trancado
  for delete to authenticated using (true);

drop policy if exists "auth_trava_mes" on public.demonstracoes_mes_trancado;
create policy "auth_trava_mes" on public.demonstracoes_mes_trancado
  for insert to authenticated with check (true);
