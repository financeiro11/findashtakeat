// Achar as PARCELAS IRMÃS de um título no Omie.
//
// O PROBLEMA. A nota vai ao ERP anexada a UM título. Quando a compra foi
// parcelada, o Omie criou N títulos e o documento fica só no que casou — quem
// abrir a parcela 5/8 não encontra nada, e o contador cobra a nota que já
// existe. É preciso saber quem são as irmãs.
//
// O OMIE NÃO DIZ. Medido em 27/08/2026 nos 1.102 títulos parcelados da Takeat:
// `numero_documento` está VAZIO em 100% deles, `numero_pedido` também. Não há
// campo de agrupamento preenchido. Sobram os sinais indiretos.
//
// DOIS CAMINHOS, e o futuro é o bom:
//
//   CARTÃO (daqui pra frente). Quem cria o título é o próprio Hub, e ele grava
//   `codigo_lancamento_integracao = CARTAO-<fitid>-NN`. O fitid é o mesmo em
//   todas as parcelas da compra, então o agrupamento é EXATO — não é palpite,
//   é a chave que nós mesmos escrevemos. Ver `_shared/cartao-envio.ts`.
//
//   PLANILHA (o passado). Lançamento manual, sem chave nenhuma. Aqui o
//   casamento é por evidência: mesmo fornecedor, mesmo denominador de parcela,
//   mesmo valor exato, vencimentos avançando um mês por parcela, e nenhum
//   número repetido dentro do grupo.
//
// POR QUE VALOR EXATO E NÃO "MAIS OU MENOS". A intuição diz para tolerar
// centavos, porque parcelamento costuma jogar a sobra na primeira ou na última.
// Nesta base isso NÃO acontece: dos 401 grupos (fornecedor × denominador), 393
// têm valor único e **nenhum** varia até R$ 1 — os 8 que variam, variam muito,
// e são compras genuinamente diferentes do mesmo fornecedor. Tolerar centavos
// não recuperaria série nenhuma e passaria a fundir compras distintas.
//
// O QUE SOBRA AMBÍGUO. Duas compras idênticas do mesmo fornecedor, no mesmo dia,
// no mesmo plano — os números repetem ([1,1,2,2,3,3]) e não há como separar sem
// olhar a nota. Foram 6 casos em 162 grupos, todos do mesmo fornecedor. Esses
// NÃO são anexados sozinhos: viram proposta para alguém confirmar. Anexar a nota
// errada no ERP é pior que não anexar.

export interface TituloOmie {
  /** codigo_lancamento_omie */
  cod: number;
  /** "004/008" como o Omie devolve em cNumParcela. */
  parc?: string | null;
  /** código do cliente/fornecedor */
  cli?: string | null;
  valor: number;
  /** vencimento ISO (YYYY-MM-DD) */
  venc?: string | null;
  /** `codigo_lancamento_integracao`, quando o título nasceu no Hub. */
  integracao?: string | null;
}

export interface Parcela { n: number; de: number }

/** "004/008" → { n: 4, de: 8 }. Devolve null para título à vista ou formato estranho. */
export function lerParcela(parc: string | null | undefined): Parcela | null {
  const m = String(parc ?? "").trim().match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (!m) return null;
  const n = Number(m[1]);
  const de = Number(m[2]);
  // `de <= 1` é à vista disfarçado de parcela; `n > de` é dado corrompido.
  if (!de || de <= 1 || !n || n > de) return null;
  return { n, de };
}

/** O fitid da compra dentro de `CARTAO-<fitid>-NN`. Null quando não é do cartão. */
export function fitidDoCartao(integracao: string | null | undefined): string | null {
  const m = String(integracao ?? "").match(/^CARTAO-(.+)-(\d{2})$/);
  return m ? m[1] : null;
}

/** Meses entre dois ISO (YYYY-MM-DD), pelo calendário e não por dias. */
export function mesesEntre(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

/**
 * A janela de vencimentos onde as irmãs precisam ser procuradas.
 *
 * Calculada A PARTIR DO PRÓPRIO TÍTULO, e não uma janela fixa: 1.036 dos 1.102
 * parcelados têm `n > 1`, ou seja, a série começou antes do mês corrente. Uma
 * janela fixa em torno de hoje acharia só o pedaço do meio.
 *
 * A folga de um mês para cada lado cobre vencimento que caiu em fim de semana e
 * foi empurrado.
 */
export function janelaDasIrmas(venc: string, p: Parcela, folgaMeses = 1): { de: string; ate: string } {
  const [y, m, d] = venc.split("-").map(Number);
  const desloca = (meses: number) => {
    const dt = new Date(Date.UTC(y, m - 1 + meses, 1));
    // Dia 1 de propósito na borda: só delimita a busca, não precisa do dia certo.
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-01`;
  };
  const fim = new Date(Date.UTC(y, m - 1 + (p.de - p.n) + folgaMeses + 1, 0));
  return {
    de: desloca(-(p.n - 1) - folgaMeses),
    ate: `${fim.getUTCFullYear()}-${String(fim.getUTCMonth() + 1).padStart(2, "0")}-${String(fim.getUTCDate()).padStart(2, "0")}`,
  };
}

export type ConfiancaIrmas = "exata" | "alta" | "ambigua";

export interface Grupo {
  /** As irmãs encontradas, incluindo o próprio alvo, na ordem da parcela. */
  irmas: TituloOmie[];
  confianca: ConfiancaIrmas;
  /** Por que este veredito — em português, para a tela poder discordar. */
  motivo: string;
  /** Quantas parcelas a compra tem, segundo o próprio título. */
  total: number;
  /** Quantas foram encontradas. Menos que `total` = série incompleta. */
  achadas: number;
}

/**
 * Quem são as irmãs de `alvo` dentro de `candidatos`.
 *
 * `candidatos` deve ser o resultado de uma leitura do Omie na janela de
 * `janelaDasIrmas` — o alvo pode estar ou não incluído; ele é adicionado de
 * qualquer forma.
 */
export function acharIrmas(alvo: TituloOmie, candidatos: TituloOmie[]): Grupo {
  const p = lerParcela(alvo.parc);
  if (!p) {
    return { irmas: [alvo], confianca: "exata", total: 1, achadas: 1, motivo: "título à vista: não há parcela irmã" };
  }

  /* CAMINHO EXATO: o título nasceu no Hub e carrega o fitid da compra. */
  const fitid = fitidDoCartao(alvo.integracao);
  if (fitid) {
    const irmas = candidatos.filter((c) => fitidDoCartao(c.integracao) === fitid);
    const todas = incluirAlvo(irmas, alvo);
    return {
      irmas: ordenar(todas),
      confianca: "exata",
      total: p.de,
      achadas: todas.length,
      motivo: `mesma compra do cartão (${fitid}) — chave gravada pelo próprio Hub`,
    };
  }

  /* CAMINHO POR EVIDÊNCIA: fornecedor + denominador + valor exato. */
  const mesmos = candidatos.filter((c) => {
    if (c.cod === alvo.cod) return false;
    const q = lerParcela(c.parc);
    return !!q && q.de === p.de
      && String(c.cli ?? "") === String(alvo.cli ?? "")
      && String(c.cli ?? "") !== ""
      && Math.abs(c.valor - alvo.valor) < 0.005;
  });

  const todas = ordenar(incluirAlvo(mesmos, alvo));

  /* Duas compras iguais do mesmo fornecedor no mesmo plano fazem o número da
     parcela repetir. Sem a nota na mão ninguém separa — vai para revisão. */
  const numeros = todas.map((t) => lerParcela(t.parc)!.n);
  if (new Set(numeros).size !== numeros.length) {
    return {
      irmas: todas, confianca: "ambigua", total: p.de, achadas: todas.length,
      motivo: `o fornecedor tem mais de uma compra de ${dinheiro(alvo.valor)} em ${p.de}x — as parcelas ${numeros.join(", ")} se repetem e não dá para saber qual é de qual`,
    };
  }

  /* O espaçamento mensal é a trava que salvou a heurística: nos 156 grupos
     limpos da base, TODOS avançam exatamente um mês por parcela. Uma série que
     não avança assim não é uma série. */
  if (todas.length > 1) {
    const comVenc = todas.filter((t) => !!t.venc);
    for (let i = 1; i < comVenc.length; i++) {
      const passoParcela = lerParcela(comVenc[i].parc)!.n - lerParcela(comVenc[i - 1].parc)!.n;
      const passoMes = mesesEntre(comVenc[i - 1].venc!, comVenc[i].venc!);
      if (passoParcela !== passoMes) {
        return {
          irmas: todas, confianca: "ambigua", total: p.de, achadas: todas.length,
          motivo: `os vencimentos não avançam um mês por parcela (${comVenc[i - 1].venc} → ${comVenc[i].venc} para ${passoParcela} parcela(s)) — pode ser outra compra`,
        };
      }
    }
  }

  if (todas.length === 1) {
    return {
      irmas: todas, confianca: "alta", total: p.de, achadas: 1,
      motivo: `nenhuma irmã encontrada na janela — a compra é ${p.de}x, então faltam ${p.de - 1}`,
    };
  }

  return {
    irmas: todas,
    confianca: "alta",
    total: p.de,
    achadas: todas.length,
    motivo: todas.length === p.de
      ? `série completa: ${p.de} parcelas de ${dinheiro(alvo.valor)}, vencendo de mês em mês`
      : `${todas.length} de ${p.de} parcelas encontradas — as outras estão fora da janela lida`,
  };
}

function incluirAlvo(lista: TituloOmie[], alvo: TituloOmie): TituloOmie[] {
  return lista.some((t) => t.cod === alvo.cod) ? lista : [...lista, alvo];
}

function ordenar(lista: TituloOmie[]): TituloOmie[] {
  return [...lista].sort((a, b) => (lerParcela(a.parc)?.n ?? 0) - (lerParcela(b.parc)?.n ?? 0));
}

function dinheiro(v: number): string {
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
