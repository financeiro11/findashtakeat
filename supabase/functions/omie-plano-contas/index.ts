// Edge Function: omie-plano-contas
//
// Cria e renomeia CATEGORIAS do Omie a partir de Governança › Plano de contas.
// (Trocar a categoria de um LANÇAMENTO é outra função: omie-trocar-categoria.)
//
// A ordem é a mesma da troca de categoria, e pelo mesmo motivo:
//   1. escreve no OMIE — se ele recusar, nada muda no Hub;
//   2. espelha no cache local (`omie_cache` chave 'categorias') SEM repuxar a
//      lista inteira: duas `ListarCategorias` iguais em menos de 60s são
//      "consumo redundante", e a décima recusa bloqueia o método por 30 min.
//      A sincronização diária repuxa tudo e reconcilia;
//   3. no RENOMEAR, leva o nome novo às tabelas que casam categoria pela
//      DESCRIÇÃO — DE-PARA da DRE/DFC, Orçamento, folha, Cartão. Sem isso a
//      categoria sairia da DRE calada;
//   4. registra em `omie_categoria_cadastro_log`.
//
// Ações (body.action):
//   "criar"     { superior, descricao, rubrica_dre?, rubrica_dfc?, motivo? }
//   "renomear"  { codigo, descricao, rubrica_dre?, rubrica_dfc?, motivo? }
//   "consultar" { codigo } — só leitura, direto do Omie
//
// O QUE A API DO OMIE FAZ DE VERDADE (medido em 15/09/2026, categoria de teste 2.04.90):
//   • IncluirCategoria cria, e o código quem escolhe é o Omie. A categoria nasce
//     SEM conta contábil e sem a DRE interna do Omie — a API não tem campo para a
//     conta contábil.
//   • AlterarCategoria renomeia. A leitura logo depois devolve o nome antigo por
//     um ou dois minutos; depois aparece o novo.
//   • DESATIVAR NÃO FUNCIONA PELA API. `conta_inativa: "S"` no AlterarCategoria
//     responde "Categoria alterada com sucesso!" e a categoria continua ativa —
//     testado duas vezes, a segunda sem nenhuma outra escrita por perto, e relido
//     depois de cinco minutos. O WSDL tem um tipo `categoria_inativar` que nenhuma
//     operação usa. Por isso "desativar" e "reativar" não chamam o Omie: um botão
//     que diz "desativada" e não desativa é pior do que botão nenhum.
//
// ACESSO: escrever no plano de contas do ERP exige a capacidade `conciliacao`
// (quem opera classificação: Auditoria, Notas no ERP, Cartão). VER a tela é
// `demonstracoes`. Renomear de um jeito que põe ou tira a categoria da folha
// exige também `remuneracao` — muda quem enxerga salário.
//
// Erro de negócio sai com HTTP 200 + { status: "erro" }: o `functions.invoke`
// esconde o corpo de resposta não-2xx, e o texto é o que a pessoa precisa ler.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { alterarCategoria, consultarCategoria, incluirCategoria, omieCall } from "../_shared/omie.ts";
import { AuthError, requireUser } from "../_shared/auth.ts";
import {
  chaveDescricao, ehFolha, ehPosicaoLivre, validarDescricao, validarGrupo, type CategoriaCadastro,
} from "../_shared/plano-contas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const erro = (mensagem: string) => json({ status: "erro", erro: mensagem });

const SEM_DESATIVAR =
  "O Omie não desativa nem reativa categoria pela API: ele responde “Categoria alterada com sucesso!” e a categoria " +
  "continua como estava (medido em 15/09/2026). Faça isso direto no Omie; o Hub acompanha na sincronização diária das categorias.";

/** O Omie devolve "<Disponível>" como "&lt;Disponível&gt;". */
const decodificar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

type Bruta = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const caller = await requireUser(req);
    if (!caller.pode("conciliacao")) {
      return erro("Criar ou alterar categoria no Omie exige a capacidade Conciliação. Peça a quem administra os perfis de acesso.");
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const motivo = body?.motivo ? String(body.motivo).slice(0, 500) : null;

    if (action === "desativar" || action === "reativar") return erro(SEM_DESATIVAR);

    /* ================= COBERTURA DE DEPARTAMENTOS (só leitura) =================
       Quantos títulos trazem distribuição por departamento? O cache de movimentos
       nunca pediu `cExibirDepartamentos`, então a pergunta só se responde no Omie.
       Uma página por chamada — filtre por conta e período, senão o extrato do Asaas
       (dezenas de milhares de linhas) enche a amostra. */
    if (action === "cobertura_departamentos") {
      const param: Record<string, unknown> = {
        nPagina: Math.max(1, Number(body?.pagina ?? 1)),
        nRegPorPagina: Math.min(500, Math.max(20, Number(body?.por_pagina ?? 500))),
        // `exibir_departamentos: false` existe para medir o custo do parâmetro: com ele
        // ligado o Omie devolveu 100 por página quando se pediram 500.
        ...(body?.exibir_departamentos === false ? {} : { cExibirDepartamentos: "S" }),
      };
      if (body?.nCodCC) param.nCodCC = Number(body.nCodCC);
      if (body?.de) param.dDtRegDe = String(body.de);
      if (body?.ate) param.dDtRegAte = String(body.ate);
      const r = await omieCall<any>("financas/mf", "ListarMovimentos", param);
      const movs = (r?.movimentos ?? []) as Bruta[];
      const titulos = movs.filter((m) => m?.detalhes?.nValorTitulo != null);
      const comDep = titulos.filter((m) => Array.isArray(m?.departamentos) && m.departamentos.length > 0);
      const porDep: Record<string, { n: number; valor: number }> = {};
      for (const m of comDep) {
        for (const d of m.departamentos) {
          const k = String(d?.cCodDepartamento ?? "?");
          porDep[k] ??= { n: 0, valor: 0 };
          porDep[k].n += 1;
          porDep[k].valor += Number(d?.nDistrValor ?? 0);
        }
      }
      const porOrigem: Record<string, { titulos: number; com_departamento: number }> = {};
      for (const m of titulos) {
        const o = String(m?.detalhes?.cOrigem ?? "?");
        porOrigem[o] ??= { titulos: 0, com_departamento: 0 };
        porOrigem[o].titulos += 1;
        if (Array.isArray(m?.departamentos) && m.departamentos.length) porOrigem[o].com_departamento += 1;
      }
      return json({
        status: "ok", pagina: param.nPagina, total_paginas: r?.nTotPaginas ?? null, total_registros: r?.nTotRegistros ?? null,
        movimentos: movs.length, titulos: titulos.length, titulos_com_departamento: comDep.length,
        rateados: comDep.filter((m) => m.departamentos.length > 1).length,
        por_departamento: porDep, por_origem: porOrigem,
        exemplos: comDep.slice(0, 3).map((m) => ({ titulo: m.detalhes?.nCodTitulo, categoria: m.detalhes?.cCodCateg, departamentos: m.departamentos })),
      });
    }

    /* -------- O cadastro como o Hub o tem -------- */
    const { data: linha, error: cacheErr } = await supabase
      .from("omie_cache").select("dados").eq("chave", "categorias").maybeSingle();
    if (cacheErr) throw new Error(`Falha ao ler o plano de contas: ${cacheErr.message}`);
    const brutas = (Array.isArray(linha?.dados) ? linha!.dados : []) as Bruta[];
    const cadastro: CategoriaCadastro[] = brutas
      .filter((c) => c?.codigo)
      .map((c) => ({
        codigo: String(c.codigo),
        descricao: decodificar(String(c.descricao ?? "")),
        superior: c.categoria_superior ? String(c.categoria_superior) : null,
        totalizadora: c.totalizadora === "S",
        inativa: c.conta_inativa === "S",
      }));
    const bruta = (codigo: string) => brutas.find((c) => String(c?.codigo) === codigo);

    const aplicarNoCache = async (categoria: Bruta): Promise<string | null> => {
      const { error } = await supabase.rpc("omie_cache_categoria_aplicar", { p_categoria: categoria });
      if (error) {
        // O Omie já mudou — isto é o espelho. A sincronização diária conserta.
        console.error("cache de categorias não atualizado:", error.message);
        return error.message;
      }
      return null;
    };

    const registrar = async (linhaLog: Record<string, unknown>) => {
      const { error } = await supabase.from("omie_categoria_cadastro_log").insert({
        ...linhaLog,
        motivo,
        alterado_por: caller.userId,
        alterado_por_email: caller.email ?? null,
      });
      if (error) console.error("trilha do cadastro não gravada:", error.message);
    };

    /* DE-PARA pela DESCRIÇÃO, que é a chave do omie-sync. Sem ele uma categoria
       nova não aparece na DRE/DFC. */
    const gravarDePara = async (descricao: string) => {
      const dePara: Record<string, string> = {};
      let erroDePara: string | null = null;
      for (const [demonstrativo, campo] of [["dre", "rubrica_dre"], ["dfc", "rubrica_dfc"]] as const) {
        const rubrica = String(body?.[campo] ?? "").trim();
        if (!rubrica) continue;
        const { error } = await supabase.from("omie_dre_mapa").upsert(
          { codigo_categoria: descricao, descricao_categoria: descricao, rubrica, demonstrativo, ativo: true, updated_at: new Date().toISOString() },
          { onConflict: "codigo_categoria,demonstrativo" },
        );
        if (error) erroDePara = error.message; else dePara[demonstrativo] = rubrica;
      }
      return { dePara, erroDePara };
    };

    /* ================= CONSULTAR ================= */
    if (action === "consultar") {
      const codigo = String(body?.codigo ?? "").trim();
      if (!codigo) return erro("Informe o código da categoria.");
      return json({ status: "ok", omie: await consultarCategoria(codigo), cache: bruta(codigo) ?? null });
    }

    /* ================= CRIAR ================= */
    if (action === "criar") {
      const superior = String(body?.superior ?? "").trim();
      const g = validarGrupo(superior, cadastro);
      if (!g.ok) return erro(g.erro);
      const v = validarDescricao(String(body?.descricao ?? ""), cadastro);
      if (!v.ok) return erro(v.erro);

      const r = await incluirCategoria({ superior, descricao: v.descricao });
      const grupo = bruta(superior) ?? {};

      const nova: Bruta = {
        codigo: r.codigo,
        descricao: v.descricao,
        descricao_padrao: v.descricao,
        categoria_superior: superior,
        totalizadora: "N",
        conta_inativa: "N",
        // Receita/despesa vem do grupo: é o que o Omie faz com a categoria filha.
        conta_despesa: grupo.conta_despesa ?? (superior.startsWith("2") ? "S" : "N"),
        conta_receita: grupo.conta_receita ?? (superior.startsWith("1") ? "S" : "N"),
        transferencia: grupo.transferencia ?? "N",
        nao_exibir: "N",
        natureza: "",
        codigo_dre: "",
        tipo_categoria: "",
        id_conta_contabil: "",
      };
      const erroCache = await aplicarNoCache(nova);
      const { dePara, erroDePara } = await gravarDePara(v.descricao);

      await registrar({
        acao: "criar", codigo: r.codigo, superior, descricao_para: v.descricao,
        rubrica_dre: dePara.dre ?? null, rubrica_dfc: dePara.dfc ?? null, resposta_omie: r.bruto,
      });
      console.log(`categoria criada · ${r.codigo} · ${v.descricao} · em ${superior} · ${caller.email}`);

      return json({
        status: "ok", acao: "criar", codigo: r.codigo, descricao: v.descricao, superior,
        de_para: dePara, mensagem_omie: r.mensagem, erro_cache: erroCache, erro_de_para: erroDePara,
      });
    }

    /* ================= RENOMEAR ================= */
    if (action === "renomear") {
      const codigo = String(body?.codigo ?? "").trim();
      const atual = cadastro.find((c) => c.codigo === codigo);
      const raw = bruta(codigo);
      if (!atual || !raw) return erro(`A categoria ${codigo || "(sem código)"} não está no plano de contas do Hub. Atualize do Omie e tente de novo.`);
      if (atual.totalizadora) return erro("Grupos não são alterados por aqui — só as categorias dentro deles.");
      if (ehPosicaoLivre(atual.descricao)) {
        return erro("Esta é uma posição livre do Omie, desativada. Dar nome a ela não a reativa — e o Omie não reativa pela API. Crie uma categoria nova no grupo.");
      }

      const v = validarDescricao(String(body?.descricao ?? ""), cadastro, codigo);
      if (!v.ok) return erro(v.erro);
      if (v.descricao === atual.descricao) return erro("O nome novo é igual ao atual.");
      if (ehFolha(atual.descricao) !== ehFolha(v.descricao) && !caller.pode("remuneracao")) {
        return erro(
          ehFolha(atual.descricao)
            ? "Este nome tira a categoria da folha: os lançamentos dela (salários) passariam a aparecer para quem não vê a Remuneração. Só quem tem acesso à Remuneração pode fazer essa troca."
            : "Este nome põe a categoria na folha e esconde os lançamentos de quem não vê a Remuneração. Só quem tem acesso à Remuneração pode fazer essa troca.",
        );
      }

      // Os opcionais que a categoria já tem vão repetidos, para não serem apagados por omissão.
      const r = await alterarCategoria({
        codigo, descricao: v.descricao, natureza: raw.natureza, tipoCategoria: raw.tipo_categoria, codigoDre: raw.codigo_dre,
      });
      const erroCache = await aplicarNoCache({ codigo, descricao: v.descricao });

      let referencias: Record<string, number> | null = null;
      let erroReferencias: string | null = null;
      // Só a caixa/espaço mudou: a chave do Hub é a mesma, mas a grafia gravada acompanha.
      const { data, error } = await supabase.rpc("plano_contas_renomear_referencias", { p_de: atual.descricao, p_para: v.descricao });
      if (error) { erroReferencias = error.message; console.error("referências não renomeadas:", error.message); }
      else referencias = data as Record<string, number>;

      // Rubrica explícita (categoria que não tinha DE-PARA) vence a herdada.
      const { dePara, erroDePara } = await gravarDePara(v.descricao);

      await registrar({
        acao: "renomear", codigo, superior: atual.superior,
        descricao_de: atual.descricao, descricao_para: v.descricao, referencias, resposta_omie: r.bruto,
        rubrica_dre: dePara.dre ?? null, rubrica_dfc: dePara.dfc ?? null,
      });
      console.log(
        `categoria renomeada · ${codigo} · ${atual.descricao} → ${v.descricao} · ` +
        `${chaveDescricao(atual.descricao) === chaveDescricao(v.descricao) ? "só grafia · " : ""}${JSON.stringify(referencias)} · ${caller.email}`,
      );

      return json({
        status: "ok", acao: "renomear", codigo, de: atual.descricao, para: v.descricao,
        referencias, de_para: dePara, mensagem_omie: r.mensagem,
        erro_cache: erroCache, erro_referencias: erroReferencias, erro_de_para: erroDePara,
      });
    }

    return erro(`Ação desconhecida: ${action || "(vazia)"}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-plano-contas error:", msg);
    return json({ status: "erro", erro: msg }, e instanceof AuthError ? 401 : 200);
  }
});
