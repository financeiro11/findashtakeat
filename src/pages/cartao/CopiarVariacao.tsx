/* ---------------------------------------------------------------------------
 * Levar a variação da fatura para fora da tela: a mensagem do WhatsApp.
 *
 * Mesmo gesto (e mesma porta) do "copiar como texto" da ponte da DRE
 * (`@/components/demonstracoes/CopiarPonte`): a prévia é EDITÁVEL de propósito.
 * O "por que" do mês — "o Datadog subiu porque migramos o cluster" — não está em
 * lançamento nenhum, e é ele que faz a mensagem valer; copiar sem poder escrever
 * essa linha obrigaria a colar no WhatsApp, editar lá e conferir de novo.
 *
 * O formato e o corte escolhidos ficam guardados: quem manda essa mensagem manda
 * sempre do mesmo jeito, e o mês seguinte não pode voltar ao padrão.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppLogo } from "@/components/brand-logos";
import { apelidoDe } from "@/lib/apelidos";
import { useApelidos } from "@/hooks/useApelidos";
import type { Analise } from "./analise";
import {
  quantasLinhas, textoDaVariacao, variacaoDaFatura,
  type Bloco, type Eixo, type Formato,
} from "./variacaoTexto";

const CHAVE_FORMATO = "cartao.variacao.formatoCopia";
const CHAVE_CORTE = "cartao.variacao.corteCopia";

function formatoPreferido(): Formato {
  try {
    const v = localStorage.getItem(CHAVE_FORMATO);
    return v === "completo" || v === "contexto" ? v : "enxuto";
  } catch { return "enxuto"; }
}
function cortePreferido(): number {
  try {
    const v = Number(localStorage.getItem(CHAVE_CORTE));
    return [0, 1000, 5000].includes(v) ? v : 1000;
  } catch { return 1000; }
}
function guardar(chave: string, valor: string) {
  try { localStorage.setItem(chave, valor); } catch { /* modo privado */ }
}

function Pilula({
  ativa, onClick, titulo, children, disabled,
}: {
  ativa: boolean;
  onClick: () => void;
  titulo?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={titulo}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10.5px] transition disabled:cursor-not-allowed disabled:opacity-40",
        ativa ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 w-[34px] shrink-0 text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {rotulo}
      </span>
      {children}
    </div>
  );
}

const FORMATOS: { valor: Formato; rotulo: string; ajuda: string }[] = [
  { valor: "enxuto", rotulo: "Mensagem", ajuda: "Uma frase de abertura e só nome + quanto se mexeu — é o que cabe num WhatsApp" },
  { valor: "completo", rotulo: "Como no tracker", ajuda: "VAR com o total e, em cada linha, os dois meses cheios com a diferença abreviada" },
  { valor: "contexto", rotulo: "Com contexto", ajuda: "Antes da lista, o total das duas faturas e o percentual — para quem não está com a tela aberta" },
];

const CORTES: { valor: number; rotulo: string }[] = [
  { valor: 1000, rotulo: "≥ 1k" },
  { valor: 5000, rotulo: "≥ 5k" },
  { valor: 0, rotulo: "tudo" },
];

/**
 * O "copiar como texto" da última fatura contra a anterior. Some sozinho quando
 * não há uma fatura anterior — sem base não existe variação para contar.
 */
export function CopiarVariacao({ analise }: { analise: Analise }) {
  const [aberto, setAberto] = useState(false);
  const [eixo, setEixo] = useState<Eixo>("estabelecimento");
  const [bloco, setBloco] = useState<Bloco>("subiu");
  const [formato, setFormato] = useState<Formato>(formatoPreferido);
  const [corte, setCorte] = useState<number>(cortePreferido);

  /* O nome que vai na mensagem é o mesmo que está na matriz — o apelido da
     Parametrização, não o que o adquirente mandou no OFX. */
  const apelidos = useApelidos();
  const nomeDe = useCallback(
    (chave: string) => {
      const ap = apelidoDe(apelidos, chave);
      return ap ? { nome: ap.apelido, oQueE: ap.oQueE } : null;
    },
    [apelidos],
  );

  const variacao = useMemo(() => variacaoDaFatura(analise, eixo, nomeDe), [analise, eixo, nomeDe]);

  const gerado = useMemo(
    () => (variacao ? textoDaVariacao(variacao, { formato, bloco, corte }) : ""),
    [variacao, formato, bloco, corte],
  );
  /* O texto é editável, então ele é estado — e volta ao gerado a cada troca de
     controle. Perder uma frase escrita à mão ao trocar o formato é o preço de a
     prévia ser sempre a verdade do que vai ser copiado. */
  const [texto, setTexto] = useState(gerado);
  useEffect(() => { setTexto(gerado); }, [gerado]);

  if (!variacao) return null;

  const quantos = (b: Bloco) =>
    b === "subiu" ? variacao.subiu.length
    : b === "caiu" ? variacao.caiu.length
    : variacao.subiu.length + variacao.caiu.length;

  const nomes = quantasLinhas(variacao, bloco, corte);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Texto copiado — é só colar na conversa.");
      setAberto(false);
    } catch {
      toast.error("O navegador bloqueou a cópia. Selecione o texto e copie à mão.");
    }
  };

  /* Sem número: o WhatsApp abre com a lista de conversas para escolher. A
     mensagem já vai escrita, então não há o que redigitar do outro lado. */
  const abrirWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    setAberto(false);
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
          title="Copiar as principais diferenças desta fatura como texto — para mandar no WhatsApp ou colar no tracker"
        >
          <Copy className="h-3 w-3" /> copiar como texto
          <ChevronDown className={cn("h-3 w-3 transition-transform", aberto && "rotate-180")} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[440px] p-3" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2">
          <Linha rotulo="Leva">
            <Pilula ativa={bloco === "subiu"} onClick={() => setBloco("subiu")} disabled={!quantos("subiu")}>
              Gastou a mais
            </Pilula>
            <Pilula ativa={bloco === "caiu"} onClick={() => setBloco("caiu")} disabled={!quantos("caiu")}>
              Gastou a menos
            </Pilula>
            <Pilula ativa={bloco === "ambos"} onClick={() => setBloco("ambos")} disabled={!quantos("ambos")}>
              Os dois
            </Pilula>
          </Linha>

          <Linha rotulo="De">
            <Pilula ativa={eixo === "estabelecimento"} onClick={() => setEixo("estabelecimento")}>
              Estabelecimento
            </Pilula>
            <Pilula ativa={eixo === "categoria"} onClick={() => setEixo("categoria")}>
              Categoria
            </Pilula>
          </Linha>

          <Linha rotulo="Corte">
            {CORTES.map((c) => (
              <Pilula
                key={c.valor}
                ativa={corte === c.valor}
                titulo={
                  c.valor
                    ? `Só quem se mexeu ${c.rotulo.replace("≥ ", "R$ ")} ou mais; o resto entra somado na última linha`
                    : "Todo mundo que se mexeu, sem corte"
                }
                onClick={() => { setCorte(c.valor); guardar(CHAVE_CORTE, String(c.valor)); }}
              >
                {c.rotulo}
              </Pilula>
            ))}
          </Linha>

          <Linha rotulo="Jeito">
            {FORMATOS.map((f) => (
              <Pilula
                key={f.valor}
                ativa={formato === f.valor}
                titulo={f.ajuda}
                onClick={() => { setFormato(f.valor); guardar(CHAVE_FORMATO, f.valor); }}
              >
                {f.rotulo}
              </Pilula>
            ))}
          </Linha>

          {/* A prévia é editável de propósito: o "por que" do mês não está em
              lançamento nenhum, e é ele que a pessoa acrescenta antes de mandar. */}
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            spellCheck={false}
            className="num max-h-[240px] min-h-[130px] resize-y text-[11px] leading-relaxed"
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-muted-foreground">
              {nomes} {nomes === 1 ? "linha" : "linhas"} · dá para editar antes de copiar
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={abrirWhatsApp}
                disabled={!texto.trim()}
                title="Abre o WhatsApp com a mensagem já escrita — a conversa você escolhe lá"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium transition hover:bg-secondary disabled:opacity-40"
              >
                <WhatsAppLogo className="h-3 w-3" /> WhatsApp
              </button>
              <button
                onClick={copiar}
                disabled={!texto.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition hover:opacity-90 disabled:opacity-40"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}