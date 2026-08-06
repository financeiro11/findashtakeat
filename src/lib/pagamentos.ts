/**
 * Conferência "agenda × Omie" dos pagamentos do dia.
 *
 * O QUE ESTE MÓDULO RESOLVE: a agenda (Google Calendar, via skill do briefing)
 * marca cada pagamento do dia como um evento de dia inteiro — "Pagar: Singular |
 * Limpeza", "Pagar: Pró Labore - R$ 4.361,00". O Omie tem os títulos a pagar com
 * vencimento. Provisionar é lançar o título no ERP; o que está na agenda e não
 * tem título é o pagamento que vai sair sem provisão — é isso que precisa gritar.
 *
 * Fica num módulo puro (sem React, sem Supabase) porque é a parte que dá para
 * testar de verdade contra casos reais — ver pagamentos.test.ts.
 *
 * COMO CASA — lê tudo o que o título tem escrito, não só os campos estruturados:
 *  1. NOME do fornecedor ou FAVORECIDO da transferência, por palavra inteira
 *     ("Singular" ⊂ "SINGULAR FACILITIES SERVICE S.A."). Palavra inteira, e não
 *     pedaço: "ISS" está dentro de "COMISSAO" e casaria errado.
 *  2. OBSERVAÇÃO do título — é onde o time escreve o que o pagamento é quando o
 *     cadastro não diz. Caso real: "Donos de Hamburgueria (2ª parcela) -
 *     R$ 6.000" está lançado em "PLENUS SOLUCOES / Eventos e Feiras", e só a
 *     observação ("Donos de Hamburgueria (2 parcela)") identifica. O texto vem
 *     do `omie-contas-pagar-sync`; sem ele a conferência ainda funciona, só cega
 *     para esses casos.
 *  3. CATEGORIA, porque metade dos eventos nomeia a despesa e não o fornecedor
 *     ("Aluguel | Sede" → categoria "Aluguel - Administrativo", fornecedor
 *     "ALUDE TECNOLOGIA"). É o sinal mais fraco: sozinho, só sugere.
 *  4. VALOR reforça e desempata — mas nunca identifica sozinho (num dia de folha
 *     há vários títulos de R$ 5.000 e casaria com o fornecedor errado).
 *
 * O evento traz valor e nenhum título daquele dia bate com ele? Não vira ✅ — vira
 * "valor diverge". Caso real: a agenda pedia "Kelven - Manutenção - R$ 90,00" e o
 * Omie tinha um Kelven de R$ 2.800 (mensalidade de onboarding). São coisas
 * diferentes; chamar de provisionado seria mentir.
 */
import { normalize, similarity } from "./normalize";

export type TituloOmie = {
  cod_titulo: number;
  vencimento: string;                 // YYYY-MM-DD
  previsao?: string | null;
  fornecedor: string | null;
  favorecido?: string | null;         // nome da transferência (CNAB)
  cnpj_cpf?: string | null;
  categoria_codigo?: string | null;
  categoria_descricao?: string | null;
  documento?: string | null;
  documento_fiscal?: string | null;
  observacao?: string | null;
  parcela?: string | null;
  valor: number;
  valor_aberto?: number | null;
  status: string | null;
};

/** Como a conferência classificou um evento de pagamento da agenda. */
export type Situacao =
  | "provisionado"   // tem título no Omie vencendo no dia
  | "outra_data"     // tem título, mas vencendo em outro dia da janela
  | "valor_diverge"  // achou o fornecedor no dia, com valor diferente do da agenda
  | "ausente"        // nada no Omie → NÃO PROVISIONADO
  | "rotina";        // não é pagamento (fechamento, "quinto dia útil"…) — não confere

export type Conferencia = {
  evento: string;            // título do evento como veio da agenda
  rotulo: string;            // o que se paga, limpo ("Singular | Limpeza")
  valorAgenda: number | null;
  situacao: Situacao;
  titulos: TituloOmie[];     // títulos casados, do mais provável para o menos
  totalOmie: number;         // soma dos títulos casados
  motivo: string;            // frase curta para a tela
};

export type Conciliacao = {
  itens: Conferencia[];
  /** Os que precisam de ação: sem título, valor divergente ou vencendo noutro dia. */
  alertas: Conferencia[];
  /** Títulos do dia no Omie que nenhum evento da agenda reivindicou. */
  semAgenda: TituloOmie[];
  semAgendaPorCategoria: { categoria: string; n: number; total: number }[];
  resumo: {
    naAgenda: number;        // eventos conferíveis (fora as rotinas)
    provisionados: number;
    naoProvisionados: number;
    nOmieDia: number;
    totalOmieDia: number;
    nSemAgenda: number;
    totalSemAgenda: number;
  };
};

/* ------------------------------- parsing ---------------------------------- */

/** "Pagar:", "Pagamento de", "Pgto" — o verbo, não o que se paga. */
const PREFIXO = /^\s*(pagar|pagamento|pagto|pgto)\s*(de|da|do)?\s*[:\-–—|]?\s*/i;

/**
 * Eventos de dia inteiro que NÃO são um pagamento específico: rotinas do time e
 * lembretes. Ficam neutros na tela — alertar "Fechamento do Tracker não está
 * provisionado" só ensinaria a ignorar o alerta.
 */
const ROTINA = /(fechamento|dia util|dia utl|conferir|checar|revis|reuni|feriado|folga|ferias|anivers|prazo|lembrete)/i;

/** Palavras que não identificam ninguém — não servem para casar. */
const VAZIAS = new Set([
  "PAGAR", "PAGAMENTO", "PAGAMENTOS", "PAGTO", "PGTO", "DE", "DA", "DO", "DAS", "DOS",
  "E", "O", "A", "OS", "AS", "EM", "NO", "NA", "COM", "PARA", "REF", "REFERENTE",
  "NF", "NFE", "NOTA", "FISCAL", "BOLETO", "PIX", "TED", "DOC", "PARCELA", "PARCELAS",
  "MES", "MENSAL", "VALOR", "TOTAL", "CONTA", "CONTAS", "RS", "R", "VENC", "VENCIMENTO",
]);

/** "R$ 4.361,00" → 4361 · "R$ 90,00" → 90 · "R$ 6.000" → 6000 */
export function extrairValor(texto: string): number | null {
  const m = /R\$\s*([\d.]+(?:,\d{1,2})?)/i.exec(texto || "");
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return isFinite(n) && n > 0 ? n : null;
}

export type EventoPagamento = {
  evento: string;
  rotulo: string;
  valor: number | null;
  tokens: string[];
  rotina: boolean;
};

/**
 * Lê um evento de dia inteiro da agenda.
 *
 * O normalizador do briefing junta a nota do evento no título com " · "
 * ("Pagar: Singular · NF 524 anexada"). A nota entra só para achar o valor: os
 * tokens dela (e-mail do Pix, número de NF) casariam com qualquer coisa.
 */
export function lerEventoPagamento(titulo: string): EventoPagamento {
  const evento = String(titulo ?? "").trim();
  const [principal = "", ...notas] = evento.split("·").map((s) => s.trim());

  const valor = extrairValor(principal) ?? extrairValor(notas.join(" "));
  const rotulo = principal
    .replace(PREFIXO, "")
    .replace(/[-–—|,;]?\s*R\$\s*[\d.,]+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim() || principal;

  const tokens = normalize(rotulo)
    .split(" ")
    .filter((t) => t.length >= 3 && !VAZIAS.has(t) && !/^\d+$/.test(t));

  return { evento, rotulo, valor, tokens, rotina: ROTINA.test(normalize(principal)) };
}

/* -------------------------------- matching -------------------------------- */

const PESO = { valor: 0.6, nome: 0.8, similaridade: 0.6, observacao: 0.75, categoria: 0.5 };
const MINIMO = 0.5;   // categoria sozinha já entra como candidata

/**
 * A observação como texto útil. O Omie carimba "Conta a Pagar importada
 * automaticamente em DD/MM/AAAA às HH:MM." em tudo que vem da importação de
 * folha, e o que interessa vem depois do "|" (o nome da pessoa, o que é o
 * pagamento). Exportada porque a tela mostra a mesma versão limpa.
 */
export function limparObservacao(obs?: string | null): string {
  return String(obs ?? "")
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p && !/importad[ao] automaticamente/i.test(p))
    .join(" · ")
    .trim();
}

/** Diferença aceitável entre o valor da agenda e o do título (0,5%, mínimo 5 centavos). */
const casaValor = (titulo: number, agenda: number) =>
  Math.abs(titulo - agenda) <= Math.max(0.05, agenda * 0.005);

/**
 * O token do evento aparece entre as palavras do título?
 *
 * Palavra inteira, com uma folga só para PLURAL: a partir de 5 letras, uma
 * sendo prefixo da outra e com no máximo 2 letras de diferença conta
 * ("REEMBOLSOS" na agenda × "Reembolso:" na observação).
 *
 * Os dois limites vieram de erro real:
 *  • sem o piso de 5 letras, "ISS" casava dentro de "COMISSAO";
 *  • sem o teto de 2 letras de diferença, "PARCELAMENTO" (do "Parcelamento ISS")
 *    casava com o "(2 parcela)" da observação de outro título.
 */
function casaPalavra(token: string, palavras: Set<string>): boolean {
  if (palavras.has(token)) return true;
  if (token.length < 5) return false;
  for (const p of palavras) {
    if (p.length < 5 || Math.abs(p.length - token.length) > 2) continue;
    if (p.startsWith(token) || token.startsWith(p)) return true;
  }
  return false;
}

function pontuar(ev: EventoPagamento, t: TituloOmie): number {
  const nome = normalize([t.fornecedor, t.favorecido].filter(Boolean).join(" "));
  const cat = normalize(t.categoria_descricao ?? "");
  // Observação + documento/NF: o texto que o time escreveu no título.
  const texto = normalize([limparObservacao(t.observacao), t.documento, t.documento_fiscal].filter(Boolean).join(" "));
  const palavras = (s: string) => new Set(s.split(" ").filter(Boolean));
  const pNome = palavras(nome);
  const pTexto = palavras(texto);
  const pCat = palavras(cat);

  // Quem IDENTIFICA é nome, texto do título ou categoria. Valor igual sozinho não
  // identifica ninguém: num dia de folha há vários títulos de R$ 5.000 / R$ 6.000,
  // e casar por valor daria "provisionado" apontando para o fornecedor errado.
  let identificacao = 0;
  if (ev.tokens.some((tk) => casaPalavra(tk, pNome))) identificacao += PESO.nome;
  // similarity() faz substring, que a 3-4 letras casa lixo ("ISS" ⊂ "COMISSAO") —
  // só vale para rótulo longo, e aí pega variação de grafia do nome inteiro.
  else if (ev.rotulo.length >= 6 && nome && similarity(ev.rotulo, nome) >= 0.6) identificacao += PESO.similaridade;
  if (ev.tokens.some((tk) => casaPalavra(tk, pTexto))) identificacao += PESO.observacao;
  if (ev.tokens.some((tk) => casaPalavra(tk, pCat))) identificacao += PESO.categoria;
  if (identificacao === 0) return 0;

  return identificacao + (ev.valor != null && casaValor(t.valor, ev.valor) ? PESO.valor : 0);
}

/** Como o título aparece na tela: quem recebe + o que o time escreveu nele. */
export function descreverTitulo(t: TituloOmie): string {
  const quem = t.fornecedor || t.favorecido || t.categoria_descricao || `título ${t.cod_titulo}`;
  const obs = limparObservacao(t.observacao);
  return obs && !normalize(quem).includes(normalize(obs)) ? `${quem} — ${obs}` : quem;
}

const fmtData = (iso: string) => {
  const [y, m, d] = String(iso).split("-");
  return d ? `${d}/${m}` : String(iso);
};
const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Confronta os pagamentos da agenda com os títulos do Omie.
 *
 * @param eventos eventos de dia inteiro do briefing (só o título importa)
 * @param titulos retorno de `pagamentos_previstos` — a JANELA inteira, não só o dia
 * @param dia     dia do briefing (YYYY-MM-DD)
 */
export function conciliarPagamentos(
  eventos: { titulo: string }[],
  titulos: TituloOmie[],
  dia: string,
): Conciliacao {
  const doDia = titulos.filter((t) => t.vencimento === dia);
  const reivindicados = new Set<number>();

  const itens: Conferencia[] = (eventos ?? []).map(({ titulo }) => {
    const ev = lerEventoPagamento(titulo);
    const base = { evento: ev.evento, rotulo: ev.rotulo, valorAgenda: ev.valor };

    if (ev.rotina || ev.tokens.length === 0) {
      return { ...base, situacao: "rotina" as const, titulos: [], totalOmie: 0, motivo: "rotina do dia — sem confronto" };
    }

    const ordenar = (lista: TituloOmie[]) =>
      lista
        .map((t) => ({ t, score: pontuar(ev, t) }))
        .filter((x) => x.score >= MINIMO)
        .sort((a, z) =>
          z.score - a.score ||
          (ev.valor != null ? Math.abs(a.t.valor - ev.valor) - Math.abs(z.t.valor - ev.valor) : z.t.valor - a.t.valor))
        .map((x) => x.t);

    const noDia = ordenar(doDia);
    const fecha = (lista: TituloOmie[], situacao: Situacao, motivo: string): Conferencia => {
      lista.forEach((t) => reivindicados.add(t.cod_titulo));
      return { ...base, situacao, titulos: lista, totalOmie: lista.reduce((s, t) => s + t.valor, 0), motivo };
    };

    if (noDia.length) {
      const exatos = ev.valor != null ? noDia.filter((t) => casaValor(t.valor, ev.valor!)) : [];
      if (ev.valor != null && !exatos.length) {
        // Achou o fornecedor/categoria no dia, mas nenhum título com o valor da
        // agenda. NÃO marca como reivindicado de propósito: se o valor não bate,
        // não dá para afirmar que é o mesmo pagamento — o título segue contando
        // na lista "no Omie e fora da agenda", que assim continua honesta.
        const perto = noDia.slice(0, 3);
        return {
          ...base,
          situacao: "valor_diverge",
          titulos: perto,
          totalOmie: perto.reduce((s, t) => s + t.valor, 0),
          motivo: `agenda diz ${fmtBRL(ev.valor)}; no Omie hoje: ${perto.map((t) => fmtBRL(t.valor)).join(", ")}`,
        };
      }
      const casados = exatos.length ? exatos : noDia;
      const pago = casados.every((t) => /pago|liquidad/i.test(t.status ?? ""));
      return fecha(
        casados,
        "provisionado",
        pago ? "provisionado e já baixado no Omie" : `provisionado no Omie · ${fmtBRL(casados.reduce((s, t) => s + t.valor, 0))}`,
      );
    }

    const foraDoDia = ordenar(titulos.filter((t) => t.vencimento !== dia));
    if (foraDoDia.length) {
      const comValor = ev.valor != null ? foraDoDia.filter((t) => casaValor(t.valor, ev.valor!)) : [];
      const t = (comValor.length ? comValor : foraDoDia)[0];
      return {
        ...base,
        situacao: "outra_data",
        titulos: [t],
        totalOmie: t.valor,
        motivo: `no Omie, mas vencendo em ${fmtData(t.vencimento)} · ${fmtBRL(t.valor)}`,
      };
    }

    return { ...base, situacao: "ausente", titulos: [], totalOmie: 0, motivo: "sem título no Omie para hoje" };
  });

  const semAgenda = doDia
    .filter((t) => !reivindicados.has(t.cod_titulo))
    .sort((a, z) => z.valor - a.valor);

  const porCat = new Map<string, { n: number; total: number }>();
  semAgenda.forEach((t) => {
    const k = t.categoria_descricao || t.categoria_codigo || "sem categoria";
    const cur = porCat.get(k) ?? { n: 0, total: 0 };
    porCat.set(k, { n: cur.n + 1, total: cur.total + t.valor });
  });

  const conferiveis = itens.filter((i) => i.situacao !== "rotina");
  return {
    itens,
    alertas: conferiveis.filter((i) => i.situacao !== "provisionado"),
    semAgenda,
    semAgendaPorCategoria: [...porCat.entries()]
      .map(([categoria, v]) => ({ categoria, ...v }))
      .sort((a, z) => z.total - a.total),
    resumo: {
      naAgenda: conferiveis.length,
      provisionados: conferiveis.filter((i) => i.situacao === "provisionado").length,
      naoProvisionados: conferiveis.filter((i) => i.situacao === "ausente").length,
      nOmieDia: doDia.length,
      totalOmieDia: doDia.reduce((s, t) => s + t.valor, 0),
      nSemAgenda: semAgenda.length,
      totalSemAgenda: semAgenda.reduce((s, t) => s + t.valor, 0),
    },
  };
}
