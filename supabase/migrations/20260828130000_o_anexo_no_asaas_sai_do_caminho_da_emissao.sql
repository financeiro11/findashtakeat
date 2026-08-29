/* ============================================================================
 * O ANEXO NO ASAAS SAI DO CAMINHO DA EMISSÃO.
 *
 * O QUE ESTAVA ACONTECENDO, medido em 28/08/2026 às 11h30. A emissão anda a 20
 * notas por rodada, de 10 em 10 minutos. O anexo da nota na cobrança do Asaas
 * andava a 5 — `limite_anexo: 5` no corpo do cron do espelho. Cada rodada abria
 * um buraco de 15, e o buraco só cresce:
 *
 *     28/08: 151 notas emitidas, 45 anexadas  (5 × 9 rodadas, exatamente)
 *     27/08:  20 notas emitidas, 10 anexadas  — e as outras 10 nunca anexaram
 *     acumulado sem arquivo na cobrança: 116
 *
 * O 27/08 é o caso que explica o desenho. O cron do espelho roda com
 * `so_se_houver_forno: true` e SAI ANTES DO ANEXO quando não há nota em '001'.
 * Ou seja: quando a emissão para (ao bater o teto do dia), o anexo para junto —
 * e o que não coube nos 5 daquela rodada não é anexado nunca mais. A fila do
 * anexo não drena; ela só acumula enquanto se emite e congela quando se para.
 *
 * ---------------------------------------------------------------------------
 * A DECISÃO: TIRAR, NÃO ACELERAR.
 *
 * A saída óbvia era subir `limite_anexo` para 20 e fazer o espelho rodar também
 * quando houvesse anexo pendente. Foi o que propus. A decisão foi outra, e é a
 * decisão certa: **o anexo é entrega redundante e não pode segurar a emissão.**
 *
 * O cliente já recebe a nota por e-mail — `cEnvLink: "S"` no bloco Email da OS,
 * ligado em 25/08/2026, com o link da nota pelo Portal Omie. Em agosto: 224 de
 * 226 notas com e-mail marcado (as 2 de fora são de 20/08, anteriores à chave).
 * Hoje, 151 de 151. A entrega ao cliente está coberta pelo canal que o próprio
 * ERP mantém; o anexo era o segundo caminho para a mesma coisa.
 *
 * O QUE SE PERDE, dito por inteiro para não virar surpresa: o e-mail do Omie
 * leva o LINK da nota (o PDF só viaja junto se o cadastro do cliente estiver
 * configurado para anexar), e o XML não vai por ele. Quem quiser o XML — a
 * contabilidade do cliente — vai pedir. O XML continua guardado em
 * `nf_os_omie.nfse_xml` e continua entregável a pedido pela porta abaixo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `anexar: false` NO CORPO DO CRON, E NÃO DELETAR O CÓDIGO.
 *
 * A guarda `body?.anexar === false` já existe na edge function, e a ação
 * `anexar_nota` é porta própria: aceita `ids` e anexa sob demanda. Então isto
 * aqui não remove capacidade nenhuma — remove o anexo do CAMINHO CRÍTICO. Quem
 * quiser mandar o arquivo de uma nota específica continua mandando; o que deixa
 * de existir é o anexo competindo por relógio com o que fecha o desfecho fiscal.
 *
 * Bônus de relógio: o anexo tinha 25s reservados dentro do espelho
 * (`prazoMs: 25_000`). Some dos 150s da Edge Function, que é a janela onde o
 * espelho de verdade — ler status e fechar recusa no diário — precisa caber.
 *
 * ---------------------------------------------------------------------------
 * A REESCRITA É CIRÚRGICA e recusa-se a errar calada. Ela não remonta o comando
 * do cron: pega o comando que está no banco e troca SÓ o literal do corpo, o
 * que preserva a anon key exatamente como está gravada (ver a nota em
 * `20260827230000`). Se o corpo esperado não for encontrado — porque alguém
 * mexeu no cron desde a medição —, a migration ABORTA em vez de reagendar um
 * comando que ela não entendeu.
 * ========================================================================== */

do $do$
declare
  r        record;
  v_novo   text;
  v_corpo  text;
  v_feitos int := 0;
begin
  for r in
    select j.jobid, j.jobname, j.schedule, j.command,
           a.corpo_novo
      from cron.job j
      join (values
        ('nf-espelho-rodada',
         '{"action":"espelhar","teto_status":40,"so_se_houver_forno":true,"anexar":false}'),
        ('nf-espelho-tarde',
         '{"action":"espelhar","teto_status":80,"anexar":false}')
      ) as a(nome, corpo_novo) on a.nome = j.jobname
     order by j.jobname
  loop
    -- O corpo é o único literal `'{...}'::jsonb` do comando: os headers vêm de
    -- `jsonb_build_object(...)`, que não casa com este padrão.
    v_corpo := substring(r.command from '''(\{[^'']*\})''::jsonb');

    if v_corpo is null then
      raise exception
        'Cron % : não achei o corpo jsonb no comando. Nada foi reagendado.', r.jobname;
    end if;

    -- Guarda o comando de antes. `do nothing` de propósito: se já houver cópia
    -- (a de 27/08), ela é a mais antiga e é ela que vale como caminho de volta.
    insert into public.automacao_comando_antigo (jobname, comando, schedule)
    values (r.jobname, r.command, r.schedule)
    on conflict (jobname) do nothing;

    v_novo := replace(r.command, '''' || v_corpo || '''', '''' || r.corpo_novo || '''');

    if v_novo = r.command then
      raise exception
        'Cron % : a troca do corpo não mudou nada (corpo lido: %). Nada foi reagendado.',
        r.jobname, v_corpo;
    end if;

    perform cron.schedule(r.jobname, r.schedule, v_novo);
    v_feitos := v_feitos + 1;
    raise notice 'Cron % : corpo % -> %', r.jobname, v_corpo, r.corpo_novo;
  end loop;

  if v_feitos <> 2 then
    raise exception 'Esperava reescrever 2 crons do espelho, reescrevi %.', v_feitos;
  end if;
end
$do$;
