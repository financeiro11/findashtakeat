-- "JG (FINANCEIRO)" E "JOÃO GUILHERME (FINANCEIRO)" SÃO A MESMA PESSOA.
--
-- Perguntaram por que o histórico dele parava em jan/2025 se ficou até julho.
-- Parava porque o extrato mudou de apelido no meio: o Conta Azul escreveu
-- "joão guilherme financeiro" até jan/2025 e "jg financeiro" de fev/2025 em
-- diante, e a carga criou duas fichas.
--
-- A PENEIRA QUE JÁ EXISTE NÃO PEGAVA ESTE CASO. `remuneracao_fundir_por_documento`
-- casa por CNPJ, e nenhum dos dois tem. A busca por nome procura pares em que um
-- nome está CONTIDO no outro com ≥2 tokens em comum — e "JG" não está contido em
-- "João Guilherme", é a sigla dele — "JG era apelido dele", confirmou o Miguel
-- depois que a linha do tempo já apontava para isso. Sigla/apelido é uma classe
-- que aquela régua não vê, e nenhuma régua de NOME veria: o que provou foi o
-- dinheiro.
--
-- O QUE PROVA QUE É A MESMA PESSOA não é o nome, é a linha do tempo do valor —
-- o mesmo teste que separou os três Nicolas em 2025:
--
--   João Guilherme  mai/24 → jan/25   termina em R$ 1.500
--   JG              fev/25 → jun/25   começa  em R$ 1.500
--
-- Emenda exata, sem um único mês em comum, mesmo valor na virada, mesma
-- categoria ("3.1.1.1. Pessoal - Administrativo") e mesma fonte (conta_azul). E
-- jun/25 vem inflado (R$ 3.318 contra R$ 1.500) — é o acerto de contas, pago em
-- julho, que é exatamente quando disseram que ele saiu.
--
-- Fica a ficha com o nome INTEIRO: nenhum dos dois tem `codigo_rh`, então não há
-- o critério de sempre (ver `remuneracao_fundir`), e entre uma sigla e um nome
-- quem se procura na tela é o nome.
--
-- A VARREDURA POR OUTROS CASOS não achou mais nenhum. A régua que discrimina
-- (série emendando no mês seguinte, mesma área, mesmo fixo na virada) devolve um
-- único outro par — "Thiago Daud (Suporte)" → "Arthur Evangelista", nomes
-- distintos e o segundo com ficha no RH: é substituição no mesmo salário, não
-- ficha partida. Afrouxar para aceitar buraco de um mês devolve 78 pares e
-- nenhum sinal — vira lista de rotatividade do Comercial.

do $$
declare
  v_mantem  uuid := 'cce5ace6-a8dc-48cf-a585-61f050783ac8';  -- João Guilherme (Financeiro)
  v_absorve uuid := '33f89e14-f6a0-431c-8585-e955f505258f';  -- JG (Financeiro)
  v_meses   integer;
  v_total   numeric;
begin
  -- Idempotente: a fusão já foi aplicada em 10/09/2026; este arquivo é o
  -- registro dela, e repetir a migration não pode dar erro.
  if exists (select 1 from public.remuneracao_pessoa where id = v_absorve) then
    perform public.remuneracao_fundir(v_mantem, v_absorve, 'manual');
  end if;

  select count(*), round(sum(total)) into v_meses, v_total
    from public.vw_remuneracao_mensal where pessoa_id = v_mantem;

  -- 14 meses (mai/24 a jun/25) e R$ 19.192 = os R$ 9.873 de um mais os R$ 9.319
  -- do outro. Se a conta não fechar, a fusão pegou o par errado.
  if v_meses <> 14 or v_total <> 19192 then
    raise exception 'fusão inesperada: % meses, R$ % (esperado 14 e 19192)', v_meses, v_total;
  end if;

  -- O apelido velho vira alias: sem isto, uma reimportação do Conta Azul
  -- recriaria a segunda ficha e desfaria a fusão em silêncio.
  if not exists (
    select 1 from public.remuneracao_pessoa_alias
     where chave = 'JG FINANCEIRO' and pessoa_id = v_mantem
  ) then
    raise exception 'o alias JG FINANCEIRO não ficou apontando para a ficha mantida';
  end if;

  raise notice 'João Guilherme: % meses, R$ %', v_meses, v_total;
end $$;
