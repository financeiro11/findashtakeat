/**
 * DE QUANDO É O ESPELHO DO ASAAS — a pergunta que as telas respondem com um
 * horário.
 *
 * Duas fontes escrevem em `asaas_cache` desde 15/09/2026, e cada uma deixa a
 * sua marca em `asaas_sync_estado`:
 *   - `webhook`         → o último aviso do Asaas (segundos depois da mudança);
 *   - `payment:<escopo>` → a última varredura (três vezes por dia).
 * O dado é tão novo quanto a mais recente das duas. Mostrar só a varredura fazia
 * a tela dizer "lido às 17:07" sobre uma cobrança que chegou às 17:40.
 */

export type EstadoAsaas = { escopo: string; ultima_incremental: string | null };
export type LidoDoAsaas = { em: string; aviso: string | null; varredura: string | null };

const ms = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** O mais recente entre o aviso e a varredura; `null` quando não há nenhum. */
export function lidoDoAsaas(linhas: EstadoAsaas[]): LidoDoAsaas | null {
  let aviso: string | null = null;
  let varredura: string | null = null;
  for (const l of linhas) {
    if (ms(l.ultima_incremental) == null) continue;
    if (l.escopo === "webhook") aviso = l.ultima_incremental;
    else if (varredura == null || ms(l.ultima_incremental)! > ms(varredura)!) varredura = l.ultima_incremental;
  }
  const em = [aviso, varredura].filter(Boolean).sort((a, b) => ms(b)! - ms(a)!)[0] ?? null;
  return em ? { em, aviso, varredura } : null;
}

const hora = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function tituloLidoDoAsaas(l: LidoDoAsaas): string {
  return [
    l.aviso ? `Último aviso do Asaas: ${hora(l.aviso)}.` : "Nenhum aviso do Asaas registrado.",
    l.varredura ? `Última varredura: ${hora(l.varredura)}.` : null,
    "O Asaas avisa o Hub a cada cobrança criada, paga ou editada; a varredura (3× ao dia) é a rede para aviso perdido. " +
      "Faltando algo, “Atualizar do Asaas” busca pelo termo digitado.",
  ].filter(Boolean).join("\n");
}

/**
 * A foto calculada (`asaas_snapshots`) é mais velha que o espelho?
 *
 * A foto do /asaas só era refeita pelas varreduras; com o webhook, o espelho
 * anda o dia inteiro e a foto fica para trás. Recalcular é local (RPC sobre o
 * espelho, nenhuma requisição ao Asaas) — mas não à toa: só quando algo chegou
 * DEPOIS de a foto ser gerada.
 */
export function fotoAtrasada(geradoEm: string | null | undefined, lido: LidoDoAsaas | null): boolean {
  const g = ms(geradoEm);
  const l = ms(lido?.em);
  if (l == null) return false;
  return g == null || l > g;
}
