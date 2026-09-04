// Edge Function: cartao-fatura-rateio
//
// Lê o PDF da fatura do Sicoob e tira dele o que o .ofx não tem: **de quem é cada gasto**.
//
// O .ofx é o extrato CONSOLIDADO da conta — um `ACCTID` só, nenhuma coluna de portador.
// Por isso a fatura do líder em `/l/<token>` só mostrava o que a analista tinha rateado
// à mão: em ago/26, 201 linhas com dono de 640 do extrato. Medido em 03/09/2026, deduzir
// o dono pelo lojista erra feio — treinando em junho e testando contra a verdade de
// agosto, 45% de acerto na regra frouxa e 71% na mais conservadora. Um em cada três
// gastos iria para a página da pessoa errada, numa tela que serve para cobrar nota.
//
// O PDF, esse sim, vem dividido por portador ("PAULO C CHACARA — final 1020" e a lista
// de compras embaixo). É a fonte certa, e é a única que não exige chute.
//
// Body: {
//   drive?: string,        // id ou URL do PDF no Drive (a conta financeiro@ precisa enxergar)
//   base64?: string,       // ou o arquivo direto, quando vem de um upload na tela
//   nome?: string,
//   competencia: string,   // "2026-08" ou "2026-08-01" — a competência do extrato
//   gravar?: boolean       // padrão FALSE: sem isto, só relata o que faria
// }
// Devolve `{ tarefa: <uuid> }` na hora; o resultado aparece em `cartao_fatura_rateio`.
// Consultar: { tarefa: "<uuid>" }.
//
// POR QUE É TAREFA: ler ~30 páginas não cabe nos **150s até a primeira resposta**, que é
// teto de gateway em todo plano e não sobe. Medido: a chamada síncrona morreu em
// IDLE_TIMEOUT. O worker, esse sim, vive 400s no plano pago — então respondemos cedo e
// seguimos em `EdgeRuntime.waitUntil`.
//
// A gravação é deliberadamente opt-in. A leitura de um PDF de 30 páginas é boa, não é
// perfeita, e escrever dono errado é o único erro que esta função não pode cometer em
// silêncio — então o padrão é o ensaio, e quem confere decide.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { baixarComOAuthDoDrive } from "../_shared/drive.ts";
import {
  errorResponse, generateJSON, handleCors, jsonResponse, MODELOS_CASCATA,
} from "../_shared/gemini.ts";
import { podeGastarIA, registrarUsoIA } from "../_shared/ia-orcamento.ts";

/** Uint8Array → base64 em blocos: `fromCharCode(...bytes)` estoura a pilha num PDF de 5 MB. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const deBase64 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64.replace(/^data:[^;]+;base64,/, "")), (c) => c.charCodeAt(0));

/** Espaço colapsado e caixa alta — as duas bases escrevem a mesma compra com padding diferente. */
const chave = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/** "1.234,56" | "1234.56" | 1234.56 → 1234.56. O PDF vem em pt-BR, o schema aceita número. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return NaN;
  // Vírgula depois do último ponto = decimal brasileiro.
  const br = s.lastIndexOf(",") > s.lastIndexOf(".");
  return Number(br ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
}

/** "23/07/2026" | "23/07" | "2026-07-23" → "2026-07-23". Sem ano, usa o ano da competência. */
function data(v: unknown, anoBase: number): string | null {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const dia = m[1].padStart(2, "0");
  const mes = m[2].padStart(2, "0");
  let ano = m[3] ? Number(m[3]) : anoBase;
  if (ano < 100) ano += 2000;
  return `${ano}-${mes}-${dia}`;
}

const SISTEMA = `Você transcreve faturas de cartão de crédito corporativo do Sicoob.

A fatura é dividida em BLOCOS POR PORTADOR: cada bloco começa com o nome da pessoa e os
4 últimos dígitos do cartão dela, e abaixo vêm as compras daquele cartão.

Transcreva TODOS os blocos e TODAS as compras de cada bloco, sem resumir, sem agrupar e
sem pular linha nenhuma.

ATENÇÃO À VIRADA DE PÁGINA. Um bloco costuma atravessar várias páginas, e o cabeçalho do
portador pode reaparecer no alto da página seguinte ou não aparecer. Uma compra pertence ao
portador do último cabeçalho impresso ACIMA dela. Nunca continue um bloco depois que o
cabeçalho de OUTRO portador apareceu. Se você não tiver certeza de a qual bloco uma linha
pertence, mande-a em "sem_portador" — deixar de fora é sempre melhor que pôr no dono errado.

Se a fatura imprimir um subtotal do portador ("Total do cartão", "Subtotal"), copie-o em
"total_impresso". Ele é a conferência do bloco; se não houver, deixe vazio.

Regras:
- "descricao": só os PRIMEIROS 24 CARACTERES da descrição impressa, copiados como estão
  (com prefixos "DL*", "EBN*" etc.). Não escreva a descrição inteira — ela só serve para
  eu reconhecer a compra num extrato que já tenho.
- "final": só os 4 dígitos, sem máscara.
- "valor": número positivo para compra; NEGATIVO para crédito, estorno ou pagamento.
- "parcela": copie como está ("04/12") ou deixe vazio se não houver.
- Encargos, IOF, anuidade e pagamentos de fatura que NÃO estejam dentro do bloco de um
  portador vão em "sem_portador".
- Se a fatura não tiver divisão por portador, devolva "portadores": [] e diga por quê em
  "observacao". Não invente dono para nenhuma linha.`;

const SCHEMA = {
  type: "object",
  properties: {
    observacao: { type: "string" },
    portadores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: { type: "string" },
          final: { type: "string" },
          total_impresso: { type: "number" },
          lancamentos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                data: { type: "string" },
                descricao: { type: "string" },
                valor: { type: "number" },
                parcela: { type: "string" },
              },
              required: ["data", "descricao", "valor"],
            },
          },
        },
        required: ["nome", "final", "lancamentos"],
      },
    },
    sem_portador: {
      type: "array",
      items: {
        type: "object",
        properties: {
          data: { type: "string" },
          descricao: { type: "string" },
          valor: { type: "number" },
        },
        required: ["data", "descricao", "valor"],
      },
    },
  },
  required: ["portadores"],
};

type LinhaPdf = { data: string; descricao: string; valor: number; parcela?: string };
type BlocoPdf = { nome: string; final: string; total_impresso?: number; lancamentos: LinhaPdf[] };

/** Onde a fatura em PDF fica guardada. Bucket privado — a fatura tem o gasto de todo mundo. */
const BUCKET_FATURAS = "demonstracoes-pdf";

const cliente = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    const quem = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const supabase = cliente();

    /* ---- guardar: o PDF do Drive vira arquivo no Storage ----
     *
     * Existe porque nem toda leitura precisa ser do modelo. Com o crédito do Gemini
     * esgotado em 03/09/2026, a saída para destravar julho foi uma pessoa (ou o Claude
     * Code) abrir o PDF e escrever a transcrição direto em `leitura` — e daí o pipeline
     * inteiro roda igual, com as mesmas conferências. Para isso o arquivo precisa sair do
     * Drive, que só o servidor enxerga, para um lugar que se baixa com uma chave. */
    if (body?.action === "guardar") {
      if (!body?.drive) return jsonResponse({ erro: "Mande `drive` (id/URL do PDF)." }, 400);
      const arq = await baixarComOAuthDoDrive(supabase, String(body.drive), { maxBytes: 18 * 1024 * 1024 });
      const caminho = String(body?.caminho ?? `faturas-cartao/${arq.nome}`);
      const { error } = await supabase.storage.from(BUCKET_FATURAS)
        .upload(caminho, arq.bytes, { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(`Storage: ${error.message}`);
      return jsonResponse({ ok: true, bucket: BUCKET_FATURAS, caminho, bytes: arq.bytes.length, nome: arq.nome });
    }

    /* ---- consulta de uma tarefa já criada ---- */
    if (body?.tarefa) {
      const { data, error } = await supabase
        .from("cartao_fatura_rateio").select("*").eq("id", String(body.tarefa)).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return jsonResponse({ erro: "Tarefa não encontrada." }, 404);
      return jsonResponse(data);
    }

    const compRaw = String(body?.competencia ?? "").trim();
    const m = compRaw.match(/^(\d{4})-(\d{2})/);
    if (!m) return jsonResponse({ erro: "Informe a competência, no formato 2026-08." }, 400);
    if (!body?.base64 && !body?.drive) {
      return jsonResponse({ erro: "Mande `drive` (id/URL do PDF) ou `base64`." }, 400);
    }

    const { data: tarefa, error: tErr } = await supabase
      .from("cartao_fatura_rateio")
      .insert({
        competencia: `${m[1]}-${m[2]}-01`,
        arquivo: String(body?.nome ?? "") || null,
        drive_id: body?.drive ? String(body.drive) : null,
        gravar: body?.gravar === true,
        criado_por: quem.userId,
      })
      .select("id").single();
    if (tErr) throw new Error(tErr.message);

    // Responde AGORA (o gateway corta em 150s) e segue lendo o PDF no worker, que vive 400s.
    EdgeRuntime.waitUntil(processar(tarefa.id, body, m[1], m[2]));
    return jsonResponse({ tarefa: tarefa.id, status: "rodando" }, 202);
  } catch (e) {
    return errorResponse(e);
  }
});

async function processar(
  tarefaId: string, body: any, ano: string, mes: string,
): Promise<void> {
  const supabase = cliente();
  const competencia = `${ano}-${mes}-01`;
  const anoBase = Number(ano);
  const referencia = `${ano}-${mes}`;
  const gravar = body?.gravar === true;

  try {
    let nome = String(body?.nome ?? "fatura.pdf");

    /* ---- 1. o PDF vira rateio ----
     *
     * REAPROVEITA A LEITURA quando existe. O par natural de uso é "ensaia, confere, grava",
     * e cada passo relia o mesmo PDF de 30 páginas: em 03/09/2026 a fatura de agosto foi
     * ao modelo TRÊS vezes (ensaio, gravação que abortou, gravação boa) para produzir uma
     * resposta só. A leitura de um PDF é a chamada mais cara do Hub — ela vale ser guardada
     * e relida do banco, não do modelo. `reler: true` força uma leitura nova. */
    let lido: { portadores?: BlocoPdf[]; sem_portador?: LinhaPdf[]; observacao?: string } | null = null;
    let origemDaLeitura = "modelo";

    if (body?.reler !== true) {
      const { data: antes } = await supabase
        .from("cartao_fatura_rateio")
        .select("leitura")
        .eq("competencia", competencia)
        .eq("status", "pronto")
        .not("leitura", "is", null)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (antes?.leitura) { lido = antes.leitura as typeof lido; origemDaLeitura = "leitura guardada"; }
    }

    if (!lido) {
      const verba = await podeGastarIA(supabase, "fatura_rateio", 1);
      if (!verba.pode) throw new Error(`Sem orçamento de IA: ${verba.motivo}`);

      // Só agora o arquivo importa: com leitura guardada, nem o Drive é incomodado.
      let bytes: Uint8Array;
      if (body?.base64) {
        bytes = deBase64(String(body.base64));
      } else if (body?.drive) {
        const arq = await baixarComOAuthDoDrive(supabase, String(body.drive), { maxBytes: 18 * 1024 * 1024 });
        bytes = arq.bytes;
        nome = arq.nome;
      } else {
        throw new Error("Mande `drive` (id/URL do PDF) ou `base64`.");
      }
      if (bytes[0] !== 0x25 || bytes[1] !== 0x50) throw new Error(`"${nome}" não é um PDF.`);

      lido = await lerOPdf(bytes, referencia, supabase);
      await supabase.from("cartao_fatura_rateio").update({ leitura: lido }).eq("id", tarefaId);
    }

    const blocos = (lido?.portadores ?? []).filter((b) => b && Array.isArray(b.lancamentos));
    if (!blocos.length) {
      await concluir(supabase, tarefaId, "erro", null,
        `O PDF não trouxe divisão por portador. ${lido?.observacao ?? ""}`.trim());
      return;
    }

    /* ---- 3. casa com o extrato e com o que a base JÁ tem ---- */
    const [ext, aud] = await Promise.all([
      supabase.from("cartao_lancamentos")
        .select("fitid, data, descricao, estabelecimento, categoria, parcela, valor")
        .eq("competencia", competencia).limit(5000),
      supabase.from("auditoria_cartao_lancamentos")
        .select("id_unico, data, valor, card_final, gestor")
        .eq("competencia", competencia).limit(5000),
    ]);
    if (ext.error) throw new Error(`Extrato: ${ext.error.message}`);
    if (aud.error) throw new Error(`Base da auditoria: ${aud.error.message}`);
    const extrato = ext.data ?? [];

    /** data|centavos → linhas. A descrição desempata quando o par se repete (duas
        corridas de R$ 8,94 no mesmo dia, de pessoas diferentes). */
    const indexar = <T extends { data: string | null; valor: number | string }>(rows: T[]) => {
      const mapa = new Map<string, T[]>();
      for (const r of rows) {
        const k = `${r.data}|${Math.round(Number(r.valor) * 100)}`;
        (mapa.get(k) ?? mapa.set(k, []).get(k)!).push(r);
      }
      return mapa;
    };
    const doExtrato = indexar(extrato);
    const naBase = indexar(aud.data ?? []);

    const usadosExtrato = new Set<unknown>();
    const usadosBase = new Set<unknown>();
    const inserir: any[] = [];
    const atualizar: { id_unico: string; card_final: string; gestor: string | null }[] = [];
    const orfas: any[] = [];
    const jaTinhamDono: string[] = [];
    const divergentes: any[] = [];
    const resumo: Record<string, {
      nome: string; final: string; linhas: number; casadas: number; novas: number; total: number;
    }> = {};

    /* CONFERÊNCIA DO BLOCO, antes de qualquer gravação.
       A soma "linhas lidas == linhas do extrato" prova que nada sumiu, mas NÃO prova que
       cada linha foi para a pessoa certa: na primeira carga de julho, uma virada de página
       jogou R$ 49 mil de mídia paga do cartão do CEO para o do Luiz e o total continuou
       fechando. O que pega isso é o subtotal que a fatura imprime em cada bloco — se a
       minha soma não bate com ele, o bloco vazou para o vizinho e não pode ser gravado. */
    const blocosFurados: any[] = [];
    for (const b of blocos) {
      const impresso = num(b.total_impresso);
      if (!Number.isFinite(impresso)) continue; // fatura sem subtotal: não dá para conferir
      const somado = (b.lancamentos ?? []).reduce((s, l) => s + (num(l.valor) || 0), 0);
      if (Math.abs(somado - impresso) > 0.05) {
        blocosFurados.push({
          nome: b.nome, final: b.final, somado: Number(somado.toFixed(2)), impresso,
          diferenca: Number((somado - impresso).toFixed(2)), linhas: (b.lancamentos ?? []).length,
        });
      }
    }
    const furados = new Set(blocosFurados.map((b) => String(b.final ?? "").replace(/\D/g, "").slice(-4)));

    for (const bloco of blocos) {
      const final = String(bloco.final ?? "").replace(/\D/g, "").slice(-4);
      const gestor = String(bloco.nome ?? "").trim() || null;
      const ch = final || `?${gestor}`;
      resumo[ch] ??= { nome: gestor ?? "", final, linhas: 0, casadas: 0, novas: 0, total: 0 };

      for (const l of bloco.lancamentos) {
        const v = num(l.valor);
        if (!Number.isFinite(v)) continue;
        resumo[ch].linhas += 1;
        resumo[ch].total += v;

        /* AS CHAVES CANDIDATAS. A fatura imprime a data da COMPRA, não a da competência, e
           duas coisas quebram o casamento ingênuo `ano da competência + valor impresso`:
           1. PARCELA VELHA. "26/11 ... 08/12" é a 8ª de 12 — a compra foi em 2025. Assumir
              o ano da competência dava 26/11/2026, futuro numa fatura fechada em julho.
              Foram 26 das 33 órfãs de julho.
           2. SINAL DO ESTORNO. O PDF imprime -644,12; o .ofx guarda 644,12. Outras 7.
           Tenta-se do mais provável ao menos: ano da competência antes dos anteriores,
           valor impresso antes do invertido. A descrição continua sendo o desempate. */
        const chaves: string[] = [];
        for (const ano of [anoBase, anoBase - 1, anoBase - 2]) {
          const dd = data(l.data, ano);
          if (!dd) continue;
          for (const vv of [v, -v]) chaves.push(`${dd}|${Math.round(vv * 100)}`);
        }
        if (!chaves.length) continue;
        const d = data(l.data, anoBase)!;

        // (a) a linha já existe na base da auditoria? então só ganha dono — nunca duplica.
        const naBaseCands = chaves
          .flatMap((kk) => naBase.get(kk) ?? [])
          .filter((c) => !usadosBase.has(c));
        if (naBaseCands.length) {
          const alvo = naBaseCands[0];
          usadosBase.add(alvo);
          resumo[ch].casadas += 1;
          if (!alvo.card_final) {
            atualizar.push({ id_unico: alvo.id_unico, card_final: final, gestor });
          } else if (final && alvo.card_final !== final) {
            // O PDF discorda do rateio à mão. Não sobrescreve: relata para uma pessoa olhar.
            divergentes.push({ id_unico: alvo.id_unico, data: d, valor: v, base: alvo.card_final, pdf: final });
          } else {
            jaTinhamDono.push(alvo.id_unico);
          }
          continue;
        }

        // (b) não está na base: nasce dela, casada com a linha do extrato.
        /* A DESCRIÇÃO PRIMEIRO, mesmo quando só há um candidato. O extrato tem 88 linhas de
           IOF em julho, e IOF colide em data+valor com compra de verdade (19,25 aparece
           dezenas de vezes). Pegar o único candidato sem olhar o nome põe "IOF OPERACAO
           EXTERIOR" no lugar da corrida de Uber — valor certo, linha errada. O candidato
           único continua valendo como plano B, para quando a descrição do PDF vier cortada. */
        let alvo: typeof extrato[number] | null = null;
        for (const kk of chaves) {
          const cands = (doExtrato.get(kk) ?? []).filter((c) => !usadosExtrato.has(c));
          if (!cands.length) continue;
          const porNome = cands.find((c) => chave(c.descricao).startsWith(chave(l.descricao).slice(0, 12)));
          const escolhido = porNome ?? (cands.length === 1 ? cands[0] : null);
          if (escolhido) { alvo = escolhido; break; }
        }
        if (!alvo) {
          orfas.push({ final, gestor, data: d, descricao: l.descricao, valor: v });
          continue;
        }
        usadosExtrato.add(alvo);
        resumo[ch].casadas += 1;
        resumo[ch].novas += 1;

        inserir.push({
          /* A chave é o `fitid` da linha do extrato, não data+valor+descrição: duas
             corridas de R$ 8,94 no mesmo dia no mesmo Uber davam o MESMO id, e o Postgres
             recusa o lote inteiro com "ON CONFLICT DO UPDATE cannot affect row a second
             time" — foi o que abortou a primeira carga de julho e agosto. O `fitid` é
             único dentro da competência nos 8 meses do extrato, e reler o mesmo PDF
             devolve o mesmo id. */
          id_unico: `CART-${ano}${mes}-${await hash10(String(alvo.fitid))}`,
          referencia,
          competencia,
          origem: "Cartão",
          gestor,
          card_final: final || null,
          /* DATA E VALOR SAEM DA LINHA DO EXTRATO, não do PDF. Quando o casamento veio por
             ano anterior ou sinal invertido, é o extrato que está certo — a base espelha
             `cartao_lancamentos`, e divergir dele quebraria toda conferência que cruza os
             dois por data+valor. O que o PDF traz de único é o DONO. */
          data: alvo.data ?? d,
          estabelecimento: alvo.estabelecimento ?? null,
          descricao_original: alvo.descricao ?? l.descricao,
          categoria: alvo.categoria ?? null,
          parcela: String(l.parcela ?? alvo.parcela ?? "").trim() || null,
          valor: alvo.valor ?? v,
          // Linha que o financeiro ainda não analisou. NÃO é "SEM NF": carimbar cobrança
          // em centenas de linhas de uma vez transformaria uma correção de exibição numa
          // cobrança em massa que ninguém pediu.
          status_nf: "A CLASSIFICAR",
          status_escopo: "N/A",
        });
      }
    }

    /* ---- 4. grava (só quando mandam) ---- */
    let inseridas = 0;
    let atualizadas = 0;
    if (gravar && blocosFurados.length) {
      await concluir(supabase, tarefaId, "erro", {
        arquivo: nome, competencia: referencia, blocos_furados: blocosFurados,
      }, `Não gravei: ${blocosFurados.length} bloco(s) não fecham com o subtotal impresso na fatura.`);
      return;
    }

    if (gravar) {
      // Cinto e suspensório: um id repetido no lote derruba o lote inteiro, e um erro de
      // leitura pode repetir uma linha mesmo com a chave boa.
      const vistos = new Set<string>();
      const unicas = inserir.filter((l) => !vistos.has(l.id_unico) && vistos.add(l.id_unico));

      for (let i = 0; i < unicas.length; i += 200) {
        const lote = unicas.slice(i, i + 200);
        const { error } = await supabase.from("auditoria_cartao_lancamentos")
          .upsert(lote, { onConflict: "id_unico" });
        if (error) throw new Error(`Inserção: ${error.message}`);
        inseridas += lote.length;
      }
      for (const u of atualizar) {
        const { error } = await supabase.from("auditoria_cartao_lancamentos")
          .update({ card_final: u.card_final, gestor: u.gestor, updated_at: new Date().toISOString() })
          .eq("id_unico", u.id_unico).is("card_final", null);
        if (error) throw new Error(`Atualização: ${error.message}`);
        atualizadas += 1;
      }
    }

    await concluir(supabase, tarefaId, "pronto", {
      arquivo: nome,
      competencia: referencia,
      // De onde veio a transcrição. "leitura guardada" quer dizer: nenhum token gasto.
      leitura_de: origemDaLeitura,
      gravou: gravar,
      inseridas, atualizadas,
      extrato_no_banco: extrato.length,
      base_antes: (aud.data ?? []).length,
      lidas_do_pdf: inserir.length + atualizar.length + orfas.length + jaTinhamDono.length + divergentes.length,
      a_inserir: inserir.length,
      a_atualizar: atualizar.length,
      ja_tinham_dono: jaTinhamDono.length,
      divergentes: divergentes.slice(0, 20),
      qtd_divergentes: divergentes.length,
      orfas: orfas.length,
      amostra_orfas: orfas.slice(0, 10),
      blocos_furados: blocosFurados,
      // Quantos blocos deram para conferir contra o subtotal impresso. Se for 0, a fatura
      // não imprime subtotal e a leitura ficou sem essa rede — vale dizer, não esconder.
      blocos_conferidos: blocos.filter((b) => Number.isFinite(num(b.total_impresso))).length,
      portadores: Object.values(resumo).sort((a, b) => b.linhas - a.linhas),
      sem_portador: (lido?.sem_portador ?? []).length,
      observacao: lido?.observacao ?? null,
    }, null);
  } catch (e) {
    await concluir(cliente(), tarefaId, "erro", null, String((e as Error)?.message ?? e));
  }
}

async function concluir(
  supabase: ReturnType<typeof cliente>, id: string,
  status: "pronto" | "erro", resultado: unknown, erro: string | null,
): Promise<void> {
  await supabase.from("cartao_fatura_rateio")
    .update({ status, resultado, erro, terminado_em: new Date().toISOString() })
    .eq("id", id);
}

/** A leitura em si. Isolada porque é a parte cara: só se chega aqui sem cópia guardada. */
async function lerOPdf(
  bytes: Uint8Array, referencia: string, supabase: ReturnType<typeof cliente>,
): Promise<{ portadores?: BlocoPdf[]; sem_portador?: LinhaPdf[]; observacao?: string }> {
  return await generateJSON({
    model: MODELOS_CASCATA[0],
    // Transcrever para um schema fechado é leitura, não deliberação: o raciocínio alto
    // custaria os mesmos segundos e seria descartado.
    thinking: "low",
    temperature: 0,
    responseSchema: SCHEMA,
    onUso: (u) => { void registrarUsoIA(supabase, { consumidor: "fatura_rateio", ...u }); },
    messages: [
      { role: "system", content: SISTEMA },
      {
        role: "user",
        content: `Esta é a fatura da competência ${referencia}. Transcreva os blocos por portador.`,
        imagens: [{ mimeType: "application/pdf", data: toBase64(bytes) }],
      },
    ],
  });
}

/** 10 hex do SHA-1 da chave natural — o mesmo lançamento relido dá o mesmo `id_unico`. */
async function hash10(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
}
