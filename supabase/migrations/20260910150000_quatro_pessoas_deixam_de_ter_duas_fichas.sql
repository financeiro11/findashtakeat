-- Quatro pessoas tinham duas fichas na remuneração. Passam a ter uma.
--
-- Achadas por uma varredura que compara os NOMES INTEIROS: pares em que o nome
-- de uma ficha está contido no da outra, com ao menos dois tokens em comum.
-- Homônimo de primeiro nome ("três Lucas") não entra nessa peneira; ficha
-- partida entra.
--
-- ── COMO UMA PESSOA GANHA DUAS FICHAS ────────────────────────────────────
--
-- Em três dos quatro casos a causa é a MESMA e vale a pena escrever: o título
-- no Omie aponta para um cadastro de favorecido SEM CNPJ. `vw_remuneracao_omie`
-- resolve o apelido por documento (`ape_doc`) e, na falta dele, por nome
-- (`ape_nome`) — sem documento nenhum, o que passa é o nome cru do cadastro. E
-- o cadastro do Omie costuma escrever a razão social do MEI com a raiz do CNPJ
-- na frente: "59.437.526 CLAYDERMAN THOMAS FERREIRA DA SILVA". Esse nome
-- normaliza para uma chave diferente da pessoa, e nasce a segunda ficha.
--
-- O Clayderman é o caso de laboratório: sete títulos, todos com o mesmo
-- `nome_cru`, seis com o CNPJ preenchido e UM sem. Os seis viraram a ficha
-- certa; o sétimo, sozinho, virou a outra.
--
-- ── QUAL FICHA FICA ──────────────────────────────────────────────────────
--
-- Sempre a que tem `codigo_rh`, mesmo quando é a que tem MENOS lançamentos.
-- `remuneracao_fundir` move lançamentos e documento, mas não move o
-- `codigo_rh` — e sem ele `remuneracao_sincronizar_rh()` recriaria a ficha do
-- espelho na carga seguinte, desfazendo a fusão todo dia.
--
-- A fusão grava a chave absorvida em `remuneracao_pessoa_alias`, então os
-- títulos futuros com o nome antigo caem na ficha certa sozinhos.

do $$
declare
  v_mantem  uuid;
  v_absorve uuid;
  r         record;
begin
  for r in
    select * from (values
      -- Ficha do RH sem pagamento × ficha de pagamento sem RH.
      --
      -- O RH diz CLOSER INSIDE SALES com início em 18/05/2026; o ERP paga
      -- Pessoal - Comercial a partir de maio/2026, e o primeiro mês é
      -- R$ 1.129,03 — que é exatamente 14/31 de R$ 2.500, os dias de 18 a 31 de
      -- maio. A data, a área e a proporção do primeiro mês fecham as três.
      --
      -- O `cnpj` do espelho do RH (37.511.891) não é o que o ERP paga
      -- (66.804.297). Por isso `remuneracao_fundir_por_documento()` nunca pegou
      -- este par, e por isso a fusão aqui é por nome e não por documento.
      ('Caio Caiado',                          'Caio Augusto Marinho Caiado'),

      -- Um título de sete sem CNPJ no cadastro do favorecido.
      ('Clayderman Thomas Ferreira Da Silva',  '59.437.526 CLAYDERMAN THOMAS FERREIRA DA SILVA'),

      -- Mesma coisa, do outro lado da série: a ficha com a raiz do CNPJ no nome
      -- guarda um lançamento de nov/2024 vindo do Conta Azul; a do RH guarda os
      -- de ago/2026. Mesmo CNPJ (61.107.569) nos dois.
      ('RENATA RUAS PESSOA',                   '61.107.569 RENATA RUAS PESSOA')
    ) as v(mantem, absorve)
  loop
    select id into v_mantem  from public.remuneracao_pessoa where nome = r.mantem;
    select id into v_absorve from public.remuneracao_pessoa where nome = r.absorve;
    if v_mantem is null or v_absorve is null then
      raise exception 'Fusão %/%: uma das fichas não existe mais (mantem=%, absorve=%)',
        r.mantem, r.absorve, v_mantem, v_absorve;
    end if;
    perform public.remuneracao_fundir(v_mantem, v_absorve, 'manual');
  end loop;
end $$;

-- ── O QUARTO CASO É MAIS FRACO, E POR ISSO VEM SEPARADO ───────────────────
--
-- `Lucas Caldas` × `Lucas Henrique Caldas`. Nenhum dos dois tem ficha no RH, e
-- não há documento dos dois lados para casar: o cadastro do favorecido
-- "Lucas Caldas" (nCodCliente 5472069462) está com o CNPJ EM BRANCO — é o mesmo
-- defeito dos três acima, só que sem a testemunha do documento.
--
-- O que sustenta a fusão é a série não ter buraco depois de corrigida a
-- competência. `Lucas Henrique Caldas` termina em mar/2026 (título vencendo
-- 07/04); `Lucas Caldas` aparece em mai/2026 com um título vencendo 07/05 — que
-- é um dos 32 casos em que o lançamento no ERP escorregou de mês e o
-- `dDtRegistro` jogou a competência para a frente. Pela régua do resto da série
-- (vencimento − 1 mês) ele é ABRIL, e abril é exatamente o mês que faltava.
-- Sem buraco, o que resta é um comercial que passou de R$ 3.000 para R$ 5.500
-- entre março e abril — e cujo cadastro de favorecido foi recriado no Omie sem
-- o CNPJ e sem o nome do meio.
--
-- SE ESTIVER ERRADO, DÁ PARA VOLTAR: os dois lançamentos do `Lucas Caldas` são
-- `fonte = 'omie'`. Apagar a linha dele de `remuneracao_pessoa_alias` e rodar
-- `remuneracao_atualizar()` recria a ficha e devolve os títulos a ela.

do $$
declare
  v_mantem  uuid;
  v_absorve uuid;
begin
  select id into v_mantem  from public.remuneracao_pessoa where nome = 'Lucas Henrique Caldas';
  select id into v_absorve from public.remuneracao_pessoa where nome = 'Lucas Caldas';
  if v_mantem is null or v_absorve is null then
    raise exception 'Fusão Lucas: uma das fichas não existe mais (mantem=%, absorve=%)',
      v_mantem, v_absorve;
  end if;
  perform public.remuneracao_fundir(v_mantem, v_absorve, 'manual');
end $$;

-- ── A CONFERÊNCIA ────────────────────────────────────────────────────────
--
-- Nada pode ter sumido: a fusão MOVE lançamento, nunca apaga. Se o total mudar,
-- é porque `remuneracao_fundir` descartou uma linha por colisão de
-- `(fonte, origem_ref)` — o que só aconteceria se as duas fichas tivessem o
-- mesmo título, e aí a fusão estaria consertando uma dobra em vez de uma
-- partição. Nos dois casos quero saber.

do $$
declare
  v_lanc  integer;
  v_total numeric;
begin
  select count(*), sum(valor) into v_lanc, v_total from public.remuneracao_lancamento;
  if v_lanc <> 3911 or round(v_total, 2) <> 10833672.73 then
    raise exception 'Fusão mexeu no dinheiro: % lançamentos somando R$ % (esperado 3.911 e R$ 10.833.672,73)',
      v_lanc, round(v_total, 2);
  end if;
end $$;

-- E as quatro fichas absorvidas não podem ter voltado.
do $$
declare v_sobrou text;
begin
  select string_agg(nome, ', ') into v_sobrou
    from public.remuneracao_pessoa
   where nome in ('Caio Augusto Marinho Caiado',
                  '59.437.526 CLAYDERMAN THOMAS FERREIRA DA SILVA',
                  '61.107.569 RENATA RUAS PESSOA',
                  'Lucas Caldas');
  if v_sobrou is not null then
    raise exception 'Fichas que deveriam ter sido absorvidas ainda existem: %', v_sobrou;
  end if;
end $$;
