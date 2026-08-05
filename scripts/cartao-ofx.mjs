/**
 * Faturas OFX do cartão Sicoob → payload do RPC `cartao_importar`.
 *
 *   node scripts/cartao-ofx.mjs "<pasta dos .ofx>" --resumo        # confere
 *   node scripts/cartao-ofx.mjs "<pasta dos .ofx>" payload.json    # gera
 *
 * POR QUE ISTO EXISTE (e não é a skill quem parseia):
 * o desenho original pedia que a skill do Claude lesse os OFX e devolvesse os
 * lançamentos já normalizados. Em 04/08/2026 isso falhou em silêncio — são ~2.900
 * lançamentos, e nenhum modelo reproduz 2.900 registros JSON à mão de forma
 * confiável: gravaram-se os 8 cabeçalhos de fatura e zero lançamentos, e a tela
 * de Governança ficou zerada. Extrair campo de arquivo é trabalho determinístico
 * e barato; o julgamento (o que é "META ADS", em que categoria cai) é que merece
 * modelo. Este script faz a parte mecânica; o dicionário MERCHANTS abaixo carrega
 * o julgamento, e é ali que se mexe quando aparecer lojista novo.
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

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho",
               "agosto","setembro","outubro","novembro","dezembro"];

/* ------------------------------------------------------------------ leitura */

const tag = (bloco, t) => {
  const m = bloco.match(new RegExp("<" + t + ">([^<\\n\\r]*)"));
  return m ? m[1].trim() : "";
};

function lerOfx(arquivo) {
  const txt = fs.readFileSync(arquivo, "latin1");
  const dtasof = (txt.match(/<LEDGERBAL>[\s\S]*?<DTASOF>(\d{8})/) || [])[1] || null;
  const trns = [...txt.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g)].map((m) => m[1]).map((b) => ({
    fitid: tag(b, "FITID"),
    data: tag(b, "DTPOSTED").slice(0, 8),
    valor: parseFloat(tag(b, "TRNAMT")),
    memo: tag(b, "MEMO").replace(/\s+/g, " ").trim(),
  }));
  return { arquivo: path.basename(arquivo), dtasof, trns };
}

/* ----------------------------------------------------- limpeza do MEMO ------
 * O MEMO chega mascarado pelo adquirente e com tudo grudado:
 *   "EC *MERCADOLIVREV 06/12 CAJAMAR"
 *   "CLICKUPV 8886254258 - US$ 440,00 U$ 440,00 V.DOL 5,4237"
 * Ordem importa: cauda internacional → parcela → cidade → prefixo → complemento.
 */

const CAUDA_INTL  = /\s*-?\s*US\$[\s\S]*$/i;
const ADQUIRENTE  = /^(EC|PG|DL|EBN|ASAAS|ASA|MP|MERCPAGO|PAG|PAGSEGURO|PP|PAYPAL|SUMUP|STONE|CIELO|REDE|GETNET|IUGU|VINDI|EBANX|DLOCAL|PIC|PICPAY)\s*\*\s*/i;
const COMPLEMENTO = /\s+(\d[\d\s-]{5,}|[A-Za-z0-9-]+\.(?:AI|IO|COM|NET|CO|APP|DEV|ORG)(?:\.BR)?)\s*$/i;
const CIDADES = new RegExp(
  "\\s+(" + ["SAO PAULO","Sao Paulo","SÃO PAULO","Sao Pablo","SAO PABLO","ITAIM BIBI",
    "RIO DE JANEIRO","Rio de Janeiro","VITORIA","Vitoria","VITÓRIA","SERRA","Serra",
    "VILA VELHA","Vila Velha","CARIACICA","Cariacica","GUARAPARI","Osasco","OSASCO",
    "BELO HORIZONTE","Belo Horizont","CURITIBA","Curitiba","BRASILIA","Brasilia",
    "BARUERI","Barueri","CAMPINAS","Campinas","FLORIANOPOLIS","PORTO ALEGRE",
    "SALVADOR","Salvador","RECIFE","Recife","FORTALEZA","GOIANIA","MANAUS","NITEROI",
    "SANTOS","Santos","GUARULHOS","Guarulhos","CAJAMAR","INDAIATUBA","ITUPEVA",
    "Eusebio","Caico","Internet","INTERNET"].join("|") + ")\\s*$");

function despedacar(memoOriginal) {
  let s = memoOriginal.replace(CAUDA_INTL, "").trim();

  let parcela = null;
  const mp = s.match(/\s(\d{2}\/\d{2})(?=\s|$)/);
  if (mp) {
    parcela = mp[1];
    s = (s.slice(0, mp.index) + " " + s.slice(mp.index + mp[0].length)).replace(/\s+/g, " ").trim();
  }

  // Só corta a cidade se sobrar nome — senão "SAO PAULO" viraria string vazia.
  let cidade = null;
  const mc = s.match(CIDADES);
  if (mc && s.slice(0, mc.index).trim().length >= 3) {
    cidade = mc[1].toUpperCase();
    s = s.slice(0, mc.index).trim();
  }

  s = s.replace(ADQUIRENTE, "").trim();
  s = s.replace(COMPLEMENTO, "").trim();

  /* "V" grudado no fim do nome ("AWS BrazilV", "CLICKUPV", "MERCADOLIVREV"): o
     banco corta o nome numa largura fixa e cola o marcador. Às vezes o que sobra
     já vem truncado ("CardapioWeV" era "CardapioWeb") — perda da origem. */
  s = s.replace(/(?<=[a-zA-Z.])V$/, "").trim();

  return { nome: s, parcela, cidade };
}

/* ------------------------------------------------------------- dicionário ---
 * [padrão, nome canônico, categoria]. Primeiro que casar vence, então o mais
 * específico vem antes (GOOGLE ADS antes de GOOGLE CLOUD antes de GOOGLE).
 * `estabelecimento` é sempre o fornecedor real — quem agrupa é a `categoria`.
 */
const MERCHANTS = [
  [/^FACEBK|^FACEBOOK|^META PLAT/i,            "META ADS",              "Mídia / Tráfego pago"],
  [/GOOGLE ?ADS/i,                             "GOOGLE ADS",            "Mídia / Tráfego pago"],
  [/^TIKTOK|BYTEDANCE/i,                       "TIKTOK ADS",            "Mídia / Tráfego pago"],
  [/LINKEDIN/i,                                "LINKEDIN",              "Mídia / Tráfego pago"],
  [/SYMPLA/i,                                  "SYMPLA",                "Eventos / Marketing"],
  [/EVENTBRITE/i,                              "EVENTBRITE",            "Eventos / Marketing"],

  [/^AWS|AMAZON WEB/i,                         "AWS",                   "Infraestrutura / Cloud"],
  [/GOOGLE ?(CLOUD|GSUITE|WORKSPACE|SVCS|GSU)/i, "GOOGLE CLOUD / WORKSPACE", "Infraestrutura / Cloud"],
  [/CLOUDFLARE/i,                              "CLOUDFLARE",            "Infraestrutura / Cloud"],
  [/DIGITALOCEAN/i,                            "DIGITALOCEAN",          "Infraestrutura / Cloud"],
  [/VERCEL/i,                                  "VERCEL",                "Infraestrutura / Cloud"],
  [/SUPABASE/i,                                "SUPABASE",              "Infraestrutura / Cloud"],
  [/HEROKU/i,                                  "HEROKU",                "Infraestrutura / Cloud"],
  [/SENTRY/i,                                  "SENTRY",                "Infraestrutura / Cloud"],
  [/DATADOG/i,                                 "DATADOG",               "Infraestrutura / Cloud"],
  [/ELASTIC/i,                                 "ELASTIC",               "Infraestrutura / Cloud"],
  [/TWILIO/i,                                  "TWILIO",                "Infraestrutura / Cloud"],
  [/SENDGRID/i,                                "SENDGRID",              "Infraestrutura / Cloud"],
  [/UAZAPI/i,                                  "UAZAPI",                "Infraestrutura / Cloud"],

  [/HUBSPOT/i,                                 "HUBSPOT",               "Software / SaaS"],
  [/^OPENAI|CHATGPT/i,                         "OPENAI",                "Software / SaaS"],
  [/ANTHROPIC|CLAUDE\.AI/i,                    "ANTHROPIC",             "Software / SaaS"],
  [/CURSOR|ANYSPHERE/i,                        "CURSOR",                "Software / SaaS"],
  [/CLICKUP/i,                                 "CLICKUP",               "Software / SaaS"],
  [/DOCUPIPE/i,                                "DOCUPIPE",              "Software / SaaS"],
  [/CANVA/i,                                   "CANVA",                 "Software / SaaS"],
  [/CAPCUT/i,                                  "CAPCUT",                "Software / SaaS"],
  [/SLACK/i,                                   "SLACK",                 "Software / SaaS"],
  [/NOTION/i,                                  "NOTION",                "Software / SaaS"],
  [/FIGMA/i,                                   "FIGMA",                 "Software / SaaS"],
  [/GITHUB/i,                                  "GITHUB",                "Software / SaaS"],
  [/ATLASSIAN|JIRA/i,                          "ATLASSIAN",             "Software / SaaS"],
  [/ZOOM/i,                                    "ZOOM",                  "Software / SaaS"],
  [/MICROSOFT|MSFT/i,                          "MICROSOFT",             "Software / SaaS"],
  [/^APPLE|ITUNES/i,                           "APPLE",                 "Software / SaaS"],
  [/ADOBE/i,                                   "ADOBE",                 "Software / SaaS"],
  [/^GOOGLE/i,                                 "GOOGLE (outros)",       "Software / SaaS"],

  [/^DELL/i,                                   "DELL",                  "Equipamentos / TI"],
  [/SAMSUNG/i,                                 "SAMSUNG",               "Equipamentos / TI"],
  [/KALUNGA/i,                                 "KALUNGA",               "Materiais / Escritório"],
  [/^PRINTI/i,                                 "PRINTI",                "Materiais / Escritório"],
  [/ELETROTINTAS/i,                            "ELETROTINTAS",          "Materiais / Escritório"],
  [/MERCADO ?LIVRE|MERCADOLIVRE/i,             "MERCADO LIVRE",         "Materiais / Escritório"],
  [/^AMAZON(?!.*WEB)/i,                        "AMAZON",                "Materiais / Escritório"],
  [/SUPERFRETE/i,                              "SUPERFRETE",            "Logística / Frete"],
  [/CORREIOS|^JADLOG|LOGGI/i,                  "CORREIOS / LOGÍSTICA",  "Logística / Frete"],

  [/^AIRBNB/i,                                 "AIRBNB",                "Viagem / Hospedagem"],
  [/^LATAM/i,                                  "LATAM",                 "Viagem / Passagens"],
  [/^GOL LINHAS|^GOL /i,                       "GOL",                   "Viagem / Passagens"],
  [/^AZUL/i,                                   "AZUL",                  "Viagem / Passagens"],
  [/^AMERICAN|^UNITED AIR|^AIR ?FRANCE|^TAP /i,"AÉREAS INTERNACIONAIS", "Viagem / Passagens"],
  [/TAXA DE EMBARQUE/i,                        "TAXA DE EMBARQUE",      "Viagem / Passagens"],
  [/^BOOKING/i,                                "BOOKING",               "Viagem / Hospedagem"],
  [/DECOLAR/i,                                 "DECOLAR",               "Viagem / Hospedagem"],
  [/HOTEL|POUSADA|^IBIS|^MERCURE/i,            "HOTÉIS",                "Viagem / Hospedagem"],
  [/^UBER/i,                                   "UBER",                  "Viagem / Transporte"],
  [/^99 ?\*|^99APP|^99POP/i,                   "99",                    "Viagem / Transporte"],
  [/CABIFY/i,                                  "CABIFY",                "Viagem / Transporte"],

  [/IFOOD/i,                                   "IFOOD",                 "Alimentação"],
  [/RAPPI/i,                                   "RAPPI",                 "Alimentação"],
  [/ZE DELIVERY|ZE ?DELIV/i,                   "ZÉ DELIVERY",           "Alimentação"],

  [/^IOF/i,                                    "IOF",                   "Tarifas e impostos do cartão"],
  [/ANUIDADE|TARIFA|REPOSI[ÇC][ÃA]O PL[ÁA]STICO|SEGURO/i,
                                               "TARIFAS DO CARTÃO",     "Tarifas e impostos do cartão"],
  [/^PAGAMENTO/i,                              "PAGAMENTO DE FATURA",   "Pagamento da fatura"],
];

function classificar(nome) {
  for (const [re, canon, cat] of MERCHANTS) if (re.test(nome)) return { canon, cat };
  // Cauda longa de comércio local: tira o código aleatório que sobrou e usa o resto.
  const base = nome.replace(/[\s\-*]+[A-Z0-9]{6,}$/i, "").replace(/\s{2,}/g, " ").trim();
  return { canon: (base || nome).toUpperCase(), cat: "Outros (diversos)" };
}

const tipoDe = (memo, valor) =>
  valor < 0 ? "gasto" : /PAGAMENTO/i.test(memo) ? "pagamento" : "estorno";

/* -------------------------------------------------------------- montagem --- */

const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const ymDe = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}`;
const proxMes = (ym) => {
  const [a, m] = ym.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};
const mesAnterior = (ym) => {
  const [a, m] = ym.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};
const fimDoMes = (ym) => {
  const [a, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const rotulo = (ym) => {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)}/${a}`;
};

/** Mês do ciclo. DTASOF no último dia = fechamento; no meio do mês = export
 *  avulso, e aí o ciclo fechado é o do mês anterior. */
function cicloDe(dtasof) {
  const ym = ymDe(dtasof);
  return iso(dtasof) === fimDoMes(ym) ? ym : mesAnterior(ym);
}

export function montar(arquivos) {
  const lidos = arquivos.map(lerOfx).filter((f) => f.dtasof && f.trns.length);

  // Reexportações do mesmo ciclo (o mesmo arquivo salvo com dois nomes) geram
  // fatura fantasma. Mantém uma por conjunto de FITIDs.
  const vistos = new Map();
  for (const f of lidos) {
    const chave = f.dtasof + "|" + f.trns.map((t) => t.fitid).sort().join(",");
    if (!vistos.has(chave)) vistos.set(chave, f);
  }
  const unicos = [...vistos.values()].sort((a, b) => a.dtasof.localeCompare(b.dtasof));

  const faturas = [];
  const avisos = [];

  const porCompetencia = new Map();
  unicos.forEach((f) => {
    const ciclo = cicloDe(f.dtasof);
    const competencia = `${proxMes(ciclo)}-01`;

    // Dois ciclos distintos caindo na mesma competência significaria DTASOF que a
    // heurística não entendeu — melhor gritar do que sobrescrever a fatura boa.
    if (porCompetencia.has(competencia)) {
      avisos.push(
        `${rotulo(proxMes(ciclo))}: "${f.arquivo}" e "${porCompetencia.get(competencia)}" ` +
        `caíram na mesma competência. Confira o DTASOF dos dois — um deles não foi importado.`,
      );
      return;
    }
    porCompetencia.set(competencia, f.arquivo);

    faturas.push({
      competencia,
      mes_label: rotulo(proxMes(ciclo)),
      fechamento: iso(f.dtasof),
      arquivo: f.arquivo,
      lancamentos: f.trns.map((t) => {
        const { nome, parcela, cidade } = despedacar(t.memo);
        const { canon, cat } = classificar(nome);
        return {
          data: iso(t.data),
          estabelecimento: canon,
          categoria: cat,
          descricao: t.memo,
          parcela, cidade,
          valor: Math.abs(t.valor),
          tipo: tipoDe(t.memo, t.valor),
          fitid: t.fitid,
        };
      }),
    });
  });

  return { faturas, avisos, ignorados: lidos.length - unicos.length };
}

/* ------------------------------------------------------------------- CLI --- */

const [, , dir, saida] = process.argv;
if (!dir) {
  console.error('uso: node scripts/cartao-ofx.mjs "<pasta dos .ofx>" [--resumo | <saida.json>]');
  process.exit(1);
}

const arquivos = fs.readdirSync(dir)
  .filter((n) => n.toLowerCase().endsWith(".ofx"))
  .map((n) => path.join(dir, n));

const { faturas, avisos, ignorados } = montar(arquivos);

/* Cobrança repetida = mesmo fitid E mesmo memo E mesmo valor. O fitid sozinho
   repete de propósito (parcelas da mesma compra), então não serve de alarme. */
const cobrancas = new Set();
const total = faturas.reduce((a, f) => a + f.lancamentos.length, 0);
let repetidos = 0;
for (const f of faturas) for (const l of f.lancamentos) {
  const k = `${l.fitid}|${l.descricao}|${l.valor}`;
  if (cobrancas.has(k)) repetidos++;
  cobrancas.add(k);
}

if (saida === "--resumo") {
  console.log("fatura            lanç.       gastos    pagamentos     estornos");
  for (const f of faturas) {
    const s = (t) => f.lancamentos.filter((l) => l.tipo === t).reduce((a, l) => a + l.valor, 0);
    console.log(
      `${f.mes_label.padEnd(16)}${String(f.lancamentos.length).padStart(5)} ` +
      `${s("gasto").toFixed(2).padStart(12)} ${s("pagamento").toFixed(2).padStart(13)} ${s("estorno").toFixed(2).padStart(12)}`,
    );
  }
  console.log(`\n${arquivos.length} arquivos · ${ignorados} reexportação(ões) do mesmo ciclo ignorada(s)`);
  console.log(`${total} lançamentos · ${repetidos} cobranças idênticas repetidas (o crédito mensal de anuidade)`);
  avisos.forEach((a) => console.log("\n⚠ " + a));

  const porCat = {};
  for (const f of faturas) for (const l of f.lancamentos) {
    if (l.tipo !== "gasto") continue;
    porCat[l.categoria] = (porCat[l.categoria] || 0) + l.valor;
  }
  console.log("\ngasto por categoria:");
  Object.entries(porCat).sort((a, b) => b[1] - a[1])
    .forEach(([c, v]) => console.log(`  ${v.toFixed(2).padStart(12)}  ${c}`));
} else if (saida) {
  fs.writeFileSync(saida, JSON.stringify({ faturas }));
  console.log(`${saida}: ${faturas.length} faturas, ${total} lançamentos`);
  avisos.forEach((a) => console.log("⚠ " + a));
} else {
  process.stdout.write(JSON.stringify({ faturas }));
}
