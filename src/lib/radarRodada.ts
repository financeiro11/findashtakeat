import { fonteLabel } from "@/lib/radarPrecos";

/**
 * O que cada fonte disse numa rodada do radar, separado em FALHA e FORA DO ASSUNTO.
 *
 * "Fora do rodízio" e "mesmo estoque de" são desenho, não problema — contá-los
 * como aviso ensinaria a pessoa a ignorar o amarelo, que é onde moram os
 * problemas reais. Usado pelo toast da varredura manual e pelo resumo fixo
 * "Última rodada" da tela.
 */
export function lerFontes(porAlvo: unknown): { falhas: string[]; foraDoAssunto: string[] } {
  const falhas = new Set<string>();
  const fora = new Set<string>();
  for (const pa of (Array.isArray(porAlvo) ? porAlvo : []) as { fontes?: Record<string, unknown> }[]) {
    for (const [fonte, txt] of Object.entries(pa?.fontes ?? {})) {
      const s = String(txt);
      if (s.startsWith("fora do assunto")) { fora.add(fonteLabel(fonte)); continue; }
      if (/^\d+ anúncios/.test(s) || s.startsWith("fora do rodízio") || s.startsWith("mesmo estoque de")) continue;
      falhas.add(`${fonteLabel(fonte)}: ${s}`);
    }
  }
  return { falhas: [...falhas], foraDoAssunto: [...fora] };
}
