/**
 * O sino — o degrau que faltava entre "interrompe" e "só se você abrir".
 *
 * O Hub já tinha as duas pontas: o modal do `AvisoGrave`, que te acha em
 * qualquer página, e as análises da IA, que morriam dentro da própria tela. Este
 * componente é o meio: está sempre visível, nunca bloqueia, e conta o que você
 * ainda não leu. Foi assim que o usuário pediu em 31/08/2026 — "preciso ser
 * INDUZIDO a ver, não ter que abrir a área; mas nem tudo pode pular na tela".
 *
 * TRÊS DECISÕES QUE O DESENHAM
 *
 * 1. ABRIR É LER. Ao abrir, tudo que está na lista vira "visto". Parece
 *    agressivo e é o certo: o escalonamento (`sinais_escalar`) só promove o que
 *    NINGUÉM viu, então marcar como lido é o que declara "eu sei disso, decidi
 *    não agir agora" — e é isso que impede o sino de te cobrar de novo por algo
 *    que você já leu e dispensou conscientemente.
 *
 * 2. TRÊS BOTÕES, NÃO UM. "Abrir" leva ao lugar; "Feito" fecha porque você
 *    resolveu; "É normal" fecha E ALARGA A BANDA daquela série. O terceiro é o
 *    que impede o sino de morrer de excesso: sem ele, o jeito de calar um falso
 *    positivo seria ignorá-lo, e ele voltaria amanhã igual.
 *
 * 3. A CONTA FICA À VISTA. O hover do rodapé mostra de onde o alarme veio
 *    (medido, normal, quantos meses). Um aviso que não se explica é um aviso em
 *    que ninguém confia na terceira vez.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, ExternalLink, Loader2, ThumbsUp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { valorExato } from "@/lib/valor";
import {
  useSinaisContagem, useSinaisLista, marcarVistos, carimbarSinal, normalizarSinal,
  type Sinal,
} from "@/hooks/useSinais";

const TOM: Record<string, string> = {
  alta: "bg-primary",
  media: "bg-amber-500",
  baixa: "bg-muted-foreground/50",
};

/** "R$ 1,4 mi" — o número cheio fica no hover, como manda a convenção do Hub. */
function valorCurto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toFixed(1).replace(".", ",")} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toFixed(0)} mil`;
  return `R$ ${v.toFixed(0)}`;
}

function desde(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias}d`;
}

/** O rodapé que explica de onde o alarme veio. */
function porQue(m: Sinal["medida"]): string | null {
  if (!m) return null;
  const n = Number(m.n);
  const rel = Number(m.relativo);
  if (!isFinite(rel) || !isFinite(n)) return null;
  const dir = rel < 0 ? "abaixo" : "acima";
  return `${Math.abs(rel * 100).toFixed(0)}% ${dir} do normal · banda de ${n} competências`;
}

function Item({ s, aoFechar }: { s: Sinal; aoFechar: (id: string) => void }) {
  const navigate = useNavigate();
  const [ocupado, setOcupado] = useState(false);

  const ir = () => {
    const destino = (s.rascunho?.rota as string) || s.rota;
    navigate(destino);
  };

  const feito = async () => {
    setOcupado(true);
    try { await carimbarSinal(s.id); aoFechar(s.id); toast.success("Sinal fechado."); }
    catch { toast.error("Não consegui fechar o sinal."); }
    finally { setOcupado(false); }
  };

  const normal = async () => {
    setOcupado(true);
    try {
      const folga = await normalizarSinal(s.id);
      aoFechar(s.id);
      /* Diz o que MUDOU, não "ok". A pessoa precisa saber que ensinou o vigia,
         senão vai clicar aqui achando que só dispensou. */
      toast.success(
        folga && folga >= 4
          ? "Anotado. Esta série já está na folga máxima — só o extremo vai tocar."
          : "Anotado. A banda desta série ficou mais larga.",
      );
    } catch { toast.error("Não consegui registrar."); }
    finally { setOcupado(false); }
  };

  const explicacao = porQue(s.medida);

  return (
    <div className="border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TOM[s.gravidade] ?? TOM.media}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12.5px] font-semibold leading-snug">{s.titulo}</p>
            <span className="shrink-0 text-[10.5px] text-muted-foreground">{desde(s.criado_em)}</span>
          </div>

          {s.corpo && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{s.corpo}</p>
          )}

          {s.acao && (
            <p className="mt-1.5 text-[12px] leading-snug">
              <span className="text-muted-foreground">→ </span>{s.acao}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button onClick={ir} className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Abrir
            </button>
            <button
              onClick={feito}
              disabled={ocupado}
              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Feito
            </button>
            <button
              onClick={normal}
              disabled={ocupado}
              title="Fecha e alarga a banda desta série, para esta variação não voltar a tocar"
              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <ThumbsUp className="h-3 w-3" /> É normal
            </button>

            {s.valor != null && (
              <span title={valorExato(s.valor)} className="ml-auto cursor-help text-[11.5px] font-medium">
                {valorCurto(s.valor)}
              </span>
            )}
          </div>

          {(explicacao || s.dono_nome) && (
            <p className="mt-1.5 text-[10.5px] text-muted-foreground/80">
              {s.dono_nome && <>{s.dono_nome} · </>}
              {explicacao}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function Sino() {
  const [aberto, setAberto] = useState(false);
  const c = useSinaisContagem();
  const { lista, setLista, carregando } = useSinaisLista(aberto);

  const abrir = (v: boolean) => {
    setAberto(v);
    /* Decisão 1: abrir é ler. Marca depois de a lista ter chegado — se marcasse
       antes, uma falha de rede zeraria o contador sem você ter visto nada. */
    if (!v) return;
    setTimeout(() => { marcarVistos([]).catch(() => {}); }, 400);
  };

  const fechar = (id: string) => setLista((l) => l.filter((x) => x.id !== id));

  return (
    <Popover open={aberto} onOpenChange={abrir}>
      <PopoverTrigger asChild>
        <button
          className="ghost-icone relative"
          title={c.novos > 0 ? `${c.novos} sinal(is) não lido(s)` : "Nada novo"}
          aria-label="Sinais"
        >
          <Bell className="h-3.5 w-3.5" />
          {c.novos > 0 && (
            <span
              className={`absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-[3px] text-[9px] font-bold leading-none text-primary-foreground ${
                c.subiram > 0 ? "bg-primary" : "bg-amber-500"
              }`}
            >
              {c.novos > 9 ? "9+" : c.novos}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sinais
          </span>
          {c.total > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {c.total} aberto{c.total > 1 ? "s" : ""}
              {c.meus > 0 && ` · ${c.meus} seu${c.meus > 1 ? "s" : ""}`}
            </span>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {carregando && lista.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo…
            </div>
          )}

          {!carregando && lista.length === 0 && (
            <div className="px-3.5 py-8 text-center">
              <p className="text-[12px] text-muted-foreground">Nada fora da faixa.</p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                O vigia mede as séries todo dia de manhã e avisa aqui.
              </p>
            </div>
          )}

          {lista.map((s) => <Item key={s.id} s={s} aoFechar={fechar} />)}
        </div>
      </PopoverContent>
    </Popover>
  );
}
