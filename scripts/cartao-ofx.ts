/**
 * Faturas OFX do cartão Sicoob → payload do RPC `cartao_importar`.
 *
 *   npm run cartao:ofx -- "<pasta dos .ofx>" --resumo        # confere
 *   npm run cartao:ofx -- "<pasta dos .ofx>" payload.json    # gera
 *
 * POR QUE ISTO EXISTE (e não é a skill quem parseia):
 * o desenho original pedia que a skill do Claude lesse os OFX e devolvesse os
 * lançamentos já normalizados. Em 04/08/2026 isso falhou em silêncio — são ~3.800
 * lançamentos, e nenhum modelo reproduz 3.800 registros JSON à mão de forma
 * confiável: gravaram-se os 8 cabeçalhos de fatura e zero lançamentos, e a tela
 * de Governança ficou zerada. Extrair campo de arquivo é trabalho determinístico
 * e barato; o julgamento (em que categoria cai a META) é que merece modelo.
 *
 * QUEM FAZ O QUÊ
 * Ler o arquivo e desembrulhar o MEMO é do `src/lib/cartao/ofx.ts` — o MEMO é um
 * relatório de LARGURA FIXA e ele corta por coluna, que é exato onde regex erra
 * (nome truncado em 22 caracteres sem separador antes da parcela, cidade com
 * espaço no meio, lojista ora antes ora depois do `*`). Ele devolve `chave`, que
 * já funde as variantes do mesmo lojista. Aqui só se decide o que a Governança
 * quer ver: qual o nome de exibição e em que categoria cai — a tabela CATEGORIAS
 * abaixo, que é onde se mexe quando aparece fornecedor novo.
 *
 * CADA .ofx É UMA FATURA INTEIRA — todas as linhas, sem filtro de data.
 * Parece uma janela móvel de ~12 meses porque as PARCELAS chegam datadas da
 * compra ORIGINAL: a 11ª parcela de uma compra de setembro aparece na fatura de
 * agosto ainda datada de setembro. Cortar por mês jogaria fora justamente essas.
 *
 * E não se deduplica por FITID entre faturas: o Sicoob REUSA o FITID em todas as
 * parcelas da mesma compra, mudando só o contador no MEMO — o mesmo id aparece
 * como `10/12` numa fatura e `11/12` na seguinte, e são duas cobranças distintas.
 * Conferido nas 8 faturas: entre faturas consecutivas existe exatamente UMA linha
 * repetida de verdade (o crédito fixo de R$ 14 "DESC ANUIDADE POR USO"), que é
 * mensal mesmo. Só se descarta arquivo REEXPORTADO (o mesmo ciclo salvo com dois
 * nomes), que viraria fatura fantasma.
 */

import fs from "node:fs";
import path from "node:path";
import { parseOfx, type LinhaOfx } from "@/lib/cartao/ofx";

/* ---------------------------------------------------------------- categorias
 * [padrão sobre a CHAVE, nome de exibição, categoria]. Primeiro que casar vence,
 * então o mais específico vem antes.
 *
 * A chave já vem fundida do `chaveDe`, então aqui só sobra o que ele se recusa a
 * adivinhar — e a recusa é deliberada: fundir demais erra calado. É o caso do
 * "GOOGLE CLOUD <código>", que ele mantém separado por não conseguir distinguir
 * o código do nome do produto, e que só aqui, sabendo que Ads/Cloud/Workspace são
 * rubricas diferentes, dá para juntar com segurança.
 */
const CATEGORIAS: [RegExp, string, string][] = [
  [/^FACEBK|^FACEBOOK|^META PLAT/,              "META ADS",              "Mídia / Tráfego pago"],
  [/^GOOGLE ADS/,                               "GOOGLE ADS",            "Mídia / Tráfego pago"],
  [/^TIKTOK|^BYTEDANCE/,                        "TIKTOK ADS",            "Mídia / Tráfego pago"],
  [/^LINKEDIN/,                                 "LINKEDIN",              "Mídia / Tráfego pago"],
  [/^SYMPLA/,                                   "SYMPLA",                "Eventos / Marketing"],
  [/^EVENTBRITE/,                               "EVENTBRITE",            "Eventos / Marketing"],

  [/^AWS|^AMAZON WEB/,                          "AWS",                   "Infraestrutura / Cloud"],
  [/^GOOGLE CLOUD/,                             "GOOGLE CLOUD",          "Infraestrutura / Cloud"],
  [/^GOOGLE (WORKSPACE|GSUITE|WORKSP)/,         "GOOGLE WORKSPACE",      "Infraestrutura / Cloud"],
  [/^CLOUDFLARE/,                               "CLOUDFLARE",            "Infraestrutura / Cloud"],
  [/^DIGITALOCEAN/,                             "DIGITALOCEAN",          "Infraestrutura / Cloud"],
  [/^VERCEL/,                                   "VERCEL",                "Infraestrutura / Cloud"],
  [/^SUPABASE/,                                 "SUPABASE",              "Infraestrutura / Cloud"],
  [/^HEROKU/,                                   "HEROKU",                "Infraestrutura / Cloud"],
  [/^SENTRY/,                                   "SENTRY",                "Infraestrutura / Cloud"],
  [/^DATADOG/,                                  "DATADOG",               "Infraestrutura / Cloud"],
  [/^ELASTIC/,                                  "ELASTIC",               "Infraestrutura / Cloud"],
  [/^TWILIO/,                                   "TWILIO",                "Infraestrutura / Cloud"],
  [/^SENDGRID/,                                 "SENDGRID",              "Infraestrutura / Cloud"],
  [/^UAZAPI/,                                   "UAZAPI",                "Infraestrutura / Cloud"],

  [/^HUBSPOT/,                                  "HUBSPOT",               "Software / SaaS"],
  [/^OPENAI|^CHATGPT/,                          "OPENAI",                "Software / SaaS"],
  [/^ANTHROPIC|^CLAUDE AI/,                     "ANTHROPIC",             "Software / SaaS"],
  [/^CURSOR|^ANYSPHERE/,                        "CURSOR",                "Software / SaaS"],
  [/^CLICKUP/,                                  "CLICKUP",               "Software / SaaS"],
  [/^DOCUPIPE/,                                 "DOCUPIPE",              "Software / SaaS"],
  [/^CANVA/,                                    "CANVA",                 "Software / SaaS"],
  [/^CAPCUT/,                                   "CAPCUT",                "Software / SaaS"],
  [/^SLACK/,                                    "SLACK",                 "Software / SaaS"],
  [/^NOTION/,                                   "NOTION",                "Software / SaaS"],
  [/^FIGMA/,                                    "FIGMA",                 "Software / SaaS"],
  [/^GITHUB/,                                   "GITHUB",                "Software / SaaS"],
  [/^ATLASSIAN|^JIRA/,                          "ATLASSIAN",             "Software / SaaS"],
  [/^ZOOM/,                                     "ZOOM",                  "Software / SaaS"],
  [/^MICROSOFT|^MSFT/,                          "MICROSOFT",             "Software / SaaS"],
  [/^APPLE|^ITUNES/,                            "APPLE",                 "Software / SaaS"],
  [/^ADOBE/,                                    "ADOBE",                 "Software / SaaS"],
  [/^GOOGLE/,                                   "GOOGLE (outros)",       "Software / SaaS"],

  [/^DELL/,                                     "DELL",                  "Equipamentos / TI"],
  [/^SAMSUNG/,                                  "SAMSUNG",               "Equipamentos / TI"],
  [/^ORION INFORMATICA/,                        "ORION INFORMÁTICA",     "Equipamentos / TI"],
  [/^KALUNGA/,                                  "KALUNGA",               "Materiais / Escritório"],
  [/^PRINTI/,                                   "PRINTI",                "Materiais / Escritório"],
  [/^ELETROTINTAS/,                             "ELETROTINTAS",          "Materiais / Escritório"],
  [/^MERCADOLIVRE|^MERCADO LIVRE/,              "MERCADO LIVRE",         "Materiais / Escritório"],
  [/^AMAZON(?!.*WEB)/,                          "AMAZON",                "Materiais / Escritório"],
  [/^SUPERFRETE/,                               "SUPERFRETE",            "Logística / Frete"],
  [/^CORREIOS|^JADLOG|^LOGGI/,                  "CORREIOS / LOGÍSTICA",  "Logística / Frete"],

  [/^AIRBNB/,                                   "AIRBNB",                "Viagem / Hospedagem"],
  [/^LATAM/,                                    "LATAM",                 "Viagem / Passagens"],
  [/^GOL LINHAS|^GOL /,                         "GOL",                   "Viagem / Passagens"],
  [/^AZUL/,                                     "AZUL",                  "Viagem / Passagens"],
  [/^AMERICAN AIR|^UNITED AIR|^AIR FRANCE|^TAP /,"AÉREAS INTERNACIONAIS","Viagem / Passagens"],
  [/^TAXA DE EMBARQUE/,                         "TAXA DE EMBARQUE",      "Viagem / Passagens"],
  [/^BOOKING|^HOTEL AT BOOKING/,                "BOOKING",               "Viagem / Hospedagem"],
  [/^DECOLAR/,                                  "DECOLAR",               "Viagem / Hospedagem"],
  [/^HOTEL|^POUSADA|^IBIS|^MERCURE/,            "HOTÉIS",                "Viagem / Hospedagem"],
  [/^UBER/,                                     "UBER",                  "Viagem / Transporte"],
  [/^99/,                                       "99",                    "Viagem / Transporte"],
  [/^CABIFY/,                                   "CABIFY",                "Viagem / Transporte"],

  [/^IFOOD/,                                    "IFOOD",                 "Alimentação"],
  [/^RAPPI/,                                    "RAPPI",                 "Alimentação"],
  [/^ZE DELIVERY/,                              "ZÉ DELIVERY",           "Alimentação"],

  [/^IOF/,                                      "IOF",                   "Tarifas e impostos do cartão"],
  [/^(DESC )?ANUIDADE|^TARIFA|^REPOSICAO PLASTICO|^SEGURO|^JUROS|^MULTA|^ENCARGOS/,
                                                "TARIFAS DO CARTÃO",     "Tarifas e impostos do cartão"],
  [/^PAGAMENTO/,                                "PAGAMENTO DE FATURA",   "Pagamento da fatura"],
];

/** Chave → o que a Governança mostra. Sem regra, a própria chave é o nome. */
function classificar(chave: string): { nome: string; categoria: string } {
  for (const [re, nome, categoria] of CATEGORIAS) {
    if (re.test(chave)) return { nome, categoria };
  }
  return { nome: chave, categoria: "Outros (diversos)" };
}

/* ------------------------------------------------------------------ período */

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho",
               "agosto","setembro","outubro","novembro","dezembro"];

const fimDoMes = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const proxMes = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};
const mesAnterior = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};
const rotulo = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)}/${a}`;
};

/**
 * Mês do ciclo a partir do DTASOF. O `parseOfx` assume fechamento = fim de ciclo
 * e joga a fatura para o mês seguinte, mas dois dos arquivos foram exportados no
 * meio do mês (10/01 e 08/03) e ali o DTASOF é a data do export, não o
 * fechamento — sem corrigir, o de dezembro cairia em fevereiro e colidiria com o
 * de janeiro. DTASOF no último dia = fechamento de verdade; no meio do mês, o
 * ciclo fechado é o do mês anterior.
 */
function cicloDe(fechamento: string): string {
  const ym = fechamento.slice(0, 7);
  return fechamento === fimDoMes(ym) ? ym : mesAnterior(ym);
}

const tipoDe = (l: LinhaOfx) =>
  l.sinal === "debito" ? "gasto" : /PAGAMENTO/i.test(l.memo) ? "pagamento" : "estorno";

/* ----------------------------------------------------------------- montagem */

type Fatura = {
  competencia: string;
  mes_label: string;
  fechamento: string | null;
  arquivo: string;
  lancamentos: Record<string, unknown>[];
};

function montar(arquivos: string[]) {
  const lidos = arquivos
    .map((a) => ({ arquivo: path.basename(a), fat: parseOfx(fs.readFileSync(a, "latin1")) }))
    .filter((x) => x.fat.fechamento && x.fat.linhas.length);

  // Reexportação do mesmo ciclo (o mesmo arquivo salvo com dois nomes) viraria
  // fatura fantasma. Mantém uma por conjunto de cobranças.
  const vistos = new Map<string, (typeof lidos)[number]>();
  for (const x of lidos) {
    const chave = x.fat.fechamento + "|" +
      x.fat.linhas.map((l) => `${l.fitid}:${l.memo}:${l.valor}`).sort().join(",");
    if (!vistos.has(chave)) vistos.set(chave, x);
  }
  const unicos = [...vistos.values()].sort((a, b) =>
    (a.fat.fechamento ?? "").localeCompare(b.fat.fechamento ?? ""));

  const faturas: Fatura[] = [];
  const avisos: string[] = [];
  const ocupadas = new Map<string, string>();

  for (const { arquivo, fat } of unicos) {
    const ciclo = cicloDe(fat.fechamento!);
    const competencia = `${proxMes(ciclo)}-01`;

    // Dois ciclos na mesma competência = DTASOF que a heurística não entendeu.
    // Melhor gritar do que sobrescrever a fatura boa.
    if (ocupadas.has(competencia)) {
      avisos.push(
        `${rotulo(proxMes(ciclo))}: "${arquivo}" e "${ocupadas.get(competencia)}" caíram na ` +
        `mesma competência. Confira o DTASOF dos dois — um deles não foi importado.`,
      );
      continue;
    }
    ocupadas.set(competencia, arquivo);

    faturas.push({
      competencia,
      mes_label: rotulo(proxMes(ciclo)),
      fechamento: fat.fechamento,
      arquivo,
      lancamentos: fat.linhas.map((l) => {
        const { nome, categoria } = classificar(l.chave);
        return {
          data: l.data,
          estabelecimento: nome,
          categoria,
          descricao: l.memo,
          parcela: l.parcela
            ? `${String(l.parcela.n).padStart(2, "0")}/${String(l.parcela.de).padStart(2, "0")}`
            : null,
          cidade: l.cidade,
          valor: l.valor,
          tipo: tipoDe(l),
          fitid: l.fitid,
        };
      }),
    });
  }

  return { faturas, avisos, ignorados: lidos.length - unicos.length };
}

/* ---------------------------------------------------------------------- CLI */

const [dir, saida] = process.argv.slice(2);
if (!dir) {
  console.error('uso: npm run cartao:ofx -- "<pasta dos .ofx>" [--resumo | <saida.json>]');
  process.exit(1);
}

const arquivos = fs.readdirSync(dir)
  .filter((n) => n.toLowerCase().endsWith(".ofx"))
  .map((n) => path.join(dir, n));

const { faturas, avisos, ignorados } = montar(arquivos);
const total = faturas.reduce((a, f) => a + f.lancamentos.length, 0);

if (saida === "--resumo") {
  console.log("fatura            lanç.       gastos    pagamentos     estornos");
  for (const f of faturas) {
    const s = (t: string) => f.lancamentos
      .filter((l) => l.tipo === t).reduce((a, l) => a + (l.valor as number), 0);
    console.log(
      `${f.mes_label.padEnd(16)}${String(f.lancamentos.length).padStart(5)} ` +
      `${s("gasto").toFixed(2).padStart(12)} ${s("pagamento").toFixed(2).padStart(13)} ` +
      `${s("estorno").toFixed(2).padStart(12)}`,
    );
  }

  /* Cobrança repetida = mesmo fitid E mesmo memo E mesmo valor. O fitid sozinho
     repete de propósito (parcelas da mesma compra), então não serve de alarme. */
  const cobrancas = new Set<string>();
  let repetidos = 0;
  for (const f of faturas) for (const l of f.lancamentos) {
    const k = `${l.fitid}|${l.descricao}|${l.valor}`;
    if (cobrancas.has(k)) repetidos++;
    cobrancas.add(k);
  }

  console.log(`\n${arquivos.length} arquivos · ${ignorados} reexportação(ões) ignorada(s)`);
  console.log(`${total} lançamentos · ${repetidos} cobranças idênticas repetidas (o crédito mensal de anuidade)`);
  avisos.forEach((a) => console.log("\n⚠ " + a));

  const porCat: Record<string, number> = {};
  const semRegra: Record<string, number> = {};
  for (const f of faturas) for (const l of f.lancamentos) {
    if (l.tipo !== "gasto") continue;
    porCat[l.categoria as string] = (porCat[l.categoria as string] ?? 0) + (l.valor as number);
    if (l.categoria === "Outros (diversos)") {
      semRegra[l.estabelecimento as string] = (semRegra[l.estabelecimento as string] ?? 0) + (l.valor as number);
    }
  }
  console.log("\ngasto por categoria:");
  Object.entries(porCat).sort((a, b) => b[1] - a[1])
    .forEach(([c, v]) => console.log(`  ${v.toFixed(2).padStart(12)}  ${c}`));

  const tail = Object.entries(semRegra).sort((a, b) => b[1] - a[1]);
  console.log(`\nsem regra em CATEGORIAS: ${tail.length} fornecedores — os 10 maiores:`);
  tail.slice(0, 10).forEach(([n, v]) => console.log(`  ${v.toFixed(2).padStart(12)}  ${n}`));
} else if (saida) {
  fs.writeFileSync(saida, JSON.stringify({ faturas }));
  console.log(`${saida}: ${faturas.length} faturas, ${total} lançamentos`);
  avisos.forEach((a) => console.log("⚠ " + a));
} else {
  process.stdout.write(JSON.stringify({ faturas }));
}
