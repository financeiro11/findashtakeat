/* ---------------------------------------------------------------------------
 * "Corrigido" que não corrigiu volta para a fila.
 *
 * O SINTOMA, logo depois de trocar a régua (10/09/2026): a varredura já sabia de
 * **40 cadastros com CEP inexistente e cobrança recente**, e `nfse_preparo_montar`
 * devolveu **1** pendente. Os outros 39 estavam parados em `situacao =
 * 'corrigido'`.
 *
 * A CAUSA é o `on conflict (doc) do update` da montagem: ele atualiza nome,
 * valor e `falta`, e PRESERVA `situacao` — de propósito, para não apagar o
 * histórico de quem já foi tratado. Só que "tratado" foi decidido sob a régua
 * ANTIGA (`cep_generico`). Quando a régua mudou, 1.169 linhas continuaram
 * dizendo "já resolvi isso" sobre um defeito que a régua nova acabou de
 * descobrir. Trocar o critério sem reabrir o que ele reclassifica é mudar de
 * ideia e não contar a ninguém.
 *
 * A CORREÇÃO: `corrigido` é uma afirmação da MÁQUINA sobre o estado do cadastro
 * — "a condição não vale mais". Se a condição volta a valer (ou nunca deixou de
 * valer), a afirmação é falsa e a linha volta para `pendente`.
 *
 * `humano` E `bloqueado` NÃO SÃO REABERTOS, e a assimetria é o ponto: esses dois
 * são decisões sobre o limite da máquina ("isto precisa de gente", "a Receita
 * não responde para este CNPJ"), não afirmações sobre o cadastro. Reabri-los
 * criaria o laço clássico — a rodada tenta, desiste, marca, e a montagem
 * seguinte desmarca. `preparar` continua promovendo a `humano` depois de três
 * tentativas, e é essa a saída do laço.
 * ------------------------------------------------------------------------- */

create or replace function public.nfse_preparo_montar(p_desde date default null::date)
returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare
  n integer;
begin
  with ativos as (
    select regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
           min(c.id_asaas) as id_customer,
           sum(p.valor)    as valor,
           count(*)::int   as cobrancas
    from public.asaas_cache p
    join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
    where p.tipo = 'payment' and p.valor > 0
      and upper(coalesce(p.status,'')) in ('RECEIVED','RECEIVED_IN_CASH')
      and coalesce(p.data_pagamento, p.data_vencimento) >= coalesce(p_desde, current_date - 60)
    group by 1
  ),
  cad as (
    select distinct on (cnpj_cpf)
           cnpj_cpf, codigo, nome, emitivel, cep_generico, cep_valido,
           endereco, endereco_numero, cep, email
    from public.omie_clientes_endereco
    where cnpj_cpf is not null and cnpj_cpf <> ''
    order by cnpj_cpf, codigo
  ),
  alvo as (
    select a.doc, cad.codigo, cad.nome, a.id_customer,
           concat_ws(', ',
             case when coalesce(btrim(cad.endereco), '') = ''        then 'logradouro' end,
             case when coalesce(btrim(cad.endereco_numero), '') = '' then 'número' end,
             case when coalesce(btrim(cad.cep), '') = ''             then 'CEP' end,
             case when coalesce(btrim(cad.email), '') = ''           then 'e-mail' end,
             case when cad.cep_valido is false                       then 'CEP não existe nos Correios' end
           ) as falta,
           round(a.valor, 2) as valor, a.cobrancas
    from ativos a
    join cad on cad.cnpj_cpf = a.doc
    where length(a.doc) in (11, 14)
      and (cad.emitivel = false or cad.cep_valido is false)
  )
  insert into public.nfse_preparo_fila as f
        (doc, codigo, nome, id_customer, falta, valor, cobrancas, montada_em)
  select doc, codigo, nome, id_customer, falta, valor, cobrancas, now() from alvo
  on conflict (doc) do update
    set codigo = excluded.codigo, nome = excluded.nome, id_customer = excluded.id_customer,
        falta  = excluded.falta,  valor = excluded.valor, cobrancas = excluded.cobrancas,
        montada_em = now(),
        /* A REABERTURA. `corrigido` afirma que a condição não vale mais; o
           `insert` só chega aqui quando ela vale. Logo, a afirmação está velha —
           quase sempre porque foi feita sob outra régua. `humano` e `bloqueado`
           passam intactos: são limites da máquina, não estado do cadastro. */
        situacao = case when f.situacao = 'corrigido' then 'pendente' else f.situacao end,
        motivo = case when f.situacao = 'corrigido'
                      then 'Reaberto: o cadastro ainda bate na condição da fila.'
                      else f.motivo end;

  delete from public.nfse_preparo_fila f
  where f.situacao = 'pendente'
    and not exists (
      select 1 from public.omie_clientes_endereco e
      where e.cnpj_cpf = f.doc and (e.emitivel = false or e.cep_valido is false)
    );

  select count(*) into n from public.nfse_preparo_fila where situacao = 'pendente';
  return n;
end;
$function$;
