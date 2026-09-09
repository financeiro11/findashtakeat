-- A fusão por documento passa a enxergar a raiz do CNPJ.
--
-- Consequência de `…150000_quatro_pessoas_deixam_de_ter_duas_fichas`: as quatro
-- fichas partidas tiveram de ser fundidas À MÃO porque
-- `remuneracao_fundir_por_documento()` compara documento por IGUALDADE EXATA, e
-- de um lado o documento estava truncado.
--
-- ── O DEFEITO ────────────────────────────────────────────────────────────
--
-- O espelho do Portal RH guarda o `cnpj` de duas pessoas com OITO dígitos —
-- só a raiz, sem filial nem verificador:
--
--     RENATA RUAS PESSOA      61107569   (o Omie paga 61107569000145)
--     Talles Martins Pereira  58313176   (o Omie paga 58313176000183)
--
-- Oito dígitos nunca são iguais a catorze, então a rotina passa direto: nunca
-- funde errado, mas também nunca funde. E aí basta UM título chegar ao Omie com
-- o cadastro de favorecido sem CNPJ para a pessoa ganhar uma segunda ficha com
-- o nome que o Omie escreve nesses casos — "61.107.569 RENATA RUAS PESSOA".
-- Foi exatamente assim que a Renata partiu; o Talles tem o mesmo defeito e
-- ainda não partiu.
--
-- ── O QUE MUDA ───────────────────────────────────────────────────────────
--
-- Um segundo caminho de casamento, ligado SÓ na assinatura do defeito: um lado
-- com exatamente 8 dígitos e o outro com exatamente 14, casando pelos 8
-- primeiros. Não toca em nenhum casamento que já funciona, e não alcança CPF —
-- onze dígitos ficam de fora dos dois lados, que é o que impede dois CPFs de se
-- encostarem por coincidência dos primeiros oito.
--
-- As duas guardas de sempre continuam valendo, agora medidas sobre a CHAVE de
-- casamento e não sobre o documento cru: a chave precisa apontar para uma única
-- ficha do RH e para um único órfão. Na dúvida, não funde — o painel prefere
-- duas fichas separadas a duas pessoas somadas.
--
-- ── HOJE ISTO É UM NO-OP, DE PROPÓSITO ───────────────────────────────────
--
-- Não existe ninguém partido por este motivo neste momento (a Renata acabou de
-- ser fundida à mão). A mudança é preventiva, e o bloco de conferência no fim
-- exige que ela não mexa em nada agora: se fundir alguém nesta aplicação, é
-- porque a régua ficou mais larga do que eu quis.

create or replace function public.remuneracao_fundir_por_documento()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_par record;
  v_n integer := 0;
begin
  for v_par in
    with rh_doc as (
      select r.codigo,
             nullif(regexp_replace(coalesce(r.cnpj, ''), '\D', '', 'g'), '') as doc
      from public.rh_colaboradores r
    ),
    orfao as (
      select p.id, p.doc from public.remuneracao_pessoa p
      where p.codigo_rh is null and p.doc is not null
    ),
    -- Todo par (ficha do RH, ficha órfã) que o documento permite ligar. O
    -- documento inteiro continua sendo o caminho normal; a raiz só entra
    -- quando um lado tem 8 dígitos e o outro tem os 14.
    par as (
      select rd.codigo, o.id as absorve
      from rh_doc rd
        join orfao o on
          rd.doc = o.doc
          or (length(rd.doc) = 8 and length(o.doc) = 14 and left(o.doc, 8) = rd.doc)
      where rd.doc is not null
    )
    select p.absorve, f.id as mantem
    from par p
      join public.remuneracao_pessoa f on f.codigo_rh = p.codigo
    -- A dupla tem de ser exclusiva NOS DOIS SENTIDOS: este órfão só pode casar
    -- com uma pessoa do RH, e essa pessoa só pode casar com este órfão. Duas
    -- matrículas com o mesmo documento, ou dois órfãos apontando para a mesma
    -- pessoa, significam que não dá para saber quem é quem — e somar as duas é
    -- pior do que deixar separado.
    --
    -- A checagem é sobre os PARES e não sobre o documento porque a raiz criou
    -- um caminho novo: o mesmo órfão pode agora ser alcançado por uma matrícula
    -- com o CNPJ inteiro e por outra com só a raiz.
    where (select count(*) from par q where q.absorve = p.absorve) = 1
      and (select count(*) from par q where q.codigo  = p.codigo)  = 1
  loop
    perform public.remuneracao_fundir(v_par.mantem, v_par.absorve, 'documento');
    v_n := v_n + 1;
  end loop;

  return v_n;
end $function$;

comment on function public.remuneracao_fundir_por_documento() is
  'Funde a ficha órfã na ficha do RH quando o documento bate — inteiro, ou pela raiz do CNPJ quando o RH só guardou os 8 primeiros dígitos.';

-- ── Conferência: a régua nova não pode fundir ninguém hoje ────────────────
do $$
declare
  v_pessoas_antes integer;
  v_fundidas      integer;
  v_pessoas_depois integer;
begin
  select count(*) into v_pessoas_antes from public.remuneracao_pessoa;
  v_fundidas := public.remuneracao_fundir_por_documento();
  select count(*) into v_pessoas_depois from public.remuneracao_pessoa;

  if v_fundidas <> 0 or v_pessoas_antes <> v_pessoas_depois then
    raise exception
      'A fusão por raiz de CNPJ fundiu % ficha(s) numa base que não tinha nenhuma partida por documento (% -> % pessoas). A régua ficou larga demais.',
      v_fundidas, v_pessoas_antes, v_pessoas_depois;
  end if;
end $$;
