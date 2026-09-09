/* ============================================================================
 * A RECUSADA VOLTA PARA A ESTEIRA — liberando o carimbo, não reemitindo a OS.
 *
 * O PROBLEMA. 289 notas (R$ 102 mil em 120 dias) estão em OS faturadas cujo RPS
 * a prefeitura recusou (`nfse_status = '003'`, sem número). O cadastro delas já
 * está certo — 230 foram consertadas depois da recusa e 59 foram só oscilação da
 * prefeitura (403 / sem resposta). Falta só a nota sair, e não existe reenvio
 * pela API do Omie: dez métodos sondados (`ReenviarNFSe`, `ReprocessarNFSe`,
 * `ReenviarRPS`, `RefaturarOS`, `ReenviarLoteOS`…), todos "Method not exists".
 * O único caminho era o botão "Reenviar NFS-e" na tela do Omie, 289 vezes.
 *
 * O CAMINHO ESCOLHIDO, e por que ele é pequeno. A saída é criar uma OS NOVA
 * para a mesma cobrança — o que não duplica NOTA (a recusada nunca gerou
 * documento fiscal), duplica OS. Só que o Omie **recusa `cCodIntOS` repetido**, e
 * é justamente esse carimbo (`pay_…`) que liga a cobrança do Asaas à OS em todo
 * o resto do módulo: o painel do mês, a fila, as candidatas, o anexo da nota na
 * cobrança e a baixa do título.
 *
 * A tentação era deixar a OS nova nascer com um carimbo sufixado (`pay_…#2`) e
 * ensinar as cinco camadas a tirar o sufixo. Cinco lugares fiscais mudados para
 * emitir uma nota é a forma mais cara possível de resolver isto.
 *
 * O que se faz em vez disso: **renomear o carimbo da OS MORTA** para
 * `<pay_…>-r<n_cod_os>` e guardar o original aqui. A partir desse instante a
 * cobrança volta a não ter OS nenhuma aos olhos de todo o resto — o join exato
 * (`c_cod_int_os = id_asaas`) não a acha mais, o heurístico também não (ele só
 * olha carimbo VAZIO), o `EH_ID_ASAAS` (`^pay_[a-z0-9]+$`) deixa de casar — e a
 * esteira que já existe, testada, a serve como serve qualquer outra cobrança sem
 * nota. **Zero mudança no motor de emissão.**
 *
 * POR QUE NÃO APAGAR A OS MORTA. `ExcluirOS` existe, e seria mais limpo de olhar.
 * Mas a recusa é o registro de um ato fiscal que aconteceu — a prefeitura
 * respondeu, com data e motivo —, e este módulo inteiro é append-only por essa
 * razão. Renomear preserva a trilha; apagar a queima.
 *
 * O CARIMBO NÃO É ATO FISCAL. Vale dizer em voz alta porque a operação PARECE
 * perigosa e não é: `AlterarOS` mexendo só em `cCodIntOS` não emite, não cancela
 * e não muda valor, cliente, serviço ou data. O que ela faz é soltar uma chave de
 * integração. O ato fiscal continua sendo a emissão, que acontece depois, pela
 * esteira, sob todas as guardas de sempre (porta do Asaas ao vivo, sombra
 * anti-duplicata, teto do dia).
 * ========================================================================== */

alter table public.nf_os_omie
  add column if not exists carimbo_liberado_em timestamptz,
  add column if not exists carimbo_original    text;

comment on column public.nf_os_omie.carimbo_liberado_em is
  'Quando o cCodIntOS desta OS foi renomeado para liberar a cobranca a voltar para a esteira. So acontece em OS com RPS recusado (nfse_status 003) e sem numero de nota: a OS morta cede o carimbo para que uma OS nova possa nascer para a mesma cobranca. Nao e ato fiscal — nada foi emitido nem cancelado aqui.';

comment on column public.nf_os_omie.carimbo_original is
  'O cCodIntOS que esta OS tinha antes da liberacao (o pay_ do Asaas). Guardado em coluna propria, e nao so no carimbo sufixado, porque e por ele que se responde meses depois "de qual cobranca era esta OS recusada?" sem depender de parsing.';

/* O índice serve a UMA pergunta, que a tela faz a cada visita: "o que ainda
   está esperando para voltar?". Parcial porque a coluna é nula em 99% das
   linhas — e um índice parcial sobre o que é raro é o que fica pequeno. */
create index if not exists nf_os_omie_carimbo_liberado_idx
  on public.nf_os_omie (carimbo_liberado_em)
  where carimbo_liberado_em is not null;


/* ---------------------------------------------------------------------------
 * A lista de recusas para de mostrar quem já voltou
 * ---------------------------------------------------------------------------
 * Sem isto a OS liberada ficaria na aba "Recusadas" para sempre: ela continua
 * sendo `nfse_status = '003'` sem número no Omie, e continuará sendo — a OS
 * morta não ressuscita, quem emite é a nova. Uma fila de trabalho que não
 * esvazia é uma fila que ninguém revisita.
 *
 * O resto da função é cópia fiel do que está no banco hoje. Cópia fiel de
 * propósito: é ela que decide o que a pessoa vê como trabalho a fazer, e
 * reescrevê-la de memória é como se perde uma classificação sem perceber.
 * ------------------------------------------------------------------------- */
create or replace function public.nfse_recusas_a_tratar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, emitivel boolean, situacao text,
  consertado_em timestamptz, o_que_foi_feito text
)
language sql
stable
set search_path to 'public'
as $function$
with recusa as (
  select o.n_cod_os, o.c_num_os, o.c_cod_int_os, o.cnpj_cpf, o.n_cod_cli,
         o.valor, o.data_faturamento, o.nfse_mensagem
  from public.nf_os_omie o
  where o.cancelada = false
    and o.nfse_status = '003'
    and coalesce(o.nfse_numero, '') = ''
    -- Já devolvida à esteira: a nota vai sair por uma OS NOVA, e esta aqui é só
    -- o registro da recusa que aconteceu. Ver `carimbo_liberado_em`.
    and o.carimbo_liberado_em is null
    and o.data_faturamento >= current_date - make_interval(days => greatest(p_dias, 1))
),
-- O conserto que veio DEPOIS da recusa. Antes dela não conta: se o endereço já
-- estava assim quando a prefeitura recusou, ele não é a solução, é o problema.
conserto as (
  select r.n_cod_os,
         max(k.criado_em) as consertado_em,
         (array_agg(k.resultado order by k.criado_em desc))[1] as resultado
  from recusa r
  join public.nf_cadastro_correcoes k
    on k.doc = r.cnpj_cpf
   and k.criado_em > r.data_faturamento::timestamptz
  where (k.resultado->'omie'->>'ok')::boolean is true
  group by r.n_cod_os
)
select r.n_cod_os, r.c_num_os, r.c_cod_int_os, r.cnpj_cpf,
       coalesce(en.nome, '—'),
       r.valor, r.data_faturamento,
       coalesce(r.nfse_mensagem, '(sem mensagem)'),
       case
         when r.nfse_mensagem ilike '%E0240%'  then 'CEP do cliente não confere com o município'
         when r.nfse_mensagem ilike '%E0921%'
           or r.nfse_mensagem ilike '%E0922%'  then 'Código do município do cliente'
         when r.nfse_mensagem ilike '%E0207%'  then 'CPF não existe no cadastro da Receita'
         when r.nfse_mensagem ilike '%E1235%'  then 'Telefone do cliente inválido'
         when r.nfse_mensagem ilike '%falta preencher%' then 'Cadastro incompleto no Omie'
         when r.nfse_mensagem ilike '%403%'
           or r.nfse_mensagem ilike '%Nenhuma resposta%'
           or r.nfse_mensagem ilike '%sobrecarregados%' then 'Instabilidade da prefeitura — reenviar resolve'
         else 'Ver mensagem da prefeitura'
       end,
       en.cep, en.cep_generico, en.emitivel,
       case
         -- Instabilidade primeiro: ela não depende de cadastro nenhum, e
         -- classificá-la como "precisa de gente" mandaria alguém procurar
         -- defeito onde não há.
         when r.nfse_mensagem ilike '%403%'
           or r.nfse_mensagem ilike '%Nenhuma resposta%'
           or r.nfse_mensagem ilike '%sobrecarregados%' then 'so_reenviar'
         when c.n_cod_os is not null then 'consertado'
         else 'precisa_de_gente'
       end,
       c.consertado_em,
       case
         when c.n_cod_os is null then null
         else concat_ws(', ',
           nullif(c.resultado->'omie'->'escrito'->>'endereco', ''),
           nullif(c.resultado->'omie'->'escrito'->>'endereco_numero', ''),
           nullif(c.resultado->'omie'->'escrito'->>'cep', ''))
       end
from recusa r
left join public.omie_clientes_endereco en on en.codigo = r.n_cod_cli
left join conserto c on c.n_cod_os = r.n_cod_os
order by r.data_faturamento desc, r.valor desc;
$function$;

revoke all on function public.nfse_recusas_a_tratar(integer) from public, anon;
grant execute on function public.nfse_recusas_a_tratar(integer) to authenticated, service_role;


/* ---------------------------------------------------------------------------
 * O QUE JÁ VOLTOU — a contrapartida da lista acima
 * ---------------------------------------------------------------------------
 * A liberação some da aba de recusas, e some é exatamente o que ninguém
 * consegue auditar depois. Esta função é onde "a nota daquela recusa saiu
 * mesmo?" se responde: por cobrança, o que a OS morta era e se a OS nova já
 * nasceu e já virou nota.
 *
 * `nota_nova` é lida pelo carimbo LIMPO, que é o que a OS nova recebe ao nascer
 * — a morta ficou com o sufixo `-r<n_cod_os>` e por isso não se confunde com ela.
 * ------------------------------------------------------------------------- */
create or replace function public.nfse_devolvidas_a_esteira(p_dias integer default 30)
returns table(
  n_cod_os bigint, id_cobranca text, nome text, valor numeric,
  liberada_em timestamptz, motivo_da_recusa text,
  os_nova bigint, nota_nova text, situacao text
)
language sql
stable
set search_path to 'public'
as $function$
select m.n_cod_os,
       m.carimbo_original,
       coalesce(en.nome, '—'),
       m.valor,
       m.carimbo_liberado_em,
       m.nfse_mensagem,
       nova.n_cod_os,
       nullif(nova.nfse_numero, ''),
       case
         when nova.nfse_status = '004' then 'nota emitida'
         when nova.nfse_status = '003' then 'recusada de novo'
         when nova.n_cod_os is not null then 'OS nova criada, sem nota ainda'
         else 'na fila da esteira'
       end
from public.nf_os_omie m
left join public.omie_clientes_endereco en on en.codigo = m.n_cod_cli
left join lateral (
  select o.n_cod_os, o.nfse_numero, o.nfse_status
  from public.nf_os_omie o
  where o.c_cod_int_os = m.carimbo_original
    and o.n_cod_os <> m.n_cod_os
    and o.cancelada = false
  order by o.n_cod_os desc
  limit 1
) nova on true
where m.carimbo_liberado_em is not null
  and m.carimbo_liberado_em >= now() - make_interval(days => greatest(p_dias, 1))
order by m.carimbo_liberado_em desc, m.valor desc;
$function$;

comment on function public.nfse_devolvidas_a_esteira(integer) is
  'As OS recusadas cujo carimbo foi liberado para a cobranca voltar a esteira, com o desfecho de cada uma: se a OS nova ja nasceu e se ela ja virou nota. E a auditoria da operacao — sem ela a recusa some da aba "Recusadas" e ninguem consegue responder depois se a nota saiu mesmo.';

revoke all on function public.nfse_devolvidas_a_esteira(integer) from public, anon;
grant execute on function public.nfse_devolvidas_a_esteira(integer) to authenticated, service_role;
