/* ============================================================================
 * O CONSERTO DAS RECUSADAS GANHA RITMO — mais rodadas, mesmo teto.
 *
 * Depois que a fila passou a enxergar as três fontes (`20260829140000`), ela
 * saltou de 18 para 183 clientes. O conserto, porém, continuou rodando UMA VEZ
 * POR DIA, pendurado dentro da ação `criar` do cron das 12:45 UTC, e a 15
 * clientes por rodada. Isso é onze dias para drenar o que a fila enxerga hoje —
 * e a fila cresce com o histórico que ainda vai entrar.
 *
 * A ESCOLHA É MAIS RODADAS, NÃO RODADA MAIOR, e a razão é o limite de terceiro.
 * Cada cliente custa duas chamadas externas (ConsultarCliente no Omie + Receita
 * na BrasilAPI), e a BrasilAPI limita por IP — é justamente esse limite que
 * obrigou a existir o plano B por raspagem, que custa crédito de Firecrawl.
 * Subir o teto por rodada concentra a pancada numa janela; espalhar em mais
 * rodadas mantém a mesma carga instantânea que já se sabe que funciona.
 *
 *   antes:   1 rodada/dia  × 15 =  15 clientes/dia
 *   agora:  12 rodadas/dia × 15 = 180 clientes/dia
 *
 * De onze dias para pouco menos de um.
 *
 * ---------------------------------------------------------------------------
 * DE DUAS EM DUAS HORAS, AOS :50, e os dois vizinhos explicam o horário:
 *
 *   :20 de toda hora → `nf-preparar-cadastros` (o preventivo, 20 clientes)
 *   12:45 UTC        → `omie-clientes-criar-diario` (que já faz um conserto)
 *
 * Aos :50 de hora par não encosta em nenhum dos dois, e deixa meia hora de
 * folga do preventivo — que é quem mais consome a BrasilAPI.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO EMITE NADA, e a garantia não é a boa intenção: a ação
 * `corrigir_recusados` só chama `aplicarCorrecao`, que escreve CADASTRO. Quem
 * emite é a `omie-nfse-sync`, que continua com `emissao_automatica = 'off'` —
 * desligada para o cron E para o botão da tela desde 28/08. Esta migration não
 * toca em `nf_config`.
 *
 * O alvo da escrita segue governado por `cadastro_auto` (hoje `omie`): só o ERP.
 * Escrever também no Asaas continua sendo uma decisão separada, na tela.
 *
 * ---------------------------------------------------------------------------
 * O COMANDO É CLONADO, não escrito à mão. Copia-se o de `nf-preparar-cadastros`
 * — que já passa por `disparar_automacao` e já carrega a anon key correta — e
 * troca-se só o nome do job e o corpo. Reescrever o comando do zero exigiria
 * versionar a chave neste arquivo, e foi a razão de a migration de 27/08 ter
 * feito o mesmo. Se o modelo não for encontrado, ABORTA: um cron novo com
 * comando meio montado é pior do que nenhum.
 * ========================================================================== */

do $do$
declare
  modelo text;
  novo   text;
begin
  select command into modelo from cron.job where jobname = 'nf-preparar-cadastros';
  if modelo is null then
    raise exception 'Não achei o cron `nf-preparar-cadastros` para clonar o comando. Nada foi agendado.';
  end if;

  -- Troca o nome do job registrado em `disparar_automacao` e o corpo.
  novo := replace(modelo, '''nf-preparar-cadastros''', '''nf-corrigir-recusados''');
  novo := replace(
    novo,
    'jsonb_build_object(''action'', ''preparar'', ''teto'', 20, ''operador'', ''cron'')',
    'jsonb_build_object(''action'', ''corrigir_recusados'', ''operador'', ''cron'')'
  );

  if novo = modelo then
    raise exception 'O comando modelo não tem a forma esperada (nome + corpo). Nada foi agendado.';
  end if;
  if novo not like '%corrigir_recusados%' or novo not like '%nf-corrigir-recusados%' then
    raise exception 'A troca não produziu o comando esperado. Nada foi agendado.';
  end if;

  perform cron.schedule('nf-corrigir-recusados', '50 */2 * * *', novo);
  raise notice 'Agendado nf-corrigir-recusados: 50 */2 * * * (12 rodadas/dia)';
end
$do$;
