-- Radar / vigia: a régua da cadência é a SEMANA, não uma janela de sete dias
-- correndo atrás do último clique.
--
-- O BURACO, medido em 03/09/2026. Os quatro alvos do kit de estação (monitor,
-- notebook, mouse, headset) estavam em vigia com `cadencia_dias = 7` e foram
-- varridos à mão numa quarta-feira, 02/09, às 14h50. O cron da vigia roda
-- `0 12 * * 1` — segunda, 09:00 BRT. Na segunda seguinte, 07/09, teriam passado
-- 4 dias e 18 horas desde a última varredura: MENOS que os sete da cadência.
-- A fila não os devolveria, e a curva só ganharia o próximo ponto em 14/09.
--
-- Doze dias de buraco numa série semanal, e — o que é pior — sem nada na tela
-- dizendo: o gráfico continuaria bonito, ligando o ponto de 02/09 direto no de
-- 14/09 como se aquela reta fosse medição. A vigia existe para responder "o
-- mercado está caro?"; uma série com furo responde isso com confiança falsa.
--
-- E NÃO É CASO DE BORDA: é o caso NORMAL. Qualquer varredura no meio da semana
-- — o ⟳ do card, um alvo recém-criado, um teste — empurra o alvo para depois da
-- segunda seguinte. Quem varre à mão toda quarta faz o cron semanal nunca pegar
-- aquele alvo, e o sintoma é uma curva quinzenal que ninguém pediu.
--
-- A CORREÇÃO É NA REGRA, NÃO NAS LINHAS. Baixar `cadencia_dias` para 0 nos
-- quatro alvos resolveria hoje e voltaria a quebrar no próximo alvo cadastrado
-- com o padrão de 7 — conserto que depende de alguém lembrar não é conserto.
-- O erro real é conceitual: quando o agendador é semanal e fixo na segunda, é
-- ELE o portão da cadência, e a pergunta certa não é "já se passaram 7 dias?"
-- mas "este alvo já foi medido NESTA semana?".
--
-- Semana em horário de São Paulo, e não em UTC: a série é da operação, e a
-- semana da operação começa na segunda de manhã daqui. O cron às 12:00 UTC cai
-- às 09:00 BRT, bem depois do corte — então toda segunda a fila enxerga quem
-- não foi medido desde domingo à noite, e só ele.
--
-- O QUE ISTO NÃO MUDA. A cadência maior que uma semana continua valendo pela
-- janela de sempre: quem põe `cadencia_dias = 21` quer três semanas, e a regra
-- da semana corrente não pode encurtar isso. Por isso as duas condições convivem
-- em `or` — a da semana só governa quem pede uma semana ou menos.
-- O piso de 30 minutos também fica: é ele que impede as cinco chamadas
-- encadeadas do cron (12:00, 12:05, … 12:20) de varrerem o mesmo alvo duas
-- vezes, e é ele que segura o gasto se alguém clicar no ⟳ às 08:50 da segunda.

create or replace function public.facilities_radar_fila_vigia(p_limite integer default 20)
returns setof public.facilities_radar_alvos
language sql
stable
security invoker
set search_path = public
as $$
  select a.*
  from facilities_radar_alvos a
  where a.ativo
    and a.modo = 'vigia'
    and (
      a.cadencia_dias <= 0
      or a.ultima_varredura is null
      -- A REGRA DA SEMANA, que é a que faz o cron de segunda cumprir o que
      -- promete. Vale para quem pede uma semana ou menos (o caso de todo alvo
      -- de vigia normal); acima disso, quem manda é a janela abaixo.
      or (
        a.cadencia_dias <= 7
        and a.ultima_varredura
              < date_trunc('week', now() at time zone 'America/Sao_Paulo')
                at time zone 'America/Sao_Paulo'
      )
      -- A janela de sempre, para cadência quinzenal ou mensal.
      or a.ultima_varredura < now() - make_interval(days => a.cadencia_dias) + interval '1 hour'
    )
    -- O piso, independente da cadência: nem o alvo de cadência 0 ("toda rodada")
    -- precisa ser varrido duas vezes nas cinco chamadas encadeadas do cron.
    and (a.ultima_varredura is null or a.ultima_varredura < now() - interval '30 minutes')
  -- Favorito na frente, e depois quem está há mais tempo sem curva. Modelo
  -- adotado e faixa disputam a mesma fila de propósito: o que interessa é a
  -- série não ter buraco, e um buraco na faixa custa o mesmo que no modelo.
  order by a.favorito desc, a.ultima_varredura asc nulls first
  limit greatest(coalesce(p_limite, 20), 1);
$$;

revoke all on function public.facilities_radar_fila_vigia(integer) from anon, public;
grant execute on function public.facilities_radar_fila_vigia(integer) to authenticated, service_role;

comment on function public.facilities_radar_fila_vigia(integer) is
  'Fila do cron semanal da vigia. A cadência de até uma semana é medida pela SEMANA CORRENTE (segunda, horário de São Paulo), e não por uma janela de 7 dias a partir da última varredura: com o cron fixo na segunda, a janela fazia qualquer varredura de meio de semana pular a segunda seguinte e abrir um buraco de 12 dias na curva. Acima de 7 dias vale a janela. Ver a migração de 03/09/2026.';
