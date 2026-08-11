// Edge Function: demonstracoes-ebitda-ajuste
//
// Registra a decisão sobre um candidato a ajuste de EBITDA (aceitar / não é
// ajuste), inclui um ajuste avulso, edita ou remove — e já reescreve a linha
// "EBITDA Ajustado" no blob da DRE na mesma chamada.
//
// Por que passa por função em vez de o cliente escrever direto na tabela: é o
// mesmo motivo do valor manual. Gravar a decisão sem reescrever o blob deixaria
// a tabela dizendo uma coisa e a DRE (e a IA, que lê o blob) mostrando outra até
// alguém sincronizar. E o número vira análise que sai da empresa — precisa de
// autor registrado.
//
// A LISTA de candidatos NÃO passa por aqui: é a RPC `ebitda_ajuste_candidatos`,
// chamada direto pela tela. Candidato é derivado do cache do Omie e muda quando
// o cache muda; só a decisão é durável.
//
// Body:
//   { acao: "decidir", col_key, cod_titulo | (grupo + cods[]),
//     status: "aceito"|"recusado",
//     valor, descricao, valor_lancamento?, rubrica?, contraparte?, data?,
//     regra?, motivo_sugestao? }
//   { acao: "manual",   col_key, valor, descricao, rubrica? }
//   { acao: "editar",   id, valor?, descricao? }
//   { acao: "remover",  id }
//   { acao: "recalcular" }  — só reescreve a linha, sem decidir nada

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { aplicarEbitdaAjustado, erroDoAjuste, type Dados } from "../_shared/ebitda-ajustado.ts";
import { recalcularDerivadas } from "../_shared/derivadas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const mesValido = (c: string) => /^[A-Za-z]{3}-\d{2}$/.test(c);

/**
 * Mensagem legível de QUALQUER coisa lançada.
 *
 * Um erro do PostgREST (`{message, details, hint, code}`) é objeto CRU, não uma
 * instância de `Error` — então `e instanceof Error ? e.message : String(e)`
 * caía no `String(e)` e produzia "[object Object]". Foi isso que escondeu,
 * durante toda a vida da linha, um 42P10 no upsert da decisão: a tela dizia
 * "Não consegui salvar: [object Object]" e o log da função dizia 200.
 */
function textoDoErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const partes = [o.message, o.details, o.hint]
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .join(" · ");
    if (partes) return o.code ? `${partes} (${o.code})` : partes;
    try { return JSON.stringify(e); } catch { /* objeto circular */ }
  }
  return String(e);
}

/* O add-back do "salto" sai da mediana e chega com três casas. O blob guarda em
   centavos; sem arredondar aqui, a soma da linha não fecharia com os itens. */
const cent = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const acao = String(body?.acao ?? "decidir");

    const autor = { autor: caller.userId, autor_email: caller.email ?? null };
    const agora = new Date().toISOString();

    /* O mês que ESTA chamada mexeu. Só nele os derivados são refeitos: um ajuste
       em Jul não pode reescrever o total de Jun, que já está fechado. Fica null
       no "recalcular", que não decide nada — ali `aplicarEbitdaAjustado` já
       reescreve as duas linhas dele e mais nada precisa mudar. */
    let mesAfetado: string | null = null;
    /** O mês de um ajuste já gravado — para "editar" e "remover", que vêm por id. */
    const mesDoAjuste = async (id: string): Promise<string | null> => {
      const { data } = await supabase
        .from("demonstracoes_ebitda_ajuste").select("col_key").eq("id", id).maybeSingle();
      return data?.col_key ? String(data.col_key) : null;
    };

    if (acao === "decidir") {
      const colKey = String(body?.col_key ?? "").trim();
      const codTitulo = String(body?.cod_titulo ?? "").trim();
      /* Decisão sobre um CONJUNTO de lançamentos: o Datadog que chegou em seis
         cobranças, a Inhire em cinco licenças. Uma linha só, com `cods` dizendo
         de que ela é feita — é o que impede a tela de oferecer o mesmo gasto
         outra vez, agora solto. Ver a migration 20260811190000. */
      const grupo = String(body?.grupo ?? "").trim();
      const cods = Array.isArray(body?.cods)
        ? (body.cods as unknown[]).map((c) => String(c).trim()).filter(Boolean)
        : [];
      const status = body?.status === "recusado" ? "recusado" : "aceito";
      const descricao = String(body?.descricao ?? "").trim();
      const valor = Number(body?.valor);

      if (!mesValido(colKey)) return json({ error: `mês inválido: ${colKey}` }, 200);
      mesAfetado = colKey;
      if (!codTitulo && !grupo) return json({ error: "cod_titulo ou grupo obrigatório." }, 200);
      if (codTitulo && grupo) return json({ error: "a decisão é sobre um título OU sobre um grupo, não os dois." }, 200);
      // Grupo sem os títulos por trás seria um número sem origem — e a tela
      // voltaria a oferecer os mesmos lançamentos soltos na abertura seguinte.
      if (grupo && cods.length < 2) return json({ error: "um grupo precisa de pelo menos dois lançamentos." }, 200);
      // A descrição é o ajuste. Sem ela sobra um número que ninguém sabe
      // defender seis meses depois, que é exatamente o que a linha existe para
      // evitar. Recusar não precisa — "não é ajuste" já se explica.
      if (status === "aceito" && !descricao) {
        return json({
          error: grupo
            ? "diga por que estas cobranças não se repetem."
            : "diga por que este lançamento não se repete.",
        }, 200);
      }

      const lancamento = Number.isFinite(Number(body?.valor_lancamento)) ? cent(Number(body.valor_lancamento)) : null;
      /* O ajuste pode ser só um PEDAÇO do lançamento — a fatura atrasada de R$ 40
         mil cuja competência do mês era R$ 6,5 mil. O que não pode é passar do
         lançamento nem trocar de sinal, que é como um dedo errado no teclado
         viraria EBITDA Ajustado melhor que a realidade.
         O `valor_lancamento` vem da tela (como rubrica e contraparte já vinham):
         serve contra erro de digitação, não contra cliente adulterado. */
      if (status === "aceito") {
        const erro = erroDoAjuste(lancamento, valor);
        if (erro) return json({ error: erro }, 200);
      }

      /* `onConflict` aponta para `demonstracoes_ebitda_ajuste_titulo_uk` (ou
         `..._grupo_uk`), e os dois PRECISAM ser unique index CHEIOS. Enquanto o
         de título foi parcial (`where cod_titulo is not null`) o Postgres se
         recusou a inferi-lo e devolveu 42P10 em toda decisão — ver as migrations
         20260806220000 e 20260811190000. */
      const { error } = await supabase.from("demonstracoes_ebitda_ajuste").upsert({
        col_key: colKey,
        cod_titulo: codTitulo || null,
        grupo: grupo || null,
        cods: grupo ? cods : null,
        status,
        origem: "sugestao",
        rubrica: body?.rubrica ? String(body.rubrica) : null,
        contraparte: body?.contraparte ? String(body.contraparte) : null,
        data: body?.data ? String(body.data) : null,
        valor_lancamento: lancamento,
        valor: Number.isFinite(valor) ? cent(valor) : 0,
        descricao: descricao || "Não é ajuste",
        regra: body?.regra ? String(body.regra) : null,
        motivo_sugestao: body?.motivo_sugestao ? String(body.motivo_sugestao) : null,
        ...autor,
        decidido_em: agora,
        atualizado_em: agora,
      }, { onConflict: grupo ? "col_key,grupo" : "col_key,cod_titulo" });
      if (error) throw error;

    } else if (acao === "manual") {
      const colKey = String(body?.col_key ?? "").trim();
      const descricao = String(body?.descricao ?? "").trim();
      const valor = Number(body?.valor);

      if (!mesValido(colKey)) return json({ error: `mês inválido: ${colKey}` }, 200);
      mesAfetado = colKey;
      if (!descricao) return json({ error: "descreva o ajuste." }, 200);
      if (!Number.isFinite(valor) || valor === 0) return json({ error: "valor do ajuste inválido." }, 200);

      const { error } = await supabase.from("demonstracoes_ebitda_ajuste").insert({
        col_key: colKey,
        cod_titulo: null,
        status: "aceito",
        origem: "manual",
        rubrica: body?.rubrica ? String(body.rubrica) : null,
        valor: cent(valor),
        descricao,
        ...autor,
        decidido_em: agora,
        atualizado_em: agora,
      });
      if (error) throw error;

    } else if (acao === "editar") {
      const id = String(body?.id ?? "").trim();
      if (!id) return json({ error: "id obrigatório." }, 200);
      mesAfetado = await mesDoAjuste(id);
      const patch: Record<string, unknown> = { ...autor, atualizado_em: agora };
      if (body?.descricao !== undefined) {
        const d = String(body.descricao).trim();
        if (!d) return json({ error: "a descrição não pode ficar vazia." }, 200);
        patch.descricao = d;
      }
      if (body?.valor !== undefined) {
        const v = cent(Number(body.valor));
        /* Aqui o lançamento vem do BANCO, não da tela: foi gravado quando o
           ajuste foi aceito. É a checagem mais firme das duas — e é a que segura
           o caso de uso desta ação, que é reduzir um ajuste já aceito para só a
           parte que não se repete. */
        const { data: atual, error: leErr } = await supabase
          .from("demonstracoes_ebitda_ajuste")
          .select("valor_lancamento")
          .eq("id", id)
          .maybeSingle();
        if (leErr) throw leErr;
        if (!atual) return json({ error: "ajuste não encontrado." }, 200);
        const erro = erroDoAjuste(
          atual.valor_lancamento == null ? null : Number(atual.valor_lancamento), v,
        );
        if (erro) return json({ error: erro }, 200);
        patch.valor = v;
      }
      const { error } = await supabase.from("demonstracoes_ebitda_ajuste").update(patch).eq("id", id);
      if (error) throw error;

    } else if (acao === "remover") {
      const id = String(body?.id ?? "").trim();
      if (!id) return json({ error: "id obrigatório." }, 200);
      mesAfetado = await mesDoAjuste(id); // antes de apagar, senão some com a linha
      const { error } = await supabase.from("demonstracoes_ebitda_ajuste").delete().eq("id", id);
      if (error) throw error;

    } else if (acao !== "recalcular") {
      /* "recalcular" não decide nada: cai direto na reescrita abaixo. Existe
         porque a linha é DERIVADA e quem escreve o blob precisa saber refazê-la
         — e nem todo escritor sabe (o omie-sync do cron, por exemplo, pode estar
         numa versão anterior a esta regra). A tela da DRE compara o que está no
         blob com EBITDA + ajustes e chama isto só quando de fato divergiu. */
      return json({ error: `ação desconhecida: ${acao}` }, 200);
    }

    /* ---------------- reescreve a linha no blob ----------------
     * Só a DRE tem EBITDA. As duas linhas são derivadas e refeitas do zero, por
     * isso basta reler o blob como ele está — não há delta a preservar. */
    const { data: blobRow, error: blobErr } = await supabase
      .from("demonstracoes_contabeis")
      .select("dados")
      .eq("tipo", "dre").eq("periodo", "completo")
      .maybeSingle();
    if (blobErr) throw blobErr;

    const bruto: Dados = (blobRow?.dados as Dados) ?? { columns: [], rows: [] };
    const comAjustado = await aplicarEbitdaAjustado(supabase, "dre", bruto);
    // A margem do EBITDA Ajustado sai da linha que acabou de mudar — só no mês
    // desta decisão, nunca nos outros, que podem estar fechados.
    const dados = recalcularDerivadas("dre", comAjustado, new Set(mesAfetado ? [mesAfetado] : []));

    const { error: upErr } = await supabase.from("demonstracoes_contabeis")
      .upsert({ tipo: "dre", periodo: "completo", dados, pdf_path: null }, { onConflict: "tipo,periodo" });
    if (upErr) throw upErr;

    return json({ ok: true, acao });
  } catch (e) {
    const msg = textoDoErro(e);
    // O objeto inteiro no log, não só a mensagem: `details`/`hint` do Postgres
    // é o que diz QUAL constraint reclamou.
    console.error("demonstracoes-ebitda-ajuste error:", msg, e);
    return json({ error: msg }, 200);
  }
});
