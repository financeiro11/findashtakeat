/* ============================================================================
 * O AVISO DE RECUSA DISPARAVA SEM CRACHÁ — e o conserto já tinha dono.
 *
 * Os dois crons criados em `20260901160000` foram escritos à mão assim:
 *
 *     select public.disparar_automacao('nf-recusas-avisar', '<url>', '<body>');
 *
 * Três argumentos. O quarto — `p_token_nome` — ficou de fora, e é ele que faz
 * `disparar_automacao` montar o cabeçalho `x-cron-token`. Sem token e sem
 * `Authorization`, `chamadaDeCron` devolve false, a função não acha usuário
 * nenhum e responde **HTTP 401 `{"erro":"Não autenticado."}`**. Foi o que os
 * dois fizeram todo dia desde 01/09, com a faixa vermelha acesa.
 *
 * É EXATAMENTE O DEFEITO DE `20260827450000` E DE `20260829170000` — a terceira
 * vez que o mesmo argumento ausente derruba um cron novo. O que muda de vez:
 * cron que chama Edge Function **nunca** se escreve à mão neste repo. Clona-se
 * um que já funciona, porque o comando também carrega a anon key, e chave não se
 * versiona em arquivo. Escrever do zero é ter de lembrar de duas coisas; clonar
 * é não ter de lembrar de nenhuma.
 *
 * ---------------------------------------------------------------------------
 * 1) `nf-recusas-consertar` NÃO GANHA TOKEN: ELE SAI.
 *
 * Ele foi criado para consertar cadastro antes do aviso das 11:30. Só que esse
 * dever já tem dono desde 29/08: `nf-corrigir-recusados` faz a MESMA chamada
 * (`omie-clientes-criar` / `corrigir_recusados`) de duas em duas horas, aos :50
 * — e portanto às **10:50 UTC**, quarenta minutos antes do e-mail. O aviso já
 * nasce sabendo o que foi consertado; nunca deixou de nascer.
 *
 * Dar token ao duplicado só faria a fila de recusadas ser varrida duas vezes na
 * mesma hora, gastando BrasilAPI (que limita por IP, e é o motivo de o teto por
 * rodada ser 15) para achar o que a rodada anterior já corrigiu. Dois crons com
 * a mesma ordem é a próxima pessoa mexendo no que não está ligado.
 *
 * ---------------------------------------------------------------------------
 * 2) `nf-recusas-avisar` É ÚNICO E FICA — clonado de `nf-emissao-diaria`, que
 * chama a MESMA função (`omie-nfse-sync`) e por isso já tem o token certo.
 * Trocam-se só duas coisas: o nome do job (que é o que `automacao_execucao`
 * carimba, e o painel casa com `cron.job.jobname`) e o corpo.
 *
 * Se o modelo não existir ou a troca não produzir o comando esperado, ABORTA. Um
 * cron meio montado é pior do que o cron quebrado que já está lá: este pelo
 * menos aparece vermelho.
 * ========================================================================== */

do $do$
declare
  modelo text;
  novo   text;
begin
  /* ---- 1) o duplicado sai ---------------------------------------------- */
  if exists (select 1 from cron.job where jobname = 'nf-corrigir-recusados') then
    if exists (select 1 from cron.job where jobname = 'nf-recusas-consertar') then
      perform cron.unschedule('nf-recusas-consertar');
      raise notice 'nf-recusas-consertar removido: nf-corrigir-recusados já faz a mesma chamada às 10:50 UTC.';
    end if;
  else
    /* Sem o dono do dever, remover o duplicado deixaria o conserto órfão. */
    raise exception 'nf-corrigir-recusados não existe — nf-recusas-consertar não pode sair sem substituto.';
  end if;

  /* ---- 2) o aviso ganha o crachá --------------------------------------- */
  select command into modelo from cron.job where jobname = 'nf-emissao-diaria';
  if modelo is null then
    raise exception 'Não achei o cron `nf-emissao-diaria` para clonar o comando. `nf-recusas-avisar` fica como está.';
  end if;
  if position('''omie-nfse-sync''' in modelo) = 0 or position('x-cron-token' in modelo) > 0 then
    /* O token vai como ARGUMENTO (`p_token_nome`), não como header escrito no
       comando — quem monta o header é `disparar_automacao`, lendo o token na
       hora. Comando com `x-cron-token` no texto é do formato antigo. */
    raise exception 'O comando de `nf-emissao-diaria` não está no formato esperado. Nada foi reagendado.';
  end if;

  novo := replace(modelo, '''nf-emissao-diaria''', '''nf-recusas-avisar''');
  novo := replace(
    novo,
    $b$'{"action":"emitir_dia"}'::jsonb$b$,
    $b$'{"action":"alerta_recusas","enviar":true,"dias":45}'::jsonb$b$
  );

  if novo = modelo then
    raise exception 'A troca não mudou nada (nome + corpo). Nada foi reagendado.';
  end if;
  if position('nf-recusas-avisar' in novo) = 0
     or position('alerta_recusas' in novo) = 0
     or position('nf-emissao-diaria' in novo) > 0
     or position('emitir_dia' in novo) > 0 then
    raise exception 'O comando gerado não é o esperado. Nada foi reagendado.';
  end if;

  /* 11:30 UTC = 8h30 de Brasília, depois da janela de emissão do dia anterior
     (13–21 UTC): o retrato é de um dia fechado. O horário não muda. */
  perform cron.schedule('nf-recusas-avisar', '30 11 * * *', novo);
  raise notice 'nf-recusas-avisar reagendado com o token `omie-nfse-sync`.';
end
$do$;
