-- A mesma nota entra pelas duas portas, e o acervo conta as duas.
--
-- O QUE FOI MEDIDO EM 28/08/2026, e não suposto:
--
--   • 161 notas vivas com fonte `drive_gmail`. Destas, 126 (78%) são o MESMO
--     ARQUIVO de uma linha com fonte `email` — mesmo nome, o mesmo papel. Só 21
--     tinham sido reconhecidas como cópia.
--   • 437 das 1.111 linhas "sem alvo" e 422 das 2.430 da "biblioteca" já eram
--     cópias de papel que o acervo contava de novo.
--   • o título 5491400995 tem a NFS-e 24207668000172_1_367483 anexada no Omie
--     desde 26/08 23:50 — subiu pelo XML do e-mail (id 36376) — e o PDF gêmeo
--     vindo do Drive (id 26128) seguia marcado `falta_anexar`, reivindicando o
--     mesmo título. O 5491400996 era o mesmo caso.
--
-- ---------------------------------------------------------------------------
-- POR QUE AS DUAS PORTAS EXISTEM, E POR QUE NENHUMA DELAS FECHA
--
-- Uma automação de fora copia os anexos de `financeiro@` para "06. Notas
-- Fiscais 2026 / 0. Gmail / AAAA-MM /", e a `comprovantes-drive-sync` lê essa
-- pasta. A `gmail-nf-sync` lê a MESMA caixa direto — porque aquela automação
-- parou em 10/08/2026 sem avisar, e porque o corpo do e-mail, o link e o
-- histórico antigo nunca estiveram no depósito.
--
-- Fechar a porta do Drive seria perder 35 das 161: arquivos que a leitura da
-- caixa não alcançou (o extrato da Takeat LLC, a invoice da CuboStart, a nota
-- da Atta). As duas portas ficam. O que tem de mudar é o reconhecimento.
--
-- ---------------------------------------------------------------------------
-- POR QUE `notas_externas_marcar_copias` NÃO ENXERGAVA
--
-- A escada de identidade era: (1) chave fiscal, (2) moeda + valor original +
-- número, (3) número do documento + valor. Nos 139 pares vivos:
--
--   • 0 tinham chave fiscal IGUAL dos dois lados — 118 não têm chave nenhuma
--     (NFS-e não tem os 44 dígitos) e em 21 só o e-mail a leu, porque o XML
--     traz a chave em campo próprio e o PDF espelhado não;
--   • 134 dos 139 não têm `numero_do_documento` em pelo menos um dos lados;
--   • e quando o número existe, o VALOR discorda: o PDF lê R$ 233,00 (líquido,
--     com ISS retido) e o XML lê R$ 242,32 (bruto). Os dois estão certos — é o
--     caso já documentado em `nota-bruta-titulo-liquido`, e ele quebra a regra
--     3 justamente onde ela era a última.
--
-- O QUE É IDÊNTICO NOS DOIS LADOS É O NOME DO ARQUIVO. A automação salva
-- `AAAA-MM-DD_<nome do anexo>`; tirado o carimbo de data, sobra o nome que o
-- emissor deu. A escada nunca olhou para ele.
--
-- ---------------------------------------------------------------------------
-- E POR QUE O PORTADOR ERRADO REABRE O BURACO
--
-- O portador era `min(id)` — o mais VELHO. Duas consequências:
--
--   1. o sobrevivente costuma ser o PDF do Drive (lido por OCR ou pelo nome,
--      `tipo_documento = 'outro'`, valor de vez em quando errado) e o descartado
--      é o XML do e-mail, que traz CNPJ, valor, data e chave em campo próprio.
--      Guardava-se a pior leitura das duas.
--
--   2. a nota JÁ ENVIADA ao ERP não pode virar cópia (o arquivo está lá, e
--      apagar esse fato perde o rastro) — mas se ela não era a mais velha, o
--      grupo ficava sem portador elegível e a gêmea seguia viva, cobrando um
--      anexo que já existe. É o 5491400995 do cabeçalho.
--
-- Portador passa a ser escolhido por QUALIDADE, e quem já está no ERP manda.

/* ============================================================================
 *  1. O nome do arquivo, quando ele identifica alguma coisa
 * ========================================================================== */

-- `detalhe` guarda o nome do arquivo nas duas fontes, em formatos diferentes:
--   e-mail  → "remetente@x.com · NFSE_29009.pdf · lido por nome_arquivo"
--   Drive   → "2026-06-24_NFSE_29009.pdf"
--
-- NEM TODO NOME IDENTIFICA. "boleto takeat" aparece em três documentos de
-- R$ 2.330, R$ 39.100 e R$ 5.576 — colapsá-los seria dar por resolvido o que
-- segue sem nota. O corte é o mesmo que se usaria no olho: ou o nome carrega
-- uma corrida de 5+ dígitos (número da nota, chave, CNPJ, id do emissor), ou é
-- longo o bastante para carregar fornecedor e mês.
--
-- Medido contra o acervo: com esse corte, 218 grupos e 528 linhas se
-- reconhecem, e SÓ UM grupo junta CNPJs diferentes — `boleto_584820`, em que um
-- dos lados leu a linha digitável (`14850000019999`) achando que era CNPJ. É o
-- mesmo boleto, mesma data, mesmos R$ 199,99. Colapsar está certo lá também.
create or replace function public.nome_de_arquivo_da_nota(p_fonte text, p_detalhe text)
returns text
language sql
immutable
as $$
  select case
           when nome is null or length(nome) < 8 then null
           -- Sem número e curto: não identifica documento nenhum.
           when nome !~ '\d{5}' and length(nome) < 24 then null
           /* A ASSINATURA DO REMETENTE NÃO É DOCUMENTO. O Outlook manda as
              imagens da assinatura como anexo de verdade e elas herdam o valor
              lido no corpo — foi o defeito de R$ 1,43 M do cabeçalho da
              `gmail-nf-sync`. O filtro de lá exigia hexadecimal depois do
              prefixo e deixava passar `outlook-zy0juylv.png`; aqui basta o
              prefixo, porque agrupar decoração é pior que ignorá-la. */
           when nome ~ '^(image|imagem|logo|logotipo|logomarca|assinatura|signature|outlook|inline|icon|banner)[-_ ]'
             then null
           else nome
         end
    from (
      select nullif(btrim(lower(regexp_replace(regexp_replace(
               case
                 /* Só o anexo de verdade. "remetente · sem arquivo anexado" e
                    "remetente · comprovante de emissão lido do corpo do e-mail"
                    não têm nome de arquivo nenhum, e o sufixo `lido por` é o que
                    distingue um do outro. */
                 when p_fonte = 'email' and p_detalhe like '%· lido por %'
                   then split_part(p_detalhe, '·', 2)
                 when p_fonte like 'drive%'
                   then regexp_replace(coalesce(p_detalhe, ''), '^\d{4}-\d{2}-\d{2}[_ ]', '')
               end,
               '\.(pdf|xml|jpe?g|png|webp)\s*$', '', 'i'),
               '\s+', ' ', 'g'))), '') as nome
    ) t;
$$;

comment on function public.nome_de_arquivo_da_nota(text, text) is
  'O nome do arquivo de uma nota do e-mail ou do Drive, normalizado — e NULL quando o nome não identifica (curto, sem número, ou decoração de assinatura). É a identidade que sobra quando a chave fiscal só existe de um lado e o valor discorda por causa do ISS retido.';

/* ============================================================================
 *  2. Reconhecer o mesmo papel — e guardar a melhor leitura dele
 * ========================================================================== */

create or replace function public.notas_externas_marcar_copias()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n integer;
begin
  /* ZERA ANTES DE REMARCAR — e isto não é higiene, é a diferença entre uma
     função idempotente e uma que oscila.

     A escolha do portador olha para `valor`, `cnpj`, `tipo_documento` e
     `chave_fiscal`, e o ÚLTIMO PASSO DESTA MESMA FUNÇÃO escreve nessas colunas
     (o portador herda o que o grupo sabe). Na rodada seguinte o vencedor pode
     ser outro — e, sem zerar, o portador antigo vira cópia do copiado antigo
     enquanto este ainda aponta para ele. Medido em 28/08/2026, na primeira
     versão desta migration: 102 pares em ciclo A→B→A depois de duas rodadas, e
     um `coalesce(copia_de, id)` que já não sabia dizer qual era o grupo.

     Com o zeramento o grupo é recalculado inteiro a cada rodada e o resultado
     depende só do estado atual, não da ordem em que se chegou nele. Quem já
     subiu ao ERP não é zerado: aquele vínculo é registro do que aconteceu. */
  update public.notas_externas
     set copia_de = null, atualizado_em = now()
   where copia_de is not null
     and enviado_erp_em is null
     and ignorado_em is null;

  with base as (
    select id, fonte, chave_fiscal, moeda, valor_moeda, valor, cnpj, tipo_documento,
           enviado_erp_em, alvo_manual,
           public.numero_do_documento(coalesce(o_que_e, '') || ' ' || coalesce(detalhe, '')) as numero,
           public.nome_de_arquivo_da_nota(fonte, detalhe) as arquivo
      from public.notas_externas
     where ignorado_em is null
  ),
  /* O NÚMERO QUE O PAR (moeda, valor original) CONHECE. `count(distinct) = 1`
     é a guarda inteira: com dois números no mesmo par, ninguém empresta nada. */
  numero_do_par as (
    select moeda, valor_moeda,
           case when count(distinct numero) = 1 then min(numero) end as numero
      from base
     where moeda in ('USD', 'EUR') and valor_moeda is not null
     group by 1, 2
  ),
  /* A IDENTIDADE DO PAPEL, na ordem em que se confia:
       1. a chave fiscal, quando existe;
       2. moeda + valor ORIGINAL + número — o estrangeiro, que não tem chave;
       3. número + valor em real — o brasileiro sem chave. */
  identidade as (
    select b.*,
           coalesce(
             b.chave_fiscal,
             case when b.moeda in ('USD', 'EUR')
                   and b.valor_moeda is not null
                   and coalesce(b.numero, p.numero) is not null
                  then 'inv:' || b.moeda || '|' || b.valor_moeda::text
                       || '|' || coalesce(b.numero, p.numero) end,
             case when b.numero is not null
                  then 'doc:' || b.numero || '|' || coalesce(b.valor::text, '?') end
           ) as ident
      from base b
      left join numero_do_par p
             on p.moeda = b.moeda and p.valor_moeda = b.valor_moeda
  ),
  /* O NOME DO ARQUIVO É UMA PONTE, e não um quarto degrau da escada.
     Como degrau ele não serviria: só valeria para quem não tem chave nem
     número, que é justamente o lado que já se reconhecia sozinho. O caso que
     interessa é o oposto — o XML do e-mail lê a chave e o PDF espelhado do
     Drive não, então as duas metades do MESMO papel recebem identidades
     diferentes e nunca se encontram.

     A ponte é: cada nome de arquivo tem UMA identidade, a do melhor documento
     que carrega aquele nome, e toda linha com aquele nome passa a responder por
     ela. Uma atribuição só, sem passada seguinte — foi a sequência de duas
     passadas que abriu os ciclos. */
  arq_ident as (
    select distinct on (arquivo) arquivo, ident as ident_do_arquivo
      from identidade
     where arquivo is not null
     order by arquivo,
       (ident is not null) desc,
       (enviado_erp_em is not null) desc,
       (chave_fiscal is not null) desc,
       (coalesce(tipo_documento, 'nota') = 'nota') desc,
       (valor is not null) desc,
       id
  ),
  chaveada as (
    select i.*,
           coalesce(
             a.ident_do_arquivo,
             i.ident,
             case when i.arquivo is not null then 'arq:' || i.arquivo end
           ) as k
      from identidade i
      left join arq_ident a on a.arquivo = i.arquivo
  ),
  /* O PORTADOR É O MELHOR DOCUMENTO DO GRUPO, e não o mais velho.
     `min(id)` guardava o PDF espelhado do Drive e descartava o XML do e-mail,
     que é a leitura em campo próprio. */
  portador as (
    select distinct on (k) k, id, (enviado_erp_em is not null) as no_erp
      from chaveada
     where k is not null
     order by k,
       -- 1. quem já está no ERP manda: é lá que o arquivo está.
       (enviado_erp_em is not null) desc,
       -- 2. depois, quem uma pessoa confirmou.
       alvo_manual desc,
       -- 3. depois, quem leu melhor: chave em campo próprio, tipo, valor, CNPJ.
       (chave_fiscal is not null) desc,
       (coalesce(tipo_documento, 'nota') = 'nota') desc,
       (valor is not null) desc,
       (cnpj is not null) desc,
       -- 4. e o e-mail antes do Drive: XML e corpo contra OCR de PDF espelhado.
       (fonte = 'email') desc,
       id
  )
  update public.notas_externas n
     set copia_de = p.id, atualizado_em = now()
    from chaveada c
    join portador p on p.k = c.k
   where n.id = c.id
     and n.id <> p.id
     -- Nota já enviada não vira cópia: o arquivo dela está no ERP, e apagar
     -- esse fato para chamá-la de cópia perderia o rastro de quem subiu o quê.
     and n.enviado_erp_em is null
     /* E o que uma PESSOA apontou só cede para quem já está no ERP. Fora esse
        caso, virar cópia apagaria o alvo que ela escolheu à mão — e o carimbo
        `alvo_manual` só existe porque alguém abriu o documento no visor, ao
        lado da linha, e disse que era aquele. */
     and (not n.alvo_manual or p.no_erp)
     and n.copia_de is distinct from p.id;
  /* O NÚMERO QUE VOLTA É QUANTAS CÓPIAS EXISTEM, e não quantas mudaram — o
     zeramento lá em cima faz toda rodada remarcar o conjunto inteiro. Quem quer
     saber se algo mudou compara `copia_de` antes e depois; medido, a segunda
     rodada seguida não move nenhuma linha. */
  get diagnostics v_n = row_count;

  /* O PORTADOR HERDA O QUE O GRUPO SABE — ver `20260826260000`: em 51 de 164
     grupos o valor da nota morava só na cópia que era descartada. */
  with grupo as (
    select coalesce(c.copia_de, c.id) as portador_id,
           min(c.valor)     filter (where c.valor is not null)     as valor,
           min(c.cnpj)      filter (where c.cnpj is not null)      as cnpj,
           min(c.documento) filter (where c.documento is not null) as documento,
           min(c.chave_fiscal) filter (where c.chave_fiscal is not null) as chave_fiscal,
           bool_or(c.parece_nota)                                  as alguem_e_nota
      from public.notas_externas c
     where c.ignorado_em is null
     group by 1
    having count(*) > 1
  )
  update public.notas_externas n
     set valor     = coalesce(n.valor, g.valor),
         cnpj      = coalesce(n.cnpj, g.cnpj),
         documento = coalesce(n.documento, g.documento),
         /* A CHAVE TAMBÉM SE HERDA, desde agora. Nos 21 pares em que só o XML a
            leu, ela morria com a cópia — e é ela que faz o casamento por
            identidade na `notas_externas_casar`. */
         chave_fiscal = coalesce(n.chave_fiscal, g.chave_fiscal),
         tipo_documento = case
           when g.alguem_e_nota and coalesce(n.tipo_documento, 'nota') = 'outro' then 'nota'
           else n.tipo_documento
         end,
         atualizado_em = now()
    from grupo g
   where n.id = g.portador_id
     and (   (n.valor is null and g.valor is not null)
          or (n.cnpj is null and g.cnpj is not null)
          or (n.documento is null and g.documento is not null)
          or (n.chave_fiscal is null and g.chave_fiscal is not null)
          or (g.alguem_e_nota and coalesce(n.tipo_documento, 'nota') = 'outro'));

  return v_n;
end;
$function$;

comment on function public.notas_externas_marcar_copias() is
  'Junta as linhas que são o mesmo papel: por identidade (chave fiscal; moeda + valor original + número; número + valor) e, como ponte entre identidades que não se encontram, pelo NOME DO ARQUIVO — que é o que a mesma nota tem em comum ao chegar pela caixa e pela pasta "0. Gmail" do Drive. Atribuição ÚNICA por rodada, depois de zerar: sem isso a escolha do portador oscila e o grupo entra em ciclo. Portador = quem já está no ERP, depois o confirmado por gente, depois quem leu em campo próprio.';

/* ============================================================================
 *  3. A última porta antes do ERP
 * ========================================================================== */

-- Reconhecer a cópia conserta a causa; esta guarda é o que sobra quando o
-- reconhecimento falha. `conferencia` responde "o ERP tem?" lendo
-- `omie_titulo_anexo`, que é o cache do `ListarAnexo` e ATRASA — a nota que
-- subiu às 23:50 só aparece lá na varredura seguinte. Nesse intervalo a gêmea
-- ainda diz `falta_anexar` e a fila automática a levaria.
--
-- O que o Hub sabe na hora, sem perguntar ao Omie, é que uma cópia dela já
-- subiu. É essa a pergunta aqui.
create or replace function public.notas_externas_enfileirar(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.notas_externas ne
     set fila_erp = true, erro_erp = null, atualizado_em = now()
   where ne.id = any(p_ids)
     and ne.enviado_erp_em is null
     and ne.ignorado_em is null
     and ne.alvo_tipo is not null
     and ne.conferencia in ('falta_anexar', 'promessa_falsa')
     and ne.tem_arquivo
     and ne.copia_de is null
     /* A GUARDA DO PAPEL, e a excecao de quem olhou.
        `parece_nota` sai do nome do arquivo e impede a maquina de anexar boleto,
        recibo ou logotipo onde se cobra nota fiscal. Contra `alvo_manual` ela
        nao vale: esse carimbo so existe quando alguem abriu o documento no
        visor, ao lado da linha, e disse que e este. */
     and (ne.parece_nota or ne.alvo_manual)
     /* E NÃO SE MANDA O QUE UMA CÓPIA MINHA JÁ MANDOU. Mesmo papel, mesmo
        título, dois anexos iguais — que é justamente o que a conferência existe
        para evitar, e o que ela deixa passar enquanto o cache do ListarAnexo
        não alcança o envio de ontem à noite. */
     and not exists (
       select 1 from public.notas_externas irma
        where irma.enviado_erp_em is not null
          and irma.id <> ne.id
          and coalesce(irma.copia_de, irma.id) = coalesce(ne.copia_de, ne.id)
     );
  get diagnostics v_n = row_count;

  /* No CARTÃO a nota também vale localmente, e é o que tira a linha do "SEM NF"
     — lá a coluna guarda o link de onde a nota estiver, e não uma afirmação
     sobre o ERP. */
  update public.auditoria_cartao_lancamentos a
     set status_nf = 'OK',
         link_comprovante = nt.link,
         arquivo_comprovante = coalesce(a.arquivo_comprovante, nt.fonte || coalesce(' · linha ' || nt.linha, '')),
         updated_at = now()
    from public.notas_externas nt
   where nt.id = any(p_ids)
     and nt.alvo_tipo = 'cartao'
     and nt.tem_arquivo and (nt.parece_nota or nt.alvo_manual)
     and a.id_unico = nt.alvo_id_unico
     and coalesce(a.status_nf, '') <> 'OK'
     and coalesce(a.link_comprovante, '') = '';

  return v_n;
end;
$$;

/* ============================================================================
 *  4. Permissões
 * ========================================================================== */

-- Função nova nasce chamável SEM LOGIN, e revogar de `anon` sozinho não resolve:
-- o EXECUTE vem do grant implícito para PUBLIC. Revoga-se dos dois, e cada
-- instrução na sua linha.
revoke all on function public.nome_de_arquivo_da_nota(text, text) from public;
revoke all on function public.nome_de_arquivo_da_nota(text, text) from anon;
grant execute on function public.nome_de_arquivo_da_nota(text, text) to authenticated, service_role;

revoke all on function public.notas_externas_marcar_copias() from public;
revoke all on function public.notas_externas_marcar_copias() from anon;
grant execute on function public.notas_externas_marcar_copias() to service_role;

revoke all on function public.notas_externas_enfileirar(bigint[]) from public;
revoke all on function public.notas_externas_enfileirar(bigint[]) from anon;
grant execute on function public.notas_externas_enfileirar(bigint[]) to authenticated, service_role;
