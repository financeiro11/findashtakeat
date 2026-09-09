-- A remuneração ganha o histórico do Conta Azul: dez/2025, jan/2026 e fev/2026.
--
-- O painel nasceu com a janela do `omie_cache` — mar/2026 em diante — e a
-- migration que o criou já dizia de onde viria o resto: "o histórico vai ter
-- TRÊS fontes: o Omie (abr/2026 em diante), o export do Conta Azul (mar/2025 a
-- mar/2026) e as NFs do Drive". Esta é a segunda. Entram 465 pagamentos de 107
-- pessoas, três competências novas coladas na ponta esquerda da série.
--
-- Origem: três exports de contas a pagar do Conta Azul, um por mês de
-- VENCIMENTO — CAP_9 (pagos em janeiro), CAP_10 (fevereiro) e CAP_11 (março).
--
-- ── A COMPETÊNCIA É O VENCIMENTO MENOS UM MÊS ──────────────────────────────
--
-- O export tem uma coluna "Data de competência", e ela NÃO serve como está: em
-- CAP_9 vale o dia do pagamento (todas as 134 linhas dizem janeiro), em CAP_10 e
-- CAP_11 vale o mês trabalhado. Aceitar a coluna empilharia DUAS folhas em
-- janeiro/2026 — 281 linhas e R$ 825 mil, contra ~182 linhas e ~R$ 575 mil dos
-- meses vizinhos.
--
-- A regra usada é a mesma que o Omie descreve: o fixo vence no dia 5–7 e a
-- premiação no dia 13–16, ambos do mês SEGUINTE ao trabalhado. Ela reproduz o
-- rótulo do contador em 329 das 331 linhas em que ele rotulou o mês trabalhado,
-- e conserta as 134 em que ele rotulou o caixa.
--
-- A PROVA está na DRE, que é o teste que a carga do Omie também usa. Somando
-- "Premiações" + "Premiações Operacionais" do blob `dre/completo`:
--
--     Jan-26   71.988 + 9.872  = 81.860   ← esta carga: R$ 81.860,29
--     Fev-26   99.750 + 17.008 = 116.758  ← esta carga: R$ 116.758,35
--
-- Dois meses ao centavo. É a mesma âncora do `dDtRegistro`, vista do outro lado.
--
-- ── DEZEMBRO/2025 É PARCIAL, DE PROPÓSITO ─────────────────────────────────
--
-- Dezembro só tem o que foi pago em JANEIRO (a folha do dia 7 e a premiação do
-- dia 15). O que a empresa pagou dentro de dezembro está no export de dezembro,
-- que não veio. A DRE mostra o tamanho do buraco: R$ 64.029 de premiação em
-- Dec-25 contra os R$ 51.719 daqui. Fica assim porque o pedaço que existe é a
-- folha inteira de 77 pessoas — jogar fora seria perder mais do que se ganha —
-- e porque a tela já ignora o primeiro mês da série como origem de degrau de
-- reajuste, que é onde um mês parcial faria estrago.
--
-- ── NÃO HÁ SOBREPOSIÇÃO COM O OMIE ────────────────────────────────────────
--
-- O Conta Azul para em fev/2026 (a folha paga em março) e o Omie começa em
-- mar/2026 (a folha paga em abril). A série fica contínua e sem mês contado
-- duas vezes. E a poda de `remuneracao_carregar_omie()` filtra por
-- `fonte = 'omie'`, então a carga diária não encosta nestas linhas.
--
-- ── QUEM RECEBEU ──────────────────────────────────────────────────────────
--
-- A coluna "Nome do fornecedor" vem vazia em 26.478 das 26.480 linhas: o nome
-- da pessoa mora no meio da descrição do extrato ("PIX EMITIDO OUTRA IF rem
-- pedro afonso comercial"). São apelidos curtos, e o mesmo primeiro nome cobre
-- gente diferente — há três Brunos, dois Andrés, duas Julias, três Amandas.
-- O de-para foi feito a mão, com a ÁREA saindo da categoria contábil (a mesma
-- régua da `vw_remuneracao_omie`) e, quando a descrição traz o CNPJ, o
-- documento decidindo por cima do apelido.
--
-- As 13 pessoas do primeiro bloco não estão no cadastro porque saíram antes
-- de abril/2026 e o Portal RH só guarda quem ficou. O nome curto é o que existe:
-- inventar sobrenome seria pior. `remuneracao_pessoa` é superconjunto de
-- propósito — sem elas, R$ 60 mil sumiriam da soma sem deixar rastro.

/* ------------------------------------------------------------------ */
/* 1. Quem só o Conta Azul conhece                                     */
/* ------------------------------------------------------------------ */

insert into public.remuneracao_pessoa (nome, chave, doc, observacao)
select v.nome, public.contraparte_chave(v.nome), v.doc, v.obs
  from (values
    ('Amanda (Marketing)', '37792879000161', 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Amanda (RH)', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Ana Milla', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Franco (Onboarding)', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Gabriel Kirmse', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Geórgia (Eventos)', '47451656000194', 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('João Vitor (Comercial)', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('João Seidler', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Márcia Fernandes', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Nathalia Bernardino', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Orara (Comercial)', '64568347000118', 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Pedro Afonso', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.'),
    ('Yuri (Suporte)', null, 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto.')
  ) as v(nome, doc, obs)
 where public.remuneracao_pessoa_por_chave(public.contraparte_chave(v.nome)) is null
on conflict (chave) do nothing;

/* ------------------------------------------------------------------ */
/* 2. Os 465 pagamentos                                                */
/* ------------------------------------------------------------------ */

-- `origem_ref` = data de vencimento + hash de (vencimento, categoria,
-- descrição, valor). O export não tem identificador de linha, e o número da
-- linha no arquivo mudaria a cada re-exportação — o hash sobrevive a isso, que
-- é o que faz `on conflict (fonte, origem_ref)` valer alguma coisa.
create temporary table _remuneracao_ca (
  pessoa      text not null,
  competencia date not null,
  bloco       text not null,
  valor       numeric(14,2) not null,
  origem_ref  text not null,
  categoria   text not null,
  vencimento  date not null,
  pagamento   date
) on commit drop;

insert into _remuneracao_ca (pessoa, competencia, bloco, valor, origem_ref, categoria, vencimento, pagamento) values
  ('JORGE DE MELLO E MOURA NETO', '2025-12-01', 'fixo', 217.80, '2026-01-05-2da5eaa65d1e', '3.2.7.2. Pessoal - Suporte', '2026-01-05', '2026-01-05'),
  ('Pedro Afonso', '2025-12-01', 'fixo', 2400.00, '2026-01-06-563733587103', '3.1.1.2. Pessoal - Comercial', '2026-01-06', '2026-01-06'),
  ('Miguel Carvalho', '2025-12-01', 'prolabore', 1351.02, '2026-01-07-d5024b40b76e', '3.1.1.10 Pro Labore', '2026-01-07', '2026-01-07'),
  ('Luiz Paulo', '2025-12-01', 'fixo', 13000.00, '2026-01-07-258edc574b7c', '3.2.22 Diretores - Administrativo', '2026-01-07', '2026-01-07'),
  ('Pedro Mastelo Faro', '2025-12-01', 'fixo', 12000.00, '2026-01-07-ab7f7505598f', '3.2.22 Diretores - Administrativo', '2026-01-07', '2026-01-07'),
  ('Matheus Lenke Coutinho', '2025-12-01', 'fixo', 10000.00, '2026-01-07-ed56573dd3d1', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('André Luis Rocon', '2025-12-01', 'fixo', 2400.00, '2026-01-07-002760fe04f0', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Nuno Takeat', '2025-12-01', 'fixo', 2400.00, '2026-01-07-387e2d294698', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Stheferson Ewald Cereja', '2025-12-01', 'fixo', 8000.00, '2026-01-07-141e44f2fbcd', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Victor Brittes Oliveira', '2025-12-01', 'fixo', 9000.00, '2026-01-07-e1dfb2ca5e26', '3.2.22 Diretores - Administrativo', '2026-01-07', '2026-01-07'),
  ('David Moulin Avanci', '2025-12-01', 'fixo', 7000.00, '2026-01-07-4a72bedd5bcb', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Leonardo Dias Bussular', '2025-12-01', 'fixo', 6750.00, '2026-01-07-9b2117569386', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Lucas Segatto Soares', '2025-12-01', 'fixo', 6000.00, '2026-01-07-ed5e933d7d1e', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Henrique dos Anjos Moura', '2025-12-01', 'fixo', 3400.00, '2026-01-07-7eaad6ec50a2', '3.1.1.1. Pessoal - Administrativo', '2026-01-07', '2026-01-07'),
  ('Nicolas de Morais Tapias', '2025-12-01', 'fixo', 4500.00, '2026-01-07-a4b552b34a70', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Bruno de Souza Bartz', '2025-12-01', 'fixo', 5000.00, '2026-01-07-e6abefb3b67b', '3.1.1.3. Pessoal - Marketing', '2026-01-07', '2026-01-07'),
  ('Gabriela Fabian Pires Costa', '2025-12-01', 'fixo', 4500.00, '2026-01-07-9c1436f6cb95', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Felipe DE Aquino Fernandes', '2025-12-01', 'fixo', 5500.00, '2026-01-07-fd63fd900e89', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Sânzio Caldeira dos Santos Júnior', '2025-12-01', 'fixo', 2200.00, '2026-01-07-bbcc00112215', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('João Lucas Wells', '2025-12-01', 'fixo', 2600.00, '2026-01-07-88774463917c', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Bruno Araújo Martins Barroso', '2025-12-01', 'fixo', 3700.00, '2026-01-07-f0f3b259b136', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Thayrone Silva Cazeca', '2025-12-01', 'fixo', 2600.00, '2026-01-07-4bc2ab8c8c9d', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Franco (Onboarding)', '2025-12-01', 'fixo', 3000.00, '2026-01-07-55c8e190933b', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Gabriel Amaral Oliveira', '2025-12-01', 'fixo', 2400.00, '2026-01-07-aca18c4105fe', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Yuri (Suporte)', '2025-12-01', 'fixo', 1987.10, '2026-01-07-2fcf0dc087a2', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Etyene Nawar de Jesus', '2025-12-01', 'fixo', 2600.00, '2026-01-07-ffa43c559900', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Gabriel DE Oliveira Souza', '2025-12-01', 'fixo', 2200.00, '2026-01-07-71783678f86c', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Andrill Amorim Vitti', '2025-12-01', 'fixo', 2650.00, '2026-01-07-0d93c2ea162e', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Luiz Medeiros', '2025-12-01', 'fixo', 2245.16, '2026-01-07-586337648539', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Ingra Pifano', '2025-12-01', 'fixo', 2400.00, '2026-01-07-6f81d9158336', '3.1.1.10 Pessoal - Novos Canais', '2026-01-07', '2026-01-07'),
  ('Rafael Henrique Zambon Alves', '2025-12-01', 'fixo', 2600.00, '2026-01-07-48d0a9ea9a08', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('JOYCE LEMOS LYRIO', '2025-12-01', 'fixo', 2400.00, '2026-01-07-4654d798ec4f', '3.2.7.3. Pessoal - Sucesso', '2026-01-07', '2026-01-07'),
  ('Pedro Henrique DE Freitas Tessniari', '2025-12-01', 'fixo', 2400.00, '2026-01-07-6255f1b12c5b', '3.1.1.3. Pessoal - Marketing', '2026-01-07', '2026-01-07'),
  ('Clayderman Thomas Ferreira Da Silva', '2025-12-01', 'fixo', 4000.00, '2026-01-07-ab5510431892', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Thyago Juliano de Souza Calmon', '2025-12-01', 'fixo', 2600.00, '2026-01-07-f63ef427e794', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Amanda (RH)', '2025-12-01', 'fixo', 4200.00, '2026-01-07-297aab638232', '3.1.1.1. Pessoal - Administrativo', '2026-01-07', '2026-01-07'),
  ('João Vitor da Silva Fernandes m', '2025-12-01', 'fixo', 2200.00, '2026-01-07-681d40a357cb', '3.2.7.3. Pessoal - Sucesso', '2026-01-07', '2026-01-07'),
  ('Vitor Manoel Batista Miguel', '2025-12-01', 'fixo', 2200.00, '2026-01-07-e87e4fc02dab', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Jonas Fraga Loureiro', '2025-12-01', 'fixo', 5750.00, '2026-01-07-4307f353bb4d', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Erick Cola Rodrigues Da Silva', '2025-12-01', 'fixo', 3250.00, '2026-01-07-f5f660c4edb9', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('André Neves Alves', '2025-12-01', 'fixo', 3000.00, '2026-01-07-83beee40ef55', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Leonardo Carvalho E Moura', '2025-12-01', 'fixo', 2400.00, '2026-01-07-ffd01b1a7e39', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Ana Milla', '2025-12-01', 'fixo', 2600.00, '2026-01-07-c12209e4ef77', '3.2.7.3. Pessoal - Sucesso', '2026-01-07', '2026-01-07'),
  ('Tarcisio Antônio de Lima', '2025-12-01', 'fixo', 2400.00, '2026-01-07-3b75d06e7437', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Arthur Souza Gothe', '2025-12-01', 'fixo', 2600.00, '2026-01-07-bd1d11c28481', '3.1.1.14 Pessoal - Automações', '2026-01-07', '2026-01-07'),
  ('Arthur Evangelista Oliveira', '2025-12-01', 'fixo', 2200.00, '2026-01-07-3c544006af45', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Dianne Oliveira Guerson', '2025-12-01', 'fixo', 4500.00, '2026-01-07-62c3ed5e5bd6', '3.1.1.3. Pessoal - Marketing', '2026-01-07', '2026-01-07'),
  ('FERNANDO LEÃO GABEIRA', '2025-12-01', 'fixo', 2200.00, '2026-01-07-1aa362a78dd4', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Nícolas Zacché Assunção Aguiar', '2025-12-01', 'fixo', 2200.00, '2026-01-07-4241a617e4c8', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Thais Cristina Rosa de Lima', '2025-12-01', 'fixo', 5000.00, '2026-01-07-109376a6eebc', '3.1.1.10 Pessoal - Novos Canais', '2026-01-07', '2026-01-07'),
  ('Iranildo Bastos', '2025-12-01', 'fixo', 2400.00, '2026-01-07-10225f9d95c9', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Marcelo Amon dos Santos de Oliveira', '2025-12-01', 'fixo', 2600.00, '2026-01-07-e300fe5862a0', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Laura Romaneli dos Anjos', '2025-12-01', 'fixo', 1000.00, '2026-01-07-89baa03dff76', '3.1.1.3. Pessoal - Marketing', '2026-01-07', '2026-01-07'),
  ('SAMUEL GAMA ROELA', '2025-12-01', 'fixo', 1000.00, '2026-01-07-a31564db853f', '3.1.1.3. Pessoal - Marketing', '2026-01-07', '2026-01-07'),
  ('Talles Martins Pereira', '2025-12-01', 'fixo', 1500.00, '2026-01-07-e9e5ed46b541', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Israel Carré Leitão', '2025-12-01', 'fixo', 2600.00, '2026-01-07-e516e24d073e', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Joao Pedro Mendes Lauer', '2025-12-01', 'fixo', 2400.00, '2026-01-07-da22989566e6', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Carla Regina Anunciação da Silva Nascimento', '2025-12-01', 'fixo', 3400.00, '2026-01-07-1b81fa095331', '3.1.1.3. Pessoal - Marketing', '2026-01-07', '2026-01-07'),
  ('Luiza Freitas Pinheiro', '2025-12-01', 'fixo', 3400.00, '2026-01-07-21f25032beb5', '3.1.1.3. Pessoal - Marketing', '2026-01-07', '2026-01-07'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2025-12-01', 'fixo', 2600.00, '2026-01-07-633eb231b926', '3.2.7.2. Pessoal - Suporte', '2026-01-07', '2026-01-07'),
  ('Lucas Henrique Caldas', '2025-12-01', 'fixo', 2800.00, '2026-01-07-535ccb1614b6', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Vitor Coelho', '2025-12-01', 'fixo', 2400.00, '2026-01-07-5f6b1ed24214', '3.2.7.3. Pessoal - Sucesso', '2026-01-07', '2026-01-07'),
  ('Karolyne de Oliveira Araujo', '2025-12-01', 'fixo', 2800.00, '2026-01-07-289f60ee7bd8', '3.2.7.3. Pessoal - Sucesso', '2026-01-07', '2026-01-07'),
  ('Sara da Silva Pereira', '2025-12-01', 'fixo', 3000.00, '2026-01-07-a6dc31fc76ae', '3.2.7.3. Pessoal - Sucesso', '2026-01-07', '2026-01-07'),
  ('Maria Fernandes Araujo', '2025-12-01', 'fixo', 1500.00, '2026-01-07-f6a6abcb6363', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Vinicius Moraes Buteri', '2025-12-01', 'fixo', 8000.00, '2026-01-07-fac0feca1e70', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('JULYAN BOURGUIGNON RIBEIRO', '2025-12-01', 'fixo', 3700.00, '2026-01-07-829c7ed0ca96', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Alan de andrade ladeira', '2025-12-01', 'fixo', 6750.00, '2026-01-07-76d7c227041b', '3.1.1.4. Pessoal - Tecnologia', '2026-01-07', '2026-01-07'),
  ('Nicolas Silva Rodrigues Neves', '2025-12-01', 'fixo', 2650.00, '2026-01-07-5051b2caadc3', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Guilherme Zonta Guimarães Christ', '2025-12-01', 'fixo', 2200.00, '2026-01-07-6df284c2be0c', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Giovanni Ferreira Conti', '2025-12-01', 'fixo', 12000.00, '2026-01-07-e5d655365d8c', '3.2.7.1. Pessoal - Onboarding', '2026-01-07', '2026-01-07'),
  ('Joao Pedro Mendes Lauer', '2025-12-01', 'fixo', 2400.00, '2026-01-07-4753210f2320', '3.1.1.2. Pessoal - Comercial', '2026-01-07', '2026-01-07'),
  ('Júlia Paulino Rocon', '2025-12-01', 'fixo', 1000.00, '2026-01-07-e92be2fe5529', '3.1.1.1. Pessoal - Administrativo', '2026-01-07', '2026-01-07'),
  ('Levi Monteiro Silva', '2025-12-01', 'fixo', 2600.00, '2026-01-08-90053aef06d2', '3.2.7.1. Pessoal - Onboarding', '2026-01-08', '2026-01-08'),
  ('Marco Antonio Pereira de Almeida Filho', '2025-12-01', 'fixo', 2864.52, '2026-01-13-46a375fd62aa', '3.1.1.2. Pessoal - Comercial', '2026-01-13', '2026-01-13'),
  ('Thiago Miguel da Silva', '2025-12-01', 'fixo', 4000.00, '2026-01-13-286b50388db5', '3.1.1.2. Pessoal - Comercial', '2026-01-13', '2026-01-13'),
  ('Miguel Carvalho', '2025-12-01', 'fixo', 16000.00, '2026-01-13-17effbfd81b2', '3.2.22 Diretores - Administrativo', '2026-01-13', '2026-01-13'),
  ('Thyago Juliano de Souza Calmon', '2025-12-01', 'premiacao', 3120.00, '2026-01-15-760dd99f48ee', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('João Seidler', '2025-12-01', 'premiacao', 500.00, '2026-01-15-d5fa0573bf11', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('FERNANDO LEÃO GABEIRA', '2025-12-01', 'premiacao', 462.00, '2026-01-15-c55f254d0401', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('João Lucas Wells', '2025-12-01', 'premiacao', 910.00, '2026-01-15-7b9cf4b3f15b', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Pedro Afonso', '2025-12-01', 'fixo', 2864.52, '2026-01-15-905d9b5f0a34', '3.1.1.2. Pessoal - Comercial', '2026-01-15', '2026-01-15'),
  ('André Neves Alves', '2025-12-01', 'premiacao', 1260.00, '2026-01-15-23cf0e4d155d', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('André Neves Alves', '2025-12-01', 'escala', 385.00, '2026-01-15-363721b0cb8f', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Andrill Amorim Vitti', '2025-12-01', 'premiacao', 3180.00, '2026-01-15-ed10affebf3e', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('André Luis Rocon', '2025-12-01', 'premiacao', 986.00, '2026-01-15-9384fa9e6efc', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Lucas Henrique Caldas', '2025-12-01', 'premiacao', 2582.50, '2026-01-15-1f656ab60837', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Ingra Pifano', '2025-12-01', 'premiacao', 840.00, '2026-01-15-fbc0ef5d69a6', '3.1.1.15 Premiação - Novos Canais', '2026-01-15', '2026-01-15'),
  ('FERNANDO LEÃO GABEIRA', '2025-12-01', 'escala', 210.00, '2026-01-15-7e5dc3915d6e', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Luiza Freitas Pinheiro', '2025-12-01', 'premiacao', 1315.80, '2026-01-15-23d27f40f184', '3.1.1.8 Premiação - Marketing', '2026-01-15', '2026-01-15'),
  ('Yuri (Suporte)', '2025-12-01', 'premiacao', 462.00, '2026-01-15-693fb85dc958', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('Franco (Onboarding)', '2025-12-01', 'premiacao', 2100.00, '2026-01-15-4c6f519e2093', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Tarcisio Antônio de Lima', '2025-12-01', 'premiacao', 840.00, '2026-01-15-b785fc10facf', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Tarcisio Antônio de Lima', '2025-12-01', 'premiacao', 700.00, '2026-01-15-34f7457410a8', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Joao Pedro Mendes Lauer', '2025-12-01', 'premiacao', 500.00, '2026-01-15-f199bd185a25', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Israel Carré Leitão', '2025-12-01', 'premiacao', 2835.00, '2026-01-15-fdf9ece12ba1', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Bruno de Souza Bartz', '2025-12-01', 'premiacao', 1000.00, '2026-01-15-21855322239d', '3.1.1.8 Premiação - Marketing', '2026-01-15', '2026-01-15'),
  ('Erick Cola Rodrigues Da Silva', '2025-12-01', 'escala', 350.00, '2026-01-15-af82c45ca0d4', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Erick Cola Rodrigues Da Silva', '2025-12-01', 'premiacao', 682.50, '2026-01-15-44b356304d30', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('Thayrone Silva Cazeca', '2025-12-01', 'premiacao', 3670.00, '2026-01-15-47d217f4cfb9', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Dianne Oliveira Guerson', '2025-12-01', 'premiacao', 1161.00, '2026-01-15-fe94bd628d9b', '3.1.1.8 Premiação - Marketing', '2026-01-15', '2026-01-15'),
  ('Bruno Araújo Martins Barroso', '2025-12-01', 'premiacao', 1000.00, '2026-01-15-7f169b7ff435', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Carla Regina Anunciação da Silva Nascimento', '2025-12-01', 'premiacao', 1315.80, '2026-01-15-4c310a7cba36', '3.1.1.8 Premiação - Marketing', '2026-01-15', '2026-01-15'),
  ('Pedro Henrique DE Freitas Tessniari', '2025-12-01', 'premiacao', 688.80, '2026-01-15-812de5c3b2cf', '3.1.1.8 Premiação - Marketing', '2026-01-15', '2026-01-15'),
  ('Marco Antonio Pereira de Almeida Filho', '2025-12-01', 'premiacao', 1000.00, '2026-01-15-6655b5ed0137', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('JULYAN BOURGUIGNON RIBEIRO', '2025-12-01', 'premiacao', 1500.00, '2026-01-15-15ac25d0191d', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Thiago Miguel da Silva', '2025-12-01', 'premiacao', 500.00, '2026-01-15-3497a227a0e6', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Lucas Segatto Soares', '2025-12-01', 'premiacao', 2440.00, '2026-01-15-6210a337c6e1', '3.1.1.5. Premiação - Comercial', '2026-01-15', '2026-01-15'),
  ('Guilherme Zonta Guimarães Christ', '2025-12-01', 'premiacao', 2200.00, '2026-01-15-9a6e9b576dca', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Nicolas Silva Rodrigues Neves', '2025-12-01', 'premiacao', 1855.00, '2026-01-15-b5951af04586', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Levi Monteiro Silva', '2025-12-01', 'escala', 140.00, '2026-01-15-ac1383297bd1', '3.2.7.5. Escala - Onboarding', '2026-01-15', '2026-01-15'),
  ('Levi Monteiro Silva', '2025-12-01', 'premiacao', 1820.00, '2026-01-15-2a671ec07cba', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Gabriel DE Oliveira Souza', '2025-12-01', 'premiacao', 1320.00, '2026-01-15-396f48347fea', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Sânzio Caldeira dos Santos Júnior', '2025-12-01', 'premiacao', 150.00, '2026-01-15-ad2010429065', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Sânzio Caldeira dos Santos Júnior', '2025-12-01', 'premiacao', 770.00, '2026-01-15-ac2083f7e287', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Iranildo Bastos', '2025-12-01', 'premiacao', 1680.00, '2026-01-15-0babe5064f93', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Vitor Manoel Batista Miguel', '2025-12-01', 'premiacao', 125.00, '2026-01-15-92987eed15fd', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Vitor Manoel Batista Miguel', '2025-12-01', 'premiacao', 770.00, '2026-01-15-0b63efc932ac', '3.1.1.6. Premiação - Onboarding', '2026-01-15', '2026-01-15'),
  ('Arthur Evangelista Oliveira', '2025-12-01', 'escala', 210.00, '2026-01-15-89782b35cd4c', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Nuno Takeat', '2025-12-01', 'escala', 140.00, '2026-01-15-a9542954a217', '3.2.7.5. Escala - Onboarding', '2026-01-15', '2026-01-15'),
  ('Nícolas Zacché Assunção Aguiar', '2025-12-01', 'premiacao', 462.00, '2026-01-15-335aaf000dbc', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('Leonardo Carvalho E Moura', '2025-12-01', 'premiacao', 504.00, '2026-01-15-046fd16564d0', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('Yuri (Suporte)', '2025-12-01', 'escala', 140.00, '2026-01-15-937d29371f6e', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Nícolas Zacché Assunção Aguiar', '2025-12-01', 'escala', 560.00, '2026-01-15-b024de3aa0f9', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Yuri (Suporte)', '2025-12-01', 'fixo', 183.33, '2026-01-15-316e4b3c788a', '3.2.7.2. Pessoal - Suporte', '2026-01-15', '2026-01-15'),
  ('Arthur Evangelista Oliveira', '2025-12-01', 'premiacao', 462.00, '2026-01-15-bbb9ac3fb9fc', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('Leonardo Carvalho E Moura', '2025-12-01', 'escala', 420.00, '2026-01-15-bf1f455a04b0', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Gabriel Amaral Oliveira', '2025-12-01', 'premiacao', 504.00, '2026-01-15-757d6488acdd', '3.1.1.10 Premiação - Suporte', '2026-01-15', '2026-01-15'),
  ('Gabriel Amaral Oliveira', '2025-12-01', 'escala', 1820.00, '2026-01-15-b03a75f787ed', '3.2.7.4 .Escala - Suporte', '2026-01-15', '2026-01-15'),
  ('Luiz Medeiros', '2025-12-01', 'escala', 140.00, '2026-01-16-c04429d63e64', '3.2.7.5. Escala - Onboarding', '2026-01-16', '2026-01-16'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2025-12-01', 'escala', 315.00, '2026-01-16-1bccab8d1da0', '3.2.7.4 .Escala - Suporte', '2026-01-16', '2026-01-16'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2025-12-01', 'premiacao', 546.00, '2026-01-16-798abb0fbe77', '3.1.1.10 Premiação - Suporte', '2026-01-16', '2026-01-16'),
  ('Luiza Dallapicola Maioli da Silva Sodré', '2025-12-01', 'premiacao', 1000.00, '2026-01-27-b87328651ffd', '3.1.1.5. Premiação - Comercial', '2026-01-27', '2026-01-27'),
  ('Luiza Dallapicola Maioli da Silva Sodré', '2025-12-01', 'fixo', 3840.00, '2026-01-28-456b69dfb1b2', '3.1.1.2. Pessoal - Comercial', '2026-01-28', '2026-01-28'),
  ('Victor Brittes Oliveira', '2026-01-01', 'fixo', 13000.00, '2026-02-06-1aa5597f05dd', '3.2.22 Diretores - Administrativo', '2026-02-06', '2026-02-06'),
  ('Luiz Paulo', '2026-01-01', 'fixo', 20000.00, '2026-02-06-7474be7f7a96', '3.2.22 Diretores - Administrativo', '2026-02-06', '2026-02-06'),
  ('Miguel Carvalho', '2026-01-01', 'prolabore', 2918.31, '2026-02-06-0f3c10910bc1', '3.1.1.10 Pro Labore', '2026-02-06', '2026-02-06'),
  ('Miguel Carvalho', '2026-01-01', 'prolabore', 1442.69, '2026-02-06-80e19eb0b4ed', '3.1.1.10 Pro Labore', '2026-02-06', '2026-02-06'),
  ('SAMUEL GAMA ROELA', '2026-01-01', 'fixo', 1000.00, '2026-02-06-a7baf562074d', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Laura Romaneli dos Anjos', '2026-01-01', 'fixo', 1000.00, '2026-02-06-742c1196b39d', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Nicolas Silva Rodrigues Neves', '2026-01-01', 'fixo', 50.00, '2026-02-06-64ff6be500d2', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Franco (Onboarding)', '2026-01-01', 'fixo', 7016.13, '2026-02-06-e433975b1b67', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Stheferson Ewald Cereja', '2026-01-01', 'fixo', 8000.00, '2026-02-06-aaf41da332c3', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('David Moulin Avanci', '2026-01-01', 'fixo', 9000.00, '2026-02-06-2e7918003770', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Leonardo Dias Bussular', '2026-01-01', 'fixo', 9000.00, '2026-02-06-6a0f01dce4d5', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('André Neves Alves', '2026-01-01', 'fixo', 3000.00, '2026-02-06-aca8fdb61789', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Felipe DE Aquino Fernandes', '2026-01-01', 'fixo', 6750.00, '2026-02-06-5f841d65bb5a', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Israel Carré Leitão', '2026-01-01', 'fixo', 3000.00, '2026-02-06-b9e72ea8b0a4', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Etyene Nawar de Jesus', '2026-01-01', 'fixo', 2600.00, '2026-02-06-3b33670422af', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Luiza Freitas Pinheiro', '2026-01-01', 'fixo', 1000.00, '2026-02-06-dccb667d11c6', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Ingra Pifano', '2026-01-01', 'fixo', 2400.00, '2026-02-06-680be096c48e', '3.1.1.10 Pessoal - Novos Canais', '2026-02-06', '2026-02-06'),
  ('Lucas Segatto Soares', '2026-01-01', 'fixo', 6000.00, '2026-02-06-9fb46c85daa0', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Erick Cola Rodrigues Da Silva', '2026-01-01', 'fixo', 4000.00, '2026-02-06-e852c509bb8d', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('André Luis Rocon', '2026-01-01', 'fixo', 2550.00, '2026-02-06-574793101fde', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('João Vitor da Silva Fernandes m', '2026-01-01', 'fixo', 2400.00, '2026-02-06-a60f676a2e0f', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('Lucas Henrique Caldas', '2026-01-01', 'fixo', 3000.00, '2026-02-06-9d59c5a15d02', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Júlia Paulino Rocon', '2026-01-01', 'fixo', 1000.00, '2026-02-06-393ae375e649', '3.1.1.1. Pessoal - Administrativo', '2026-02-06', '2026-02-06'),
  ('Orara (Comercial)', '2026-01-01', 'fixo', 2983.87, '2026-02-06-75f662aeb1e7', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Amanda Matos Pardim', '2026-01-01', 'fixo', 3222.58, '2026-02-06-822a529b6e41', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Igor Calmon Baptisti', '2026-01-01', 'fixo', 1916.13, '2026-02-06-c196fae91896', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Guilherme Diego Luz Ribeiro', '2026-01-01', 'fixo', 716.13, '2026-02-06-e87abf070ee1', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Thayrone Silva Cazeca', '2026-01-01', 'fixo', 3000.00, '2026-02-06-44f3f9d765ce', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Sara da Silva Pereira', '2026-01-01', 'fixo', 3000.00, '2026-02-06-9275b990fd0f', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('Michael Cardoso Thomé', '2026-01-01', 'fixo', 3629.03, '2026-02-06-f775807a686b', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Talles Martins Pereira', '2026-01-01', 'fixo', 4500.00, '2026-02-06-7de2271ba140', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Thais Cristina Rosa de Lima', '2026-01-01', 'fixo', 6000.00, '2026-02-06-01e70c326599', '3.1.1.10 Pessoal - Novos Canais', '2026-02-06', '2026-02-06'),
  ('Marcelo Amon dos Santos de Oliveira', '2026-01-01', 'fixo', 3000.00, '2026-02-06-c9e45c96d7f1', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Matheus Lenke Coutinho', '2026-01-01', 'fixo', 10000.00, '2026-02-06-49083e366c7a', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('JULYAN BOURGUIGNON RIBEIRO', '2026-01-01', 'fixo', 6000.00, '2026-02-06-22b658258e63', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Giovanni Ferreira Conti', '2026-01-01', 'fixo', 12000.00, '2026-02-06-bc45a8b92b90', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Dianne Oliveira Guerson', '2026-01-01', 'fixo', 4500.00, '2026-02-06-9f1309f6e00b', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Gabriela Fabian Pires Costa', '2026-01-01', 'fixo', 5000.00, '2026-02-06-3070491688ae', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Luiza Freitas Pinheiro', '2026-01-01', 'fixo', 4000.00, '2026-02-06-76179aa83549', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('João Vitor Clasen de Andrades', '2026-01-01', 'fixo', 1016.13, '2026-02-06-d8fedf06bd4a', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Henrique dos Anjos Moura', '2026-01-01', 'fixo', 5000.00, '2026-02-06-d0a3c4e3059d', '3.1.1.1. Pessoal - Administrativo', '2026-02-06', '2026-02-06'),
  ('Iranildo Bastos', '2026-01-01', 'fixo', 2600.00, '2026-02-06-79acd907c4f5', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Tomás Guillermo Ortúzar Barra', '2026-01-01', 'fixo', 1845.16, '2026-02-06-d018d887d151', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Maria Fernandes Araujo', '2026-01-01', 'fixo', 4250.00, '2026-02-06-72bf796c8a63', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Levi Monteiro Silva', '2026-01-01', 'fixo', 2600.00, '2026-02-06-42887c6df4d9', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Clayderman Thomas Ferreira Da Silva', '2026-01-01', 'fixo', 4000.00, '2026-02-06-92ed06f64404', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Carla Regina Anunciação da Silva Nascimento', '2026-01-01', 'fixo', 3400.00, '2026-02-06-2646ee6c7ddf', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('JORGE DE MELLO E MOURA NETO', '2026-01-01', 'fixo', 1916.13, '2026-02-06-2c4997bf519f', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Matheus Martins Penna Moraes', '2026-01-01', 'fixo', 1548.39, '2026-02-06-66bf06fe66dd', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Bruno de Souza Bartz', '2026-01-01', 'fixo', 6000.00, '2026-02-06-6f85d40ac3b9', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Nicolas de Morais Tapias', '2026-01-01', 'fixo', 4500.00, '2026-02-06-2b03faa1195a', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Amanda (Marketing)', '2026-01-01', 'fixo', 1935.48, '2026-02-06-6c5c670fe143', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Jonas Fraga Loureiro', '2026-01-01', 'fixo', 5750.00, '2026-02-06-ac2c5260e580', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Marco Antonio Pereira de Almeida Filho', '2026-01-01', 'fixo', 3700.00, '2026-02-06-ddb28fc6da51', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('ANA CLARA ROSSI MONGIN', '2026-01-01', 'fixo', 4193.50, '2026-02-06-108857740410', '3.1.1.1. Pessoal - Administrativo', '2026-02-06', '2026-02-06'),
  ('Amanda (RH)', '2026-01-01', 'fixo', 4200.00, '2026-02-06-1ea0670c12da', '3.1.1.1. Pessoal - Administrativo', '2026-02-06', '2026-02-06'),
  ('Alan de andrade ladeira', '2026-01-01', 'fixo', 8500.00, '2026-02-06-867834ab1f0d', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Bruno Araújo Martins Barroso', '2026-01-01', 'fixo', 3700.00, '2026-02-06-514db60ff2ec', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Thiago Miguel da Silva', '2026-01-01', 'fixo', 4000.00, '2026-02-06-dd24f186becf', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('João Lucas Wells', '2026-01-01', 'fixo', 4250.00, '2026-02-06-8e51b4dd1eb8', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Vinicius Moraes Buteri', '2026-01-01', 'fixo', 8000.00, '2026-02-06-6a017527ae2d', '3.1.1.4. Pessoal - Tecnologia', '2026-02-06', '2026-02-06'),
  ('Joao Pedro Mendes Lauer', '2026-01-01', 'fixo', 2500.00, '2026-02-06-f075b38ed604', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('FERNANDO LEÃO GABEIRA', '2026-01-01', 'fixo', 2400.00, '2026-02-06-6410d0e11034', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Tarcisio Antônio de Lima', '2026-01-01', 'fixo', 2600.00, '2026-02-06-c351a823b9bd', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Gabriel DE Oliveira Souza', '2026-01-01', 'fixo', 2200.00, '2026-02-06-e4612af1e322', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Luiza Dallapicola Maioli da Silva Sodré', '2026-01-01', 'fixo', 2500.00, '2026-02-06-1c1ec1db0cf6', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Ana Milla', '2026-01-01', 'fixo', 2600.00, '2026-02-06-31b84f0a2465', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('Vitor Manoel Batista Miguel', '2026-01-01', 'fixo', 2200.00, '2026-02-06-a85cc7593640', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Pedro Henrique DE Freitas Tessniari', '2026-01-01', 'fixo', 2400.00, '2026-02-06-9ebd4b6f8682', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Nícolas Zacché Assunção Aguiar', '2026-01-01', 'fixo', 2400.00, '2026-02-06-44b0d3923c94', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Andrill Amorim Vitti', '2026-01-01', 'fixo', 2650.00, '2026-02-06-a787f83bfb98', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Luiz Medeiros', '2026-01-01', 'fixo', 2400.00, '2026-02-06-a876083f1462', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('mauro sergio de andrade da silva', '2026-01-01', 'fixo', 1935.48, '2026-02-06-a5260f10c6f2', '3.1.1.3. Pessoal - Marketing', '2026-02-06', '2026-02-06'),
  ('Sandro Linhares de Brito', '2026-01-01', 'fixo', 1551.61, '2026-02-06-ae2a5d7d18f2', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Arthur Souza Gothe', '2026-01-01', 'fixo', 2600.00, '2026-02-06-49f820a3df31', '3.1.1.14 Pessoal - Automações', '2026-02-06', '2026-02-06'),
  ('JOYCE LEMOS LYRIO', '2026-01-01', 'fixo', 2400.00, '2026-02-06-15f072d14704', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('Nicolas Silva Rodrigues Neves', '2026-01-01', 'fixo', 2600.00, '2026-02-06-c37e6ed0d6d4', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Thyago Juliano de Souza Calmon', '2026-01-01', 'fixo', 2800.00, '2026-02-06-cde65ffb0a70', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('André Luis Rocon', '2026-01-01', 'fixo', 2500.00, '2026-02-06-60c00502c675', '3.1.1.2. Pessoal - Comercial', '2026-02-06', '2026-02-06'),
  ('Karolyne de Oliveira Araujo', '2026-01-01', 'fixo', 2800.00, '2026-02-06-4c3f7635ea6a', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('Rafael Henrique Zambon Alves', '2026-01-01', 'fixo', 2800.00, '2026-02-06-5c53d383c418', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('Gabriel Amaral Oliveira', '2026-01-01', 'fixo', 2600.00, '2026-02-06-52bc37131d05', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Arthur Evangelista Oliveira', '2026-01-01', 'fixo', 2400.00, '2026-02-06-c1482203d3c8', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Leonardo Carvalho E Moura', '2026-01-01', 'fixo', 2600.00, '2026-02-06-484b1c3f47f9', '3.2.7.2. Pessoal - Suporte', '2026-02-06', '2026-02-06'),
  ('Guilherme Zonta Guimarães Christ', '2026-01-01', 'fixo', 2600.00, '2026-02-06-f8b3b9509517', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Nuno Takeat', '2026-01-01', 'fixo', 2600.00, '2026-02-06-20e1bc8c93ad', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Vitor Coelho', '2026-01-01', 'fixo', 2600.00, '2026-02-06-e7933bb950ee', '3.2.7.3. Pessoal - Sucesso', '2026-02-06', '2026-02-06'),
  ('Sânzio Caldeira dos Santos Júnior', '2026-01-01', 'fixo', 2200.00, '2026-02-06-caa375d7966d', '3.2.7.1. Pessoal - Onboarding', '2026-02-06', '2026-02-06'),
  ('Pedro Mastelo Faro', '2026-01-01', 'fixo', 20000.00, '2026-02-06-e04beeca8535', '3.2.22 Diretores - Administrativo', '2026-02-06', '2026-02-06'),
  ('Miguel Carvalho', '2026-01-01', 'fixo', 20100.00, '2026-02-09-5b5a8ae19bd8', '3.2.22 Diretores - Administrativo', '2026-02-09', '2026-02-09'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2026-01-01', 'fixo', 2800.00, '2026-02-10-fe0200631beb', '3.2.7.2. Pessoal - Suporte', '2026-02-10', '2026-02-10'),
  ('Nícolas Zacché Assunção Aguiar', '2026-01-01', 'escala', 525.00, '2026-02-13-fc8775552a2a', '3.2.7.4 .Escala - Suporte', '2026-02-13', '2026-02-13'),
  ('Gabriel Amaral Oliveira', '2026-01-01', 'escala', 1190.00, '2026-02-13-a8a385995b59', '3.2.7.4 .Escala - Suporte', '2026-02-13', '2026-02-13'),
  ('Leonardo Carvalho E Moura', '2026-01-01', 'escala', 455.00, '2026-02-13-c1749bcde729', '3.2.7.4 .Escala - Suporte', '2026-02-13', '2026-02-13'),
  ('Erick Cola Rodrigues Da Silva', '2026-01-01', 'escala', 245.00, '2026-02-13-e3df74a3b8d4', '3.2.7.4 .Escala - Suporte', '2026-02-13', '2026-02-13'),
  ('Arthur Evangelista Oliveira', '2026-01-01', 'escala', 595.00, '2026-02-13-73f1a0c6a0df', '3.2.7.4 .Escala - Suporte', '2026-02-13', '2026-02-13'),
  ('Arthur Evangelista Oliveira', '2026-01-01', 'escala', 684.00, '2026-02-13-ffb0615af982', '3.2.7.4 .Escala - Suporte', '2026-02-13', '2026-02-13'),
  ('FERNANDO LEÃO GABEIRA', '2026-01-01', 'escala', 590.00, '2026-02-13-1ae59ec067cf', '3.2.7.4 .Escala - Suporte', '2026-02-13', '2026-02-13'),
  ('Etyene Nawar de Jesus', '2026-01-01', 'escala', 280.00, '2026-02-13-7f491929286f', '3.2.7.5. Escala - Onboarding', '2026-02-13', '2026-02-13'),
  ('Nicolas Silva Rodrigues Neves', '2026-01-01', 'escala', 140.00, '2026-02-13-abaa017c1aa9', '3.2.7.5. Escala - Onboarding', '2026-02-13', '2026-02-13'),
  ('Matheus Martins Penna Moraes', '2026-01-01', 'premiacao', 2000.00, '2026-02-13-c8c2b4e9df7d', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('Tarcisio Antônio de Lima', '2026-01-01', 'premiacao', 700.00, '2026-02-13-63c00185e1f5', '3.1.1.6. Premiação - Onboarding', '2026-02-13', '2026-02-13'),
  ('Bruno de Souza Bartz', '2026-01-01', 'premiacao', 3000.00, '2026-02-13-d01597770f59', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('Nuno Takeat', '2026-01-01', 'premiacao', 520.00, '2026-02-13-b824f4bf094c', '3.1.1.6. Premiação - Onboarding', '2026-02-13', '2026-02-13'),
  ('Thyago Juliano de Souza Calmon', '2026-01-01', 'premiacao', 280.00, '2026-02-13-2b6ec11157ab', '3.1.1.6. Premiação - Onboarding', '2026-02-13', '2026-02-13'),
  ('João Vitor (Comercial)', '2026-01-01', 'premiacao', 541.94, '2026-02-13-b78d7a009d8c', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Ingra Pifano', '2026-01-01', 'premiacao', 840.00, '2026-02-13-0d7b55771528', '3.1.1.15 Premiação - Novos Canais', '2026-02-13', '2026-02-13'),
  ('Orara (Comercial)', '2026-01-01', 'premiacao', 1000.00, '2026-02-13-a46857d02304', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Joao Pedro Mendes Lauer', '2026-01-01', 'premiacao', 2025.00, '2026-02-13-f86fea80733a', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Luiza Freitas Pinheiro', '2026-01-01', 'premiacao', 2500.00, '2026-02-13-8a9b19b1a57d', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('Thayrone Silva Cazeca', '2026-01-01', 'premiacao', 3890.00, '2026-02-13-57fe97fd1b16', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Sandro Linhares de Brito', '2026-01-01', 'premiacao', 419.35, '2026-02-13-f27a03e8516a', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Thais Cristina Rosa de Lima', '2026-01-01', 'premiacao', 1800.00, '2026-02-13-fd2d9e55d15a', '3.1.1.15 Premiação - Novos Canais', '2026-02-13', '2026-02-13'),
  ('Gabriel Amaral Oliveira', '2026-01-01', 'premiacao', 1300.00, '2026-02-13-c41dbd19af80', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('Thiago Miguel da Silva', '2026-01-01', 'premiacao', 1000.00, '2026-02-13-ef624dd539ec', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Lucas Segatto Soares', '2026-01-01', 'premiacao', 5625.00, '2026-02-13-a922f08396bf', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Michael Cardoso Thomé', '2026-01-01', 'premiacao', 1000.00, '2026-02-13-d216b2bf3c25', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Amanda Matos Pardim', '2026-01-01', 'premiacao', 1000.00, '2026-02-13-a8b9beb1d43c', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Luiza Dallapicola Maioli da Silva Sodré', '2026-01-01', 'premiacao', 3075.00, '2026-02-13-037975254284', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Bruno Araújo Martins Barroso', '2026-01-01', 'premiacao', 750.00, '2026-02-13-f6da97fcab8d', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Marco Antonio Pereira de Almeida Filho', '2026-01-01', 'premiacao', 4500.00, '2026-02-13-c03610285565', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Israel Carré Leitão', '2026-01-01', 'premiacao', 5530.00, '2026-02-13-ecdc7d0de129', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('JULYAN BOURGUIGNON RIBEIRO', '2026-01-01', 'premiacao', 4500.00, '2026-02-13-db4c406b35b7', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('Marcelo Amon dos Santos de Oliveira', '2026-01-01', 'premiacao', 4160.00, '2026-02-13-228d4c2b798a', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('JORGE DE MELLO E MOURA NETO', '2026-01-01', 'premiacao', 70.00, '2026-02-13-d0beba926e4e', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('Leonardo Carvalho E Moura', '2026-01-01', 'premiacao', 845.00, '2026-02-13-2aea14fd9482', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('JORGE DE MELLO E MOURA NETO', '2026-01-01', 'premiacao', 1012.00, '2026-02-13-2fcbaf1cc269', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('Lucas Henrique Caldas', '2026-01-01', 'premiacao', 9480.00, '2026-02-13-ecb16f59183a', '3.1.1.5. Premiação - Comercial', '2026-02-13', '2026-02-13'),
  ('FERNANDO LEÃO GABEIRA', '2026-01-01', 'premiacao', 960.00, '2026-02-13-3277fbb509f3', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('Nícolas Zacché Assunção Aguiar', '2026-01-01', 'premiacao', 960.00, '2026-02-13-09b545882369', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('Erick Cola Rodrigues Da Silva', '2026-01-01', 'premiacao', 1600.00, '2026-02-13-179ca692e40e', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('Thyago Juliano de Souza Calmon', '2026-01-01', 'premiacao', 1120.00, '2026-02-13-7436d760d9e9', '3.1.1.6. Premiação - Onboarding', '2026-02-13', '2026-02-13'),
  ('Igor Calmon Baptisti', '2026-01-01', 'premiacao', 715.00, '2026-02-13-971f55c4ae75', '3.1.1.10 Premiação - Suporte', '2026-02-13', '2026-02-13'),
  ('Pedro Henrique DE Freitas Tessniari', '2026-01-01', 'premiacao', 840.00, '2026-02-13-4953d60439db', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('Amanda (Marketing)', '2026-01-01', 'premiacao', 1500.00, '2026-02-13-c638eca1fdb4', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('mauro sergio de andrade da silva', '2026-01-01', 'premiacao', 1500.00, '2026-02-13-75f945b18f85', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('Dianne Oliveira Guerson', '2026-01-01', 'premiacao', 2475.00, '2026-02-13-55b17578b29e', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('Sânzio Caldeira dos Santos Júnior', '2026-01-01', 'premiacao', 75.00, '2026-02-13-08358c2314d5', '3.1.1.6. Premiação - Onboarding', '2026-02-13', '2026-02-13'),
  ('Guilherme Zonta Guimarães Christ', '2026-01-01', 'premiacao', 520.00, '2026-02-13-b41e54d17d56', '3.1.1.6. Premiação - Onboarding', '2026-02-13', '2026-02-13'),
  ('Carla Regina Anunciação da Silva Nascimento', '2026-01-01', 'premiacao', 1700.00, '2026-02-13-b0f5f0f5bff1', '3.1.1.8 Premiação - Marketing', '2026-02-13', '2026-02-13'),
  ('Andrill Amorim Vitti', '2026-01-01', 'premiacao', 1060.00, '2026-02-13-23dd8e3ee847', '3.1.1.6. Premiação - Onboarding', '2026-02-13', '2026-02-13'),
  ('André Neves Alves', '2026-01-01', 'escala', 735.00, '2026-02-19-a8bbe16f6237', '3.2.7.4 .Escala - Suporte', '2026-02-19', '2026-02-19'),
  ('André Neves Alves', '2026-01-01', 'premiacao', 1500.00, '2026-02-19-992c332f181f', '3.1.1.10 Premiação - Suporte', '2026-02-19', '2026-02-19'),
  ('Marcelo Amon dos Santos de Oliveira', '2026-01-01', 'premiacao', 499.00, '2026-02-20-6a2cc518a8c1', '3.1.1.5. Premiação - Comercial', '2026-02-20', '2026-02-20'),
  ('Lucas Henrique Caldas', '2026-01-01', 'premiacao', 488.00, '2026-02-20-83d11e55a540', '3.1.1.5. Premiação - Comercial', '2026-02-20', '2026-02-20'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2026-01-01', 'premiacao', 910.00, '2026-02-23-7fa6872e620a', '3.1.1.10 Premiação - Suporte', '2026-02-23', '2026-02-23'),
  ('Vitor Manoel Batista Miguel', '2026-01-01', 'premiacao', 75.00, '2026-02-26-1437c22fc6bd', '3.1.1.6. Premiação - Onboarding', '2026-02-26', '2026-02-26'),
  ('Amanda (Marketing)', '2026-02-01', 'fixo', 1258.06, '2026-03-04-d1aa58a1dc5a', '3.1.1.3. Pessoal - Marketing', '2026-03-04', '2026-03-04'),
  ('Amanda (Marketing)', '2026-02-01', 'premiacao', 1350.00, '2026-03-04-11fefb451635', '3.1.1.8 Premiação - Marketing', '2026-03-04', '2026-03-04'),
  ('Amanda (Marketing)', '2026-02-01', 'fixo', 3000.00, '2026-03-04-e64a94ff36f8', '3.1.1.3. Pessoal - Marketing', '2026-03-04', '2026-03-04'),
  ('ADA LAURO COSTA DA SILVA', '2026-02-01', 'fixo', 857.14, '2026-03-06-45ff7850acb5', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Alan de andrade ladeira', '2026-02-01', 'fixo', 8500.00, '2026-03-06-b701237fc48a', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('André Luis Rocon', '2026-02-01', 'fixo', 2500.00, '2026-03-06-597373d9d765', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Amanda Matos Pardim', '2026-02-01', 'fixo', 3700.00, '2026-03-06-8a6c4e3533ac', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('André Neves Alves', '2026-02-01', 'fixo', 3000.00, '2026-03-06-1cda8872b0aa', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Andrill Amorim Vitti', '2026-02-01', 'fixo', 2650.00, '2026-03-06-8a744bade314', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Arthur Evangelista Oliveira', '2026-02-01', 'fixo', 2400.00, '2026-03-06-7069de3c5ffc', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Arthur Souza Gothe', '2026-02-01', 'fixo', 2600.00, '2026-03-06-c1d5ae0b1b1d', '3.1.1.14 Pessoal - Automações', '2026-03-06', '2026-03-06'),
  ('Bruno Araújo Martins Barroso', '2026-02-01', 'fixo', 3700.00, '2026-03-06-474dc8238236', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('BRUNO DE PADUA FISCHER', '2026-02-01', 'fixo', 1785.71, '2026-03-06-325a9486a6e8', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Bruno de Souza Bartz', '2026-02-01', 'fixo', 6000.00, '2026-03-06-1287c2d2e93a', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Clayderman Thomas Ferreira Da Silva', '2026-02-01', 'fixo', 4000.00, '2026-03-06-ebaf2b9c9239', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Daniel Mota Silva', '2026-02-01', 'fixo', 4500.00, '2026-03-06-5f52878c9089', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Carla Regina Anunciação da Silva Nascimento', '2026-02-01', 'fixo', 3400.00, '2026-03-06-8fc2093fdbb7', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Etyene Nawar de Jesus', '2026-02-01', 'fixo', 2600.00, '2026-03-06-9fb697ec10f0', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Felipe DE Aquino Fernandes', '2026-02-01', 'fixo', 6750.00, '2026-03-06-46147f4893b5', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('David Moulin Avanci', '2026-02-01', 'fixo', 9000.00, '2026-03-06-836a950ef542', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2026-02-01', 'fixo', 2800.00, '2026-03-06-22ee514517f9', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Erick Cola Rodrigues Da Silva', '2026-02-01', 'fixo', 4000.00, '2026-03-06-8c5908529b1b', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Gabriel Amaral Oliveira', '2026-02-01', 'fixo', 2600.00, '2026-03-06-34fd239423fc', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Gabriel DE Oliveira Souza', '2026-02-01', 'fixo', 2200.00, '2026-03-06-019db6d5f740', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Gabriela Fabian Pires Costa', '2026-02-01', 'fixo', 5000.00, '2026-03-06-6315d0ec22f0', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('FERNANDO LEÃO GABEIRA', '2026-02-01', 'fixo', 2400.00, '2026-03-06-5f7f2ba5a8db', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Sandro Linhares de Brito', '2026-02-01', 'fixo', 3700.00, '2026-03-06-a68c4580f73c', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('EDUARDO HELENO LACERDA SANTOS', '2026-02-01', 'fixo', 1764.29, '2026-03-06-e16bbc955e6a', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Gabriela Paganini Trindade', '2026-02-01', 'fixo', 5357.14, '2026-03-06-a77e7b24a0e4', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Giovanni Ferreira Conti', '2026-02-01', 'fixo', 12000.00, '2026-03-06-e5944c387795', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Guilherme Diego Luz Ribeiro', '2026-02-01', 'fixo', 3700.00, '2026-03-06-7b4220f9b16b', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Guilherme Zonta Guimarães Christ', '2026-02-01', 'fixo', 2600.00, '2026-03-06-da0e2773ec1e', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Henrique dos Anjos Moura', '2026-02-01', 'fixo', 5000.00, '2026-03-06-b4936f9e297d', '3.1.1.1. Pessoal - Administrativo', '2026-03-06', '2026-03-06'),
  ('Ingra Pifano', '2026-02-01', 'fixo', 2400.00, '2026-03-06-f154d7de0d05', '3.1.1.10 Pessoal - Novos Canais', '2026-03-06', '2026-03-06'),
  ('Igor Calmon Baptisti', '2026-02-01', 'fixo', 2200.00, '2026-03-06-73ae12568e23', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Iranildo Bastos', '2026-02-01', 'fixo', 2600.00, '2026-03-06-da734f8689c2', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Israel Carré Leitão', '2026-02-01', 'fixo', 3000.00, '2026-03-06-fb1a27ac0cc0', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('João Lucas Wells', '2026-02-01', 'fixo', 4250.00, '2026-03-06-ee63e4e8a305', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Joao Pedro Mendes Lauer', '2026-02-01', 'fixo', 2500.00, '2026-03-06-53810d83305e', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('João Vitor Clasen de Andrades', '2026-02-01', 'fixo', 6300.00, '2026-03-06-82ea540bdaef', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('João Vitor da Silva Fernandes m', '2026-02-01', 'fixo', 2400.00, '2026-03-06-da800c2dc083', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Jonas Fraga Loureiro', '2026-02-01', 'fixo', 5750.00, '2026-03-06-1a54eb0b96ea', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Julia Schaider Alexandre', '2026-02-01', 'fixo', 1928.57, '2026-03-06-9b6281862d41', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('JULYAN BOURGUIGNON RIBEIRO', '2026-02-01', 'fixo', 5980.00, '2026-03-06-d1868a3fb8f7', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Júlia Paulino Rocon', '2026-02-01', 'fixo', 2857.14, '2026-03-06-5042ea6bd4af', '3.1.1.1. Pessoal - Administrativo', '2026-03-06', '2026-03-06'),
  ('Karolyne de Oliveira Araujo', '2026-02-01', 'fixo', 2800.00, '2026-03-06-6306062fd0a9', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Laura Romaneli dos Anjos', '2026-02-01', 'fixo', 1000.00, '2026-03-06-9761e3a415ef', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('JORGE DE MELLO E MOURA NETO', '2026-02-01', 'fixo', 2200.00, '2026-03-06-6141a5849351', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Leonardo Carvalho E Moura', '2026-02-01', 'fixo', 2600.00, '2026-03-06-2e084b4dcb52', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('JOYCE LEMOS LYRIO', '2026-02-01', 'fixo', 2400.00, '2026-03-06-779e4af92ba5', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Leonardo Dias Bussular', '2026-02-01', 'fixo', 9000.00, '2026-03-06-ff9b2c2dd563', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Levi Monteiro Silva', '2026-02-01', 'fixo', 2600.00, '2026-03-06-3c72396a05e1', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Lucas Henrique Caldas', '2026-02-01', 'fixo', 3000.00, '2026-03-06-9fffda91c3dd', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Luiz Medeiros', '2026-02-01', 'fixo', 2400.00, '2026-03-06-10a046d18768', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Lucas Segatto Soares', '2026-02-01', 'fixo', 6000.00, '2026-03-06-9fc744fbebd9', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Luis Guilherme Borborema Rocha', '2026-02-01', 'fixo', 2507.14, '2026-03-06-d5cdda7926d3', '3.1.1.14 Pessoal - Automações', '2026-03-06', '2026-03-06'),
  ('Luiz Paulo', '2026-02-01', 'fixo', 20000.00, '2026-03-06-c2785c79e731', '3.2.22 Diretores - Administrativo', '2026-03-06', '2026-03-06'),
  ('Luiza Dallapicola Maioli da Silva Sodré', '2026-02-01', 'fixo', 2500.00, '2026-03-06-71eeac209a16', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Luiza Freitas Pinheiro', '2026-02-01', 'fixo', 5000.00, '2026-03-06-68154f588237', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Marcelo Couto Leite Junior', '2026-02-01', 'fixo', 5428.57, '2026-03-06-10a2e08d27f9', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Marco Antonio Pereira de Almeida Filho', '2026-02-01', 'fixo', 3700.00, '2026-03-06-3cea8ba8bd50', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Marcelo Amon dos Santos de Oliveira', '2026-02-01', 'fixo', 3000.00, '2026-03-06-b14cad2c6017', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Maria Fernandes Araujo', '2026-02-01', 'fixo', 4250.00, '2026-03-06-164c941beaec', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Mateus Mascarelo Correa Deorce', '2026-02-01', 'fixo', 535.71, '2026-03-06-7ae122945157', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Matheus Lenke Coutinho', '2026-02-01', 'fixo', 11000.00, '2026-03-06-981da75a8397', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Matheus Victor Valério Rodrigues', '2026-02-01', 'fixo', 1785.71, '2026-03-06-290a30562a6e', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Matheus Martins Penna Moraes', '2026-02-01', 'fixo', 4000.00, '2026-03-06-88e1b3dc091f', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Michael Cardoso Thomé', '2026-02-01', 'fixo', 4500.00, '2026-03-06-6e56c993d97a', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Miguel Carvalho', '2026-02-01', 'fixo', 20100.00, '2026-03-06-844f0d30b72a', '3.2.22 Diretores - Administrativo', '2026-03-06', '2026-03-06'),
  ('mauro sergio de andrade da silva', '2026-02-01', 'fixo', 3000.00, '2026-03-06-706f4ebe8fa4', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Nathalia Bernardino', '2026-02-01', 'fixo', 2571.43, '2026-03-06-a18c9e1d65ae', '3.1.1.10 Pessoal - Novos Canais', '2026-03-06', '2026-03-06'),
  ('Nathalia Marques Martins', '2026-02-01', 'fixo', 2000.00, '2026-03-06-a0ca5e9ff496', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Nicolas de Morais Tapias', '2026-02-01', 'fixo', 4500.00, '2026-03-06-4d39bf67826a', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Nícolas Zacché Assunção Aguiar', '2026-02-01', 'fixo', 2400.00, '2026-03-06-522cf7ac2e68', '3.2.7.2. Pessoal - Suporte', '2026-03-06', '2026-03-06'),
  ('Nicolas Silva Rodrigues Neves', '2026-02-01', 'fixo', 2650.00, '2026-03-06-5678a6932667', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Nuno Takeat', '2026-02-01', 'fixo', 2600.00, '2026-03-06-a11c9981eb77', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Pedro Henrique DE Freitas Tessniari', '2026-02-01', 'fixo', 2400.00, '2026-03-06-3acedbe71a38', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Pedro Mastelo Faro', '2026-02-01', 'fixo', 20000.00, '2026-03-06-0e2b11512b24', '3.2.22 Diretores - Administrativo', '2026-03-06', '2026-03-06'),
  ('Rafael Henrique Zambon Alves', '2026-02-01', 'fixo', 2800.00, '2026-03-06-de5992842209', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Rhuan Moura da Silva', '2026-02-01', 'fixo', 3375.00, '2026-03-06-6e2ea51d108f', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('SAMUEL GAMA ROELA', '2026-02-01', 'fixo', 1000.00, '2026-03-06-1dc5d939da54', '3.1.1.3. Pessoal - Marketing', '2026-03-06', '2026-03-06'),
  ('Sara da Silva Pereira', '2026-02-01', 'fixo', 3000.00, '2026-03-06-69d208b075fe', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Stheferson Ewald Cereja', '2026-02-01', 'fixo', 6000.00, '2026-03-06-b3dc4c4c1aeb', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Talles Martins Pereira', '2026-02-01', 'fixo', 4500.00, '2026-03-06-ce3871ab597d', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Sânzio Caldeira dos Santos Júnior', '2026-02-01', 'fixo', 2200.00, '2026-03-06-5fddf1e32c4c', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Tarcisio Antônio de Lima', '2026-02-01', 'fixo', 2600.00, '2026-03-06-27ac3f1f9b35', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Thais Cristina Rosa de Lima', '2026-02-01', 'fixo', 6000.00, '2026-03-06-4716797b9bca', '3.1.1.10 Pessoal - Novos Canais', '2026-03-06', '2026-03-06'),
  ('Thayrone Silva Cazeca', '2026-02-01', 'fixo', 3000.00, '2026-03-06-c54e88e12355', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Thyago Juliano de Souza Calmon', '2026-02-01', 'fixo', 2800.00, '2026-03-06-2007019c02b1', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Tomás Guillermo Ortúzar Barra', '2026-02-01', 'fixo', 2200.00, '2026-03-06-f90f00f0243e', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Victor Brittes Oliveira', '2026-02-01', 'fixo', 13000.00, '2026-03-06-0f8459e713ac', '3.2.22 Diretores - Administrativo', '2026-03-06', '2026-03-06'),
  ('Vinicius Moraes Buteri', '2026-02-01', 'fixo', 8000.00, '2026-03-06-052986de0238', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Vitor Manoel Batista Miguel', '2026-02-01', 'fixo', 2200.00, '2026-03-06-387764ca7705', '3.2.7.1. Pessoal - Onboarding', '2026-03-06', '2026-03-06'),
  ('Vitor Coelho', '2026-02-01', 'fixo', 2600.00, '2026-03-06-5d72366c414b', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Amanda (RH)', '2026-02-01', 'fixo', 12457.53, '2026-03-06-5c3f92bc9b47', '3.1.1.1. Pessoal - Administrativo', '2026-03-06', '2026-03-06'),
  ('Daniel Marcos Cunha Pereira', '2026-02-01', 'fixo', 11612.90, '2026-03-06-550d910f27f7', '3.1.1.4. Pessoal - Tecnologia', '2026-03-06', '2026-03-06'),
  ('Ana Milla', '2026-02-01', 'fixo', 3900.00, '2026-03-06-60e1fcffee3d', '3.2.7.3. Pessoal - Sucesso', '2026-03-06', '2026-03-06'),
  ('Márcia Fernandes', '2026-02-01', 'fixo', 2339.29, '2026-03-06-e82af1b6aa90', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Miguel Carvalho', '2026-02-01', 'prolabore', 4361.00, '2026-03-06-4c876fe85112', '3.1.1.10 Pro Labore', '2026-03-06', '2026-03-06'),
  ('Márcia Fernandes', '2026-02-01', 'fixo', 3629.03, '2026-03-06-4c24e6bf5827', '3.1.1.2. Pessoal - Comercial', '2026-03-06', '2026-03-06'),
  ('Orara (Comercial)', '2026-02-01', 'fixo', 3636.31, '2026-03-09-171d3abfe2e6', '3.1.1.2. Pessoal - Comercial', '2026-03-09', '2026-03-09'),
  ('Dianne Oliveira Guerson', '2026-02-01', 'fixo', 4500.00, '2026-03-09-01c5f3519707', '3.1.1.3. Pessoal - Marketing', '2026-03-09', '2026-03-09'),
  ('Lucas Segatto Soares', '2026-02-01', 'premiacao', 4770.00, '2026-03-16-aa125073fd8a', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Luiza Dallapicola Maioli da Silva Sodré', '2026-02-01', 'premiacao', 3395.00, '2026-03-16-fcb120393863', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('André Luis Rocon', '2026-02-01', 'premiacao', 2325.00, '2026-03-16-0ea219928309', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Joao Pedro Mendes Lauer', '2026-02-01', 'premiacao', 5800.00, '2026-03-16-1900a99d3d60', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Marcelo Amon dos Santos de Oliveira', '2026-02-01', 'premiacao', 3770.00, '2026-03-16-8dd116f47680', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Thayrone Silva Cazeca', '2026-02-01', 'premiacao', 3440.00, '2026-03-16-e96c5614662a', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Lucas Henrique Caldas', '2026-02-01', 'premiacao', 8820.00, '2026-03-16-ba33dea5ba89', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Rhuan Moura da Silva', '2026-02-01', 'premiacao', 4840.00, '2026-03-16-b4fc30ec9d93', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Levi Monteiro Silva', '2026-02-01', 'premiacao', 1560.00, '2026-03-16-6a1f99d4d889', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Iranildo Bastos', '2026-02-01', 'premiacao', 1560.00, '2026-03-16-e836cc2b6d30', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Tarcisio Antônio de Lima', '2026-02-01', 'premiacao', 780.00, '2026-03-16-f7e6b1f987b1', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Etyene Nawar de Jesus', '2026-02-01', 'premiacao', 2600.00, '2026-03-16-65882ec61dbb', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Andrill Amorim Vitti', '2026-02-01', 'premiacao', 1855.00, '2026-03-16-dfaf612d0418', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Thyago Juliano de Souza Calmon', '2026-02-01', 'premiacao', 1120.00, '2026-03-16-df952b25b347', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Guilherme Zonta Guimarães Christ', '2026-02-01', 'premiacao', 2600.00, '2026-03-16-06531e38e1c9', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Tomás Guillermo Ortúzar Barra', '2026-02-01', 'premiacao', 660.00, '2026-03-16-d196d9ca1398', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('André Neves Alves', '2026-02-01', 'premiacao', 975.00, '2026-03-16-ab5627c29bca', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Erick Cola Rodrigues Da Silva', '2026-02-01', 'premiacao', 1600.00, '2026-03-16-29c07a09aaff', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Leonardo Carvalho E Moura', '2026-02-01', 'premiacao', 1040.00, '2026-03-16-60180645471e', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Arthur Evangelista Oliveira', '2026-02-01', 'premiacao', 1200.00, '2026-03-16-b7d7c76e0fe4', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Nícolas Zacché Assunção Aguiar', '2026-02-01', 'premiacao', 1200.00, '2026-03-16-21e5d201428a', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Matheus Martins Penna Moraes', '2026-02-01', 'premiacao', 1600.00, '2026-03-16-dcfd36972b4f', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('Carla Regina Anunciação da Silva Nascimento', '2026-02-01', 'premiacao', 1530.00, '2026-03-16-8ec8fbd54925', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('Dianne Oliveira Guerson', '2026-02-01', 'premiacao', 2025.00, '2026-03-16-91cf99a57fc1', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('mauro sergio de andrade da silva', '2026-02-01', 'premiacao', 1350.00, '2026-03-16-2002fd103c9f', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('Pedro Henrique DE Freitas Tessniari', '2026-02-01', 'premiacao', 1080.00, '2026-03-16-cb97b26aa213', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('João Vitor da Silva Fernandes m', '2026-02-01', 'premiacao', 360.00, '2026-03-16-b215f4c89e12', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Ana Milla', '2026-02-01', 'premiacao', 390.00, '2026-03-16-31a0b1fc7296', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Vitor Coelho', '2026-02-01', 'premiacao', 390.00, '2026-03-16-9e599dd32280', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('JOYCE LEMOS LYRIO', '2026-02-01', 'premiacao', 360.00, '2026-03-16-50be3fe013c3', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Karolyne de Oliveira Araujo', '2026-02-01', 'premiacao', 420.00, '2026-03-16-76daeb607ee5', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Rafael Henrique Zambon Alves', '2026-02-01', 'premiacao', 420.00, '2026-03-16-1e25a2215d59', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Sara da Silva Pereira', '2026-02-01', 'premiacao', 450.00, '2026-03-16-d6dcd917849d', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Nathalia Marques Martins', '2026-02-01', 'premiacao', 300.00, '2026-03-16-4f19c5a3efb7', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Sânzio Caldeira dos Santos Júnior', '2026-02-01', 'premiacao', 660.00, '2026-03-16-07cbdbf653bf', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Vitor Manoel Batista Miguel', '2026-02-01', 'premiacao', 660.00, '2026-03-16-05d3e30faff1', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Gabriel Kirmse', '2026-02-01', 'premiacao', 2200.00, '2026-03-16-a34bad81ab76', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Nicolas Silva Rodrigues Neves', '2026-02-01', 'premiacao', 1590.00, '2026-03-16-364bc2b0a92a', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Nuno Takeat', '2026-02-01', 'premiacao', 520.00, '2026-03-16-d8944598d124', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Luiz Medeiros', '2026-02-01', 'premiacao', 1440.00, '2026-03-16-d3cd5a8df6b1', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('FERNANDO LEÃO GABEIRA', '2026-02-01', 'premiacao', 1200.00, '2026-03-16-a2ac5b58ca58', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Gabriel Amaral Oliveira', '2026-02-01', 'premiacao', 1300.00, '2026-03-16-b35dac739656', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Igor Calmon Baptisti', '2026-02-01', 'premiacao', 561.00, '2026-03-16-5e8bee85eec7', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('JORGE DE MELLO E MOURA NETO', '2026-02-01', 'premiacao', 792.00, '2026-03-16-4214f245eba1', '3.1.1.10 Premiação - Suporte', '2026-03-16', '2026-03-16'),
  ('Stheferson Ewald Cereja', '2026-02-01', 'premiacao', 3000.00, '2026-03-16-45bb3a1695e2', '3.1.1.11 Premiação - Sucesso', '2026-03-16', '2026-03-16'),
  ('Michael Cardoso Thomé', '2026-02-01', 'premiacao', 1000.00, '2026-03-16-243fee750a0a', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('JULYAN BOURGUIGNON RIBEIRO', '2026-02-01', 'premiacao', 4455.00, '2026-03-16-339ab03a15b3', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Marco Antonio Pereira de Almeida Filho', '2026-02-01', 'premiacao', 2100.00, '2026-03-16-ca84ebcfa30e', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Amanda Matos Pardim', '2026-02-01', 'premiacao', 4000.00, '2026-03-16-f2dc28b572a8', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Bruno Araújo Martins Barroso', '2026-02-01', 'premiacao', 1800.00, '2026-03-16-ddc1675d70d4', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Sandro Linhares de Brito', '2026-02-01', 'premiacao', 1000.00, '2026-03-16-b1ba7e0199ef', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Guilherme Diego Luz Ribeiro', '2026-02-01', 'premiacao', 1000.00, '2026-03-16-2a94fa5645db', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Nicolas Silva Rodrigues Neves', '2026-02-01', 'escala', 140.00, '2026-03-16-5c674c1a272e', '3.2.7.5. Escala - Onboarding', '2026-03-16', '2026-03-16'),
  ('Andrill Amorim Vitti', '2026-02-01', 'escala', 140.00, '2026-03-16-6837c7c8c555', '3.2.7.5. Escala - Onboarding', '2026-03-16', '2026-03-16'),
  ('Guilherme Zonta Guimarães Christ', '2026-02-01', 'escala', 140.00, '2026-03-16-d8ba4b7c69da', '3.2.7.5. Escala - Onboarding', '2026-03-16', '2026-03-16'),
  ('Levi Monteiro Silva', '2026-02-01', 'escala', 140.00, '2026-03-16-a07c8755ccef', '3.2.7.5. Escala - Onboarding', '2026-03-16', '2026-03-16'),
  ('Erick Cola Rodrigues Da Silva', '2026-02-01', 'escala', 350.00, '2026-03-16-23af3c9ed032', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('André Neves Alves', '2026-02-01', 'escala', 840.00, '2026-03-16-411e69969655', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('Leonardo Carvalho E Moura', '2026-02-01', 'escala', 595.00, '2026-03-16-f0138d6d6207', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('Arthur Evangelista Oliveira', '2026-02-01', 'escala', 350.00, '2026-03-16-62fcdaa7f151', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('Nícolas Zacché Assunção Aguiar', '2026-02-01', 'escala', 245.00, '2026-03-16-bea097017ad6', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('Igor Calmon Baptisti', '2026-02-01', 'escala', 980.00, '2026-03-16-ca8ea316200e', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('Gabriel Amaral Oliveira', '2026-02-01', 'escala', 1225.00, '2026-03-16-1736f2eda6d6', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('JORGE DE MELLO E MOURA NETO', '2026-02-01', 'escala', 700.00, '2026-03-16-763adee49541', '3.2.7.4 .Escala - Suporte', '2026-03-16', '2026-03-16'),
  ('Thais Cristina Rosa de Lima', '2026-02-01', 'premiacao', 1800.00, '2026-03-16-afa0948a8d6a', '3.1.1.15 Premiação - Novos Canais', '2026-03-16', '2026-03-16'),
  ('Ingra Pifano', '2026-02-01', 'premiacao', 840.00, '2026-03-16-7bf6bf2b56e0', '3.1.1.15 Premiação - Novos Canais', '2026-03-16', '2026-03-16'),
  ('Matheus Victor Valério Rodrigues', '2026-02-01', 'premiacao', 1000.00, '2026-03-16-04b11d5e5db2', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('EDUARDO HELENO LACERDA SANTOS', '2026-02-01', 'premiacao', 650.00, '2026-03-16-6ae943990d8c', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('Luis Guilherme Borborema Rocha', '2026-02-01', 'premiacao', 780.00, '2026-03-16-3ff96cb42aba', '3.1.1.16 Premiação - Administrativo', '2026-03-16', '2026-03-16'),
  ('Lucas Henrique Caldas', '2026-02-01', 'premiacao', 496.35, '2026-03-16-339b7d8f3546', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Arthur Souza Gothe', '2026-02-01', 'premiacao', 1300.00, '2026-03-16-89961af06316', '3.1.1.16 Premiação - Administrativo', '2026-03-16', '2026-03-16'),
  ('Julia Schaider Alexandre', '2026-02-01', 'premiacao', 3504.00, '2026-03-16-4ce5fe006d13', '3.1.1.5. Premiação - Comercial', '2026-03-16', '2026-03-16'),
  ('Vitor Manoel Batista Miguel', '2026-02-01', 'premiacao', 75.00, '2026-03-16-e24554d0b7c4', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Tarcisio Antônio de Lima', '2026-02-01', 'premiacao', 1050.00, '2026-03-16-39ded43a6d60', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Sânzio Caldeira dos Santos Júnior', '2026-02-01', 'premiacao', 600.00, '2026-03-16-2e760d62ba39', '3.1.1.6. Premiação - Onboarding', '2026-03-16', '2026-03-16'),
  ('Luiza Freitas Pinheiro', '2026-02-01', 'premiacao', 2500.00, '2026-03-16-eaa49b6d703e', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('Bruno de Souza Bartz', '2026-02-01', 'premiacao', 3000.00, '2026-03-16-c06466d54718', '3.1.1.8 Premiação - Marketing', '2026-03-16', '2026-03-16'),
  ('BRUNO DE PADUA FISCHER', '2026-02-01', 'premiacao', 900.00, '2026-03-17-4a72a8ea4ed3', '3.1.1.6. Premiação - Onboarding', '2026-03-17', '2026-03-17'),
  ('Geórgia (Eventos)', '2026-02-01', 'fixo', 972.26, '2026-03-20-57a2925c8d12', '3.1.1.10 Pessoal - Novos Canais', '2026-03-20', '2026-03-20'),
  ('ANA CLARA ROSSI MONGIN', '2026-02-01', 'fixo', 10000.00, '2026-03-27-fc9e1c1c3168', '3.1.1.1. Pessoal - Administrativo', '2026-03-27', '2026-03-27'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2026-02-01', 'premiacao', 700.00, '2026-03-27-f767e2f4ec32', '3.1.1.10 Premiação - Suporte', '2026-03-27', '2026-03-27'),
  ('DIOGO LUCCA CHAVES ARAUJO', '2026-02-01', 'premiacao', 350.00, '2026-03-27-04d31d11b003', '3.1.1.10 Premiação - Suporte', '2026-03-27', '2026-03-27');

-- Sem este bloco, uma pessoa que não casasse sumiria calada: o insert abaixo é
-- um join, e join que não acha não grava e não reclama. Aqui ele reclama.
do $$
declare
  v_orfaos text;
begin
  select string_agg(distinct t.pessoa, ', ')
    into v_orfaos
    from _remuneracao_ca t
   where public.remuneracao_pessoa_por_chave(public.contraparte_chave(t.pessoa)) is null;

  if v_orfaos is not null then
    raise exception 'Remuneração/Conta Azul: sem pessoa no cadastro para %', v_orfaos;
  end if;
end $$;

insert into public.remuneracao_lancamento
  (pessoa_id, competencia, bloco, valor, fonte, origem_ref, categoria, vencimento, pagamento)
select public.remuneracao_pessoa_por_chave(public.contraparte_chave(t.pessoa)),
       t.competencia, t.bloco, t.valor, 'conta_azul', t.origem_ref,
       t.categoria, t.vencimento, t.pagamento
  from _remuneracao_ca t
on conflict (fonte, origem_ref) do update
  set valor         = excluded.valor,
      competencia   = excluded.competencia,
      bloco         = excluded.bloco,
      categoria     = excluded.categoria,
      vencimento    = excluded.vencimento,
      pagamento     = excluded.pagamento,
      pessoa_id     = excluded.pessoa_id,
      atualizado_em = now();

/* ------------------------------------------------------------------ */
/* 3. Conferência: a premiação tem de bater com a DRE                  */
/* ------------------------------------------------------------------ */

-- O mesmo teste que provou a âncora fica gravado aqui, para que uma
-- reaplicação com dado torto não passe em silêncio. Dezembro fica de fora
-- porque é parcial por construção (ver o cabeçalho).
do $$
declare
  r      record;
  v_prem numeric;
  v_dre  numeric;
begin
  for r in
    select * from (values ('2026-01-01'::date, 'Jan-26'),
                          ('2026-02-01'::date, 'Feb-26')) as c(competencia, chave)
  loop
    select coalesce(sum(l.valor), 0) into v_prem
      from public.remuneracao_lancamento l
     where l.competencia = r.competencia and l.bloco = 'premiacao';

    -- O blob da DRE guarda o mês em INGLÊS ('Jan-26') e a despesa negativa; e
    -- o mês sem valor vem como string vazia, que o cast recusa.
    select coalesce(sum(abs(nullif(linha.value ->> r.chave, '')::numeric)), 0) into v_dre
      from public.demonstracoes_contabeis d,
           lateral jsonb_array_elements(d.dados -> 'rows') linha
     where d.tipo = 'dre' and d.periodo = 'completo'
       and linha.value ->> 'Conta' in ('Premiações', 'Premiações Operacionais');

    if v_dre > 0 and abs(v_dre - v_prem) > 1 then
      raise exception 'Remuneração/%: premiação R$ % não bate com a DRE (R$ %)',
        r.chave, v_prem, v_dre;
    end if;
  end loop;
end $$;
