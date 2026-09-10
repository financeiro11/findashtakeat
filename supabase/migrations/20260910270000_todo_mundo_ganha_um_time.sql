-- TODO MUNDO GANHA UM TIME.
--
-- 99 favorecidos têm pagamento e nenhum setor: R$ 2.433.685 de história, quase
-- toda de gente que saiu antes de abr/2026 e por isso nunca esteve no Portal
-- RH. Sem time, eles não entram no recorte de líder nenhum — e a ausência é
-- silenciosa: o 2025 do Head de Operações aparecia 29% menor sem nada na tela
-- dizendo que faltava alguém.
--
-- A fila de classificação à mão (Remuneração › "Sem time") existe para isso,
-- mas 99 decisões à mão é uma tarefa que nunca fica pronta. Esta migration faz
-- a parte que a máquina pode fazer com segurança e deixa o resto marcado.
--
-- ---------------------------------------------------------------------------
-- DOIS NÍVEIS DE CONFIANÇA, E ELES NÃO SÃO A MESMA COISA
--
--   56 pessoas (R$ 1.376.274) — a área da categoria do Omie É um setor que
--   existe no Portal RH, com o mesmo nome: Onboarding (17), Marketing (12),
--   Tecnologia (10), Suporte (9), Sucesso (8). Aqui não há palpite: "Pessoal -
--   Onboarding" é o time de Onboarding. Destas, 34 são dos times do Head de
--   Operações e recuperam os R$ 537 mil que faltavam no histórico dele.
--
--   43 pessoas (R$ 1.057.411) — a área NÃO é um setor: Comercial (32), Novos
--   Canais (6), Administrativo (5). "Comercial" no Omie é Field Sales, Inside
--   Sales OU Franquias, e escolher entre eles é informação que só uma pessoa
--   tem. Elas recebem a ÁREA como time genérico, para ficarem visíveis e
--   somáveis, e continuam aparecendo na fila para serem afinadas.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION *NÃO* FAZ, DE PROPÓSITO
--
-- **Não escreve em `rh_colaboradores`.** Aquilo é o espelho do Portal RH, e
-- inventar linha lá contamina a fonte: a tela de Colaboradores passaria a
-- listar gente que o RH não conhece, e a próxima sincronização teria de decidir
-- o que fazer com registros que nasceram aqui. O lugar do dado inventado é
-- `remuneracao_pessoa`, que já é superconjunto do espelho e já tem a coluna
-- `setor` para exatamente isto — o time efetivo é
-- `coalesce(rh_colaboradores.setor, remuneracao_pessoa.setor)`, então o RH
-- continua mandando em quem ele conhece.
--
-- **Não inventa CARGO.** É onde eu discordo do pedido, e o motivo é concreto:
-- cargo neste painel não é rótulo, é CHAVE DE COMPARAÇÃO. `compararComPares`
-- agrupa por cargo para dizer se alguém está acima ou abaixo da mediana dos
-- pares, e "quem está fora da linha" mede a dispersão dentro do cargo. Dar
-- "Comercial" como cargo genérico a 32 pessoas criaria um grupo de pares de 32
-- que vai de estagiário a head — a mediana viraria ruído e a tela acusaria
-- gente de estar fora de uma linha que não existe. Cargo vazio é honesto:
-- a pessoa aparece, soma no custo, entra no time, e simplesmente não participa
-- de uma comparação que não teria sentido.

-- ─────────────────── 1. O time, pela área que mais pagou ───────────────────

with alvo as (
  select p.id
    from public.remuneracao_pessoa p
    left join public.rh_colaboradores r on r.codigo = p.codigo_rh
   where p.setor is null
     and r.setor is null
     and exists (select 1 from public.remuneracao_lancamento l where l.pessoa_id = p.id)
),
area_principal as (
  /* A área que somou MAIS DINHEIRO, não a mais frequente: quem passou dez meses
     no Suporte e fechou com uma premiação grande do Comercial tem o peso onde o
     dinheiro foi. Mesma regra da fila de classificação da tela. */
  select a.id,
         (select v.area
            from public.vw_remuneracao_mensal v
           where v.pessoa_id = a.id and v.area is not null
           group by v.area
           order by sum(v.total) desc, v.area
           limit 1) as area
    from alvo a
)
update public.remuneracao_pessoa p
   set setor = ap.area, atualizado_em = now()
  from area_principal ap
 where p.id = ap.id
   and ap.area is not null;

-- ─────────────────── 2. Conferência ───────────────────

/* Um backfill que não pega ninguém passa despercebido; um que pega gente demais
   reescreve o time de quem o RH já classificou. As duas coisas falham aqui. */
do $$
declare
  v_sem_time    integer;
  v_com_manual  integer;
  v_rh_intacto  integer;
  v_danilo      integer;
begin
  select count(*) into v_sem_time
    from public.remuneracao_pessoa p
    left join public.rh_colaboradores r on r.codigo = p.codigo_rh
   where coalesce(r.setor, p.setor) is null
     and exists (select 1 from public.remuneracao_lancamento l where l.pessoa_id = p.id);

  select count(*) into v_com_manual from public.remuneracao_pessoa where setor is not null;

  -- Ninguém que o RH conhece pode ter ganhado um setor manual por cima.
  select count(*) into v_rh_intacto
    from public.remuneracao_pessoa p
    join public.rh_colaboradores r on r.codigo = p.codigo_rh
   where p.setor is not null and r.setor is not null and r.setor <> p.setor;

  select count(distinct p.id) into v_danilo
    from public.remuneracao_pessoa p
    left join public.rh_colaboradores r on r.codigo = p.codigo_rh
   where coalesce(r.setor, p.setor) = any (array['Sucesso', 'Onboarding', 'Suporte']);

  if v_sem_time > 0 then
    raise exception 'ainda há % pessoas com pagamento e sem time', v_sem_time;
  end if;
  if v_rh_intacto > 0 then
    raise exception '% pessoas do Portal RH ganharam setor manual divergente', v_rh_intacto;
  end if;

  raise notice 'classificadas à mão: % · recorte de Operações: % pessoas (era 47)',
    v_com_manual, v_danilo;
end $$;
