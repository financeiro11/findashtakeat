import { useEffect, useMemo, useState } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { rotuloGrupo, type Ponte } from "@/lib/ponteVariacao";
import { textoDaPonte, type BlocoCopia, type FormatoCopia } from "@/lib/copiarPonte";

/* ---------------------------------------------------------------------------
 * Levar a ponte para fora da tela: o comentário do tracker e a mensagem.
 *
 * O texto que sai daqui é o que já se escrevia à mão olhando esta mesma tela.
 * Duas portas, porque são dois usos:
 *
 * 1. O CLIPE NO CABEÇALHO DO BLOCO copia AQUELE lado, num clique, no formato
 *    preferido. É o gesto de sempre — "gastou a mais" é o que vai para o
 *    comentário — e não abre nada no caminho.
 *
 * 2. O "COPIAR" DO RODAPÉ abre a prévia. Ali dá para trocar o formato, escolher
 *    os dois lados e EDITAR o texto antes de copiar: a frase de abertura ("a
 *    meta do Sucesso não era batida desde maio") é conhecimento que não está em
 *    lançamento nenhum, e é ela que faz o comentário valer. Copiar sem poder
 *    escrever essa linha obrigaria a colar, editar no Excel e conferir de novo.
 *
 * O formato escolhido fica guardado: quem escreve o comentário do fechamento
 * escreve sempre do mesmo jeito, e o mês seguinte não pode voltar ao padrão.
 * ------------------------------------------------------------------------- */

const CHAVE_FORMATO = "demonstracoes.ponte.formatoCopia";

function formatoPreferido(): FormatoCopia {
  try {
    const v = localStorage.getItem(CHAVE_FORMATO);
    return v === "enxuto" || v === "contexto" ? v : "completo";
  } catch { return "completo"; }
}
function guardarFormato(f: FormatoCopia) {
  try { localStorage.setItem(CHAVE_FORMATO, f); } catch { /* modo privado */ }
}

async function copiarTexto(texto: string, rotulo: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${rotulo} — é só colar no tracker ou mandar na mensagem.`);
    return true;
  } catch {
    toast.error("O navegador bloqueou a cópia. Selecione o texto e copie à mão.");
    return false;
  }
}

type Alvo = {
  ponte: Ponte;
  /** O nome da rubrica — entra no texto dos formatos que dão contexto. */
  rubrica?: string | null;
  mesLabel?: string | null;
};

/** Quantos fornecedores um bloco leva — é o que o botão promete. */
function quantos(ponte: Ponte, bloco: BlocoCopia): number {
  if (bloco === "piora") return ponte.piora.length;
  if (bloco === "melhora") return ponte.melhora.length;
  return ponte.piora.length + ponte.melhora.length + (bloco === "tudo" ? ponte.iguais.length : 0);
}

/**
 * O clipe do cabeçalho de um bloco. Copia na hora, sem abrir nada — e diz
 * quantos fornecedores foram, que é a única coisa que se confere depois.
 */
export function CopiarBloco({ ponte, rubrica, mesLabel, bloco }: Alvo & { bloco: BlocoCopia }) {
  const [copiado, setCopiado] = useState(false);
  const n = quantos(ponte, bloco);
  if (!n) return null;

  const copiar = async () => {
    const texto = textoDaPonte(ponte, { formato: formatoPreferido(), bloco, rubrica, mesLabel });
    if (!texto) return;
    const ok = await copiarTexto(texto, `${n} ${n === 1 ? "fornecedor copiado" : "fornecedores copiados"}`);
    if (!ok) return;
    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 1600);
  };

  return (
    <button
      onClick={(e) => { e.stopPropagation(); void copiar(); }}
      title={`Copiar esta lista (${n} ${n === 1 ? "fornecedor" : "fornecedores"}) para colar no tracker`}
      className="ml-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition hover:bg-background/70"
    >
      {copiado
        ? <Check strokeWidth={3} className="h-3 w-3" />
        : <Copy className="h-3 w-3 opacity-60 transition hover:opacity-100" />}
    </button>
  );
}

const FORMATOS: { valor: FormatoCopia; rotulo: string; ajuda: string }[] = [
  { valor: "completo", rotulo: "Como no tracker", ajuda: "VAR com o total e, em cada linha, os dois meses cheios com a diferença abreviada" },
  { valor: "enxuto", rotulo: "Enxuto", ajuda: "Uma frase de abertura e só nome + quanto se mexeu — cabe numa mensagem" },
  { valor: "contexto", rotulo: "Com contexto", ajuda: "Antes da lista, a rubrica, os dois meses e o percentual — para quem não está com a tela aberta" },
];

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

/**
 * A prévia: escolher o recorte, o formato, escrever a linha que só a pessoa
 * sabe — e copiar o que está à vista, não o que a tela imagina.
 */
export function CopiarPonte({ ponte, rubrica, mesLabel }: Alvo) {
  const [aberto, setAberto] = useState(false);
  const [formato, setFormato] = useState<FormatoCopia>(formatoPreferido);
  const [bloco, setBloco] = useState<BlocoCopia>("ambos");

  const gerado = useMemo(
    () => textoDaPonte(ponte, { formato, bloco, rubrica, mesLabel }),
    [ponte, formato, bloco, rubrica, mesLabel],
  );
  /* O texto é editável, então ele é estado — e volta ao gerado a cada troca de
     formato ou de recorte. Perder uma frase escrita à mão ao trocar o formato é
     o preço de a prévia ser sempre a verdade do que vai ser copiado. */
  const [texto, setTexto] = useState(gerado);
  useEffect(() => { setTexto(gerado); }, [gerado]);

  const blocos: { valor: BlocoCopia; rotulo: string }[] = [
    { valor: "piora", rotulo: rotuloGrupo(ponte, false) },
    { valor: "melhora", rotulo: rotuloGrupo(ponte, true) },
    { valor: "ambos", rotulo: "Os dois" },
    ...(ponte.iguais.length ? [{ valor: "tudo" as BlocoCopia, rotulo: "Tudo" }] : []),
  ];

  const linhas = texto.split("\n").filter((x) => x.trim()).length;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 transition hover:underline"
          title="Copiar esta variação como texto — para o comentário do tracker ou uma mensagem"
        >
          <Copy className="h-3 w-3" /> copiar como texto
          <ChevronDown className={cn("h-3 w-3 transition-transform", aberto && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-3" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Leva</span>
            {blocos.map((b) => (
              <Pilula
                key={b.valor}
                ativa={bloco === b.valor}
                onClick={() => setBloco(b.valor)}
                disabled={quantos(ponte, b.valor) === 0}
              >
                {b.rotulo}
              </Pilula>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Jeito</span>
            {FORMATOS.map((f) => (
              <Pilula
                key={f.valor}
                ativa={formato === f.valor}
                titulo={f.ajuda}
                onClick={() => { setFormato(f.valor); guardarFormato(f.valor); }}
              >
                {f.rotulo}
              </Pilula>
            ))}
          </div>

          {/* A prévia é editável de propósito: o "por que" do mês não está em
              lançamento nenhum, e é ele que a pessoa acrescenta antes de colar. */}
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            spellCheck={false}
            className="num max-h-[220px] min-h-[120px] resize-y text-[11px] leading-relaxed"
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-muted-foreground">
              {linhas} {linhas === 1 ? "linha" : "linhas"} · dá para editar antes de copiar
            </span>
            <button
              onClick={async () => {
                const ok = await copiarTexto(texto, "Texto copiado");
                if (ok) setAberto(false);
              }}
              disabled={!texto.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition hover:opacity-90 disabled:opacity-40"
            >
              <Copy className="h-3 w-3" /> Copiar
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
