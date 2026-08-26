// Formatação da camada mobile. Sempre BR: R$ 1.234,56 e DD/MM/AAAA.
//
// Aqui os formatadores devolvem STRING pura, não ReactNode: no celular não existe hover,
// então a convenção do desktop (valor abreviado + título com o número cheio, ver
// src/lib/valor.ts) não se aplica — o mobile mostra o valor cheio direto.

export const fmtBRL = (n: number | null | undefined): string =>
  (n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const fmtInt = (n: number | null | undefined): string =>
  Math.round(n ?? 0).toLocaleString("pt-BR");

/**
 * Valor curto, para caber onde "R$ 105.807,17" não cabe — um terço da largura do celular,
 * no rodapé de um cartão de KPI. Abaixo de mil sai inteiro, com centavos, porque aí a
 * abreviação não economiza nada e o centavo ainda importa.
 */
export function fmtBRLCurto(n: number | null | undefined): string {
  const v = n ?? 0;
  const mag = Math.abs(v);
  // O sinal fica FORA do "R$", como o Intl faz em `fmtBRL` ("-R$ 98,70") — duas convenções
  // de menos na mesma tela é o tipo de detalhe que faz o número parecer de outro sistema.
  const curto = (div: number, sufixo: string) =>
    `${v < 0 ? "-" : ""}R$ ${(mag / div).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${sufixo}`;
  if (mag >= 1_000_000) return curto(1_000_000, "mi");
  if (mag >= 1_000) return curto(1_000, "mil");
  return fmtBRL(v);
}

export const fmtPct = (n: number | null | undefined, casas = 1): string =>
  `${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** "2026-08-06" ou ISO completo → "06/08/2026". Aceita só a parte da data para não
 *  deslocar um dia por fuso (`prazo` é DATE, não timestamp). */
export function fmtData(valor: string | null | undefined): string {
  if (!valor) return "—";
  const [ano, mes, dia] = valor.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}

/** ISO com hora → "06/08/2026 09:14". */
export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Dado velho demais para se confiar sem avisar. Os snapshots são alimentados por cron
 * diário; passando de 48h alguma sync parou e o número na tela não é o de hoje.
 */
export function desatualizado(iso: string | null | undefined, horas = 48, agora = Date.now()): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return agora - t > horas * 3_600_000;
}

/** Data de hoje em AAAA-MM-DD no fuso de São Paulo — base de comparação de `prazo`. */
export const hojeISO = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * A data a `dias` de hoje, em AAAA-MM-DD (0 = hoje). É o que os atalhos de adiar prazo
 * escrevem em `tarefas.prazo`.
 *
 * A conta é feita em UTC de propósito: somar 86.400.000 ms sobre um `Date` local cai um dia
 * inteiro quando a soma atravessa uma virada de horário de verão, e prazo errado por um dia
 * é exatamente o tipo de erro que ninguém percebe até a cobrança chegar.
 */
export function emDias(dias: number, hoje = hojeISO()): string {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1, dia) + dias * 86_400_000);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${alvo.getUTCFullYear()}-${dois(alvo.getUTCMonth() + 1)}-${dois(alvo.getUTCDate())}`;
}
