import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Filter, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { lerNumero, rotuloMes } from "@/lib/filaParametrizacao";

/* ---------------------------------------------------------------------------
 * O filtro mora no cabeçalho da coluna que ele corta.
 *
 * A alternativa era uma fileira de controles acima da tabela, e ela envelhece
 * mal: com cinco filtros ninguém lembra qual mexe em qual coluna, e a barra
 * cresce mais que a própria tabela. Preso ao `<th>`, o filtro se explica sozinho
 * — e o funil aceso é o único lugar onde se descobre que a lista está cortada.
 *
 * Por isso o funil está SEMPRE visível (apagado quando não corta, não escondido
 * até o hover): filtro que só aparece no hover é filtro que ninguém acha, e pior,
 * filtro esquecido ligado é uma lista que mente.
 * ------------------------------------------------------------------------- */

/** O miolo do popover — o mesmo para os dois gatilhos. */
function CorpoFiltro({
  rotulo, ativo, onLimpar, children,
}: {
  rotulo: string;
  ativo: boolean;
  onLimpar: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[11.5px] font-medium normal-case">{rotulo}</span>
        <button
          type="button"
          disabled={!ativo}
          onClick={onLimpar}
          className="text-[11px] text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          Limpar
        </button>
      </div>
      {children}
    </>
  );
}

export function CabecalhoFiltravel({
  rotulo, ativo, alinhar = "start", largura = "w-64", titulo, onLimpar, children,
}: {
  rotulo: string;
  ativo: boolean;
  /** De que lado o popover encosta — segue o alinhamento da coluna. */
  alinhar?: "start" | "end";
  largura?: string;
  titulo?: string;
  onLimpar: () => void;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={titulo}
          className={cn(
            "-mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 align-middle",
            "font-medium uppercase tracking-wide transition hover:bg-muted hover:text-foreground",
            ativo && "text-primary",
          )}
        >
          <span className="truncate">{rotulo}</span>
          <Filter className={cn("h-2.5 w-2.5 shrink-0", ativo ? "opacity-100" : "opacity-30")} />
        </button>
      </PopoverTrigger>

      <PopoverContent align={alinhar} className={cn("p-0", largura)}>
        <CorpoFiltro rotulo={rotulo} ativo={ativo} onLimpar={onLimpar}>{children}</CorpoFiltro>
      </PopoverContent>
    </Popover>
  );
}

/* ----- o mesmo filtro, agora na barra ---------------------------------------
 * O funil preso ao `<th>` é discreto de propósito, e isso o torna invisível para
 * quem não sabe que ele existe — mais ainda num rótulo de 10px em opacidade 30%.
 * Serve para o filtro que NASCE DESLIGADO: quem procura, acha; quem não procura,
 * não é atrapalhado.
 *
 * Filtro que nasce LIGADO precisa do contrário: um botão na barra, com o corte
 * escrito por extenso ("Último: mês passado"). O `<th>` continua funcionando —
 * é o mesmo estado —, mas quem chega na tela lê o recorte antes de ler a lista,
 * em vez de contar linhas e achar que a fila encolheu sozinha.
 * ------------------------------------------------------------------------- */
export function BotaoFiltravel({
  rotulo, resumo, ativo, largura = "w-64", titulo, Icone, onLimpar, children,
}: {
  rotulo: string;
  /** O corte em palavras — é ele que fica no botão. */
  resumo: string;
  ativo: boolean;
  largura?: string;
  titulo?: string;
  Icone?: LucideIcon;
  onLimpar: () => void;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={titulo}
          className={cn(
            "inline-flex h-[30px] max-w-[260px] items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition",
            ativo
              ? "border-primary/40 bg-primary/[0.06] text-primary hover:bg-primary/10"
              : "border-input bg-background text-foreground hover:bg-muted",
          )}
        >
          {Icone && <Icone className="h-3.5 w-3.5 shrink-0 opacity-80" />}
          <span className="shrink-0 text-muted-foreground">{rotulo}</span>
          <span className={cn("truncate font-medium", !ativo && "text-muted-foreground")}>{resumo}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className={cn("p-0", largura)}>
        <CorpoFiltro rotulo={rotulo} ativo={ativo} onLimpar={onLimpar}>{children}</CorpoFiltro>
      </PopoverContent>
    </Popover>
  );
}

/* ----- lista marcável ------------------------------------------------------
 * `Command` e não uma pilha de `Checkbox` porque a lista de categorias tem 54
 * itens: sem campo de busca, achar "Softwares - Tecnologia" é rolar. O `filter`
 * aceita as palavras em qualquer ordem — mesmo padrão de `SeletorDono` e do
 * seletor de categoria do drill-down. */
export function ListaMarcavel({
  opcoes, marcadas, onAlternar, buscar, vazio = "Nada com esse termo.",
}: {
  opcoes: { valor: string; rotulo: string; apoio?: ReactNode }[];
  marcadas: Set<string>;
  onAlternar: (v: string) => void;
  /** Placeholder do campo de busca. Sem isto, a lista vem sem busca. */
  buscar?: string;
  vazio?: string;
}) {
  return (
    <Command
      filter={(value, search) => {
        const t = value.toLowerCase();
        return search.split(/\s+/).every((s) => t.includes(s.toLowerCase())) ? 1 : 0;
      }}
    >
      {buscar && <CommandInput placeholder={buscar} className="h-9" />}
      <CommandList className="max-h-[260px]">
        <CommandEmpty className="py-4 text-center text-[12px] text-muted-foreground">{vazio}</CommandEmpty>
        <CommandGroup>
          {opcoes.map((o) => (
            <CommandItem
              key={o.valor}
              value={o.rotulo}
              onSelect={() => onAlternar(o.valor)}
              className="gap-2 text-[12px]"
            >
              <Check className={cn("h-3.5 w-3.5 shrink-0", marcadas.has(o.valor) ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1 truncate" title={o.rotulo}>{o.rotulo}</span>
              {o.apoio != null && (
                <span className="shrink-0 num text-[10.5px] text-muted-foreground">{o.apoio}</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/* ----- faixa de número -----------------------------------------------------
 * Campo de texto com estado próprio, e não `value={min ?? ""}` direto: digitando
 * "1.200" o valor já vale 1 no primeiro caractere, e um controlado puro
 * reescreveria o campo para "1" no meio da digitação. O texto só é reposto de
 * fora quando ele deixou de significar o valor — que é o caso do "Limpar". */
function CampoNumero({
  valor, onValor, placeholder, prefixo,
}: {
  valor: number | null;
  onValor: (v: number | null) => void;
  placeholder: string;
  prefixo?: string;
}) {
  const [txt, setTxt] = useState(valor === null ? "" : String(valor));

  useEffect(() => {
    setTxt((t) => (lerNumero(t) === valor ? t : valor === null ? "" : String(valor)));
  }, [valor]);

  return (
    <div className="relative min-w-0 flex-1">
      {prefixo && (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {prefixo}
        </span>
      )}
      <Input
        value={txt}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(e) => { setTxt(e.target.value); onValor(lerNumero(e.target.value)); }}
        className={cn("h-7 num text-[12px]", prefixo ? "pl-7" : "px-2")}
      />
    </div>
  );
}

export function FaixaNumero({
  min, max, onMin, onMax, prefixo, dica,
}: {
  min: number | null;
  max: number | null;
  onMin: (v: number | null) => void;
  onMax: (v: number | null) => void;
  prefixo?: string;
  dica?: string;
}) {
  return (
    <div className="p-2.5">
      <div className="flex items-center gap-1.5">
        <CampoNumero valor={min} onValor={onMin} placeholder="mínimo" prefixo={prefixo} />
        <span className="shrink-0 text-[11px] text-muted-foreground">até</span>
        <CampoNumero valor={max} onValor={onMax} placeholder="máximo" prefixo={prefixo} />
      </div>
      {dica && <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{dica}</p>}
    </div>
  );
}

/* ----- faixa de meses ------------------------------------------------------
 * Só os meses que a fila realmente toca entram na lista: oferecer um mês vazio
 * é oferecer um clique que devolve tela em branco. */
const TODOS = "__todos__";

export function FaixaMeses({
  meses, de, ate, onDe, onAte, dica,
}: {
  meses: string[];
  de: string | null;
  ate: string | null;
  onDe: (v: string | null) => void;
  onAte: (v: string | null) => void;
  /**
   * O que "mês" significa NAQUELA lista, e o padrão é o caso da fila da
   * Parametrização: lá cada linha ocupa um intervalo (primeira × última
   * aparição), então o corte é por interseção. Numa lista onde cada linha tem UM
   * mês — a de títulos, por exemplo — essa frase estaria simplesmente errada.
   */
  dica?: ReactNode;
}) {
  return (
    <div className="p-2.5">
      <div className="flex items-center gap-1.5">
        <Select value={de ?? TODOS} onValueChange={(v) => onDe(v === TODOS ? null : v)}>
          <SelectTrigger className="h-7 min-w-0 flex-1 text-[11.5px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS} className="text-[12px]">desde o começo</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m} className="text-[12px]">{rotuloMes(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="shrink-0 text-[11px] text-muted-foreground">até</span>
        <Select value={ate ?? TODOS} onValueChange={(v) => onAte(v === TODOS ? null : v)}>
          <SelectTrigger className="h-7 min-w-0 flex-1 text-[11.5px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS} className="text-[12px]">até o fim</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m} className="text-[12px]">{rotuloMes(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
        {dica ?? (
          <>
            Quem <strong className="font-medium">apareceu</strong> no intervalo — o fornecedor de mai–jul
            entra num corte de julho.
          </>
        )}
      </p>
    </div>
  );
}
