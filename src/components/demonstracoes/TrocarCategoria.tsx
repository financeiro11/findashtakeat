import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

/* ---------------------------------------------------------------------------
 * Trocar a categoria de um lançamento — no Hub e no Omie ao mesmo tempo.
 *
 * A categoria escolhida no Omie é o que decide em que linha da DRE/DFC o valor
 * cai. Até aqui, achar o erro no drill-down e corrigi-lo eram coisas separadas:
 * a correção terminava no ERP, na mão. Este seletor fecha o ciclo — a Edge
 * Function `omie-trocar-categoria` altera o título no Omie, confirma relendo o
 * cadastro e só então espelha no cache local.
 *
 * O seletor mostra a RUBRICA de destino, não só o código do plano de contas:
 * quem corrige está mirando a linha da demonstração. E avisa nos dois casos em
 * que a troca não faz o que parece — mês travado (a tela continua com o valor
 * do tracker) e categoria fora do DE-PARA (o lançamento some da demonstração).
 * ------------------------------------------------------------------------- */

export type CategoriaOmie = {
  codigo: string;
  descricao: string;
  despesa: boolean;
  receita: boolean;
  rubrica_dre: string | null;
  rubrica_dfc: string | null;
  usos: number;
};

/** Resposta da Edge Function `omie-trocar-categoria`. */
type RespostaTroca = {
  status: "ok" | "erro";
  erro?: string;
  ja_estava?: boolean;
  de?: { codigo: string | null; descricao: string | null; rubrica_dre: string | null; rubrica_dfc: string | null };
  para?: { codigo: string; descricao: string; rubrica_dre: string | null; rubrica_dfc: string | null };
};

/* As 133 categorias mudam de mês em mês, não de clique em clique. Guardar no
   módulo evita refazer a consulta a cada linha aberta no painel. */
let cacheCategorias: CategoriaOmie[] | null = null;

export function useCategoriasOmie(carregar: boolean) {
  const [categorias, setCategorias] = useState<CategoriaOmie[]>(cacheCategorias ?? []);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!carregar || cacheCategorias) return;
    let vivo = true;
    setCarregando(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("omie_categorias_disponiveis" as any).then(({ data, error }) => {
      if (!vivo) return;
      setCarregando(false);
      if (error) { toast.error("Não consegui carregar as categorias do Omie: " + error.message); return; }
      cacheCategorias = (data as unknown as CategoriaOmie[]) ?? [];
      setCategorias(cacheCategorias);
    });
    return () => { vivo = false; };
  }, [carregar]);

  return { categorias, carregando };
}

const rubricaDe = (c: CategoriaOmie | undefined, tipo: "dre" | "dfc") =>
  (tipo === "dre" ? c?.rubrica_dre : c?.rubrica_dfc) ?? null;

export function CategoriaEditavel({
  codTitulo, codigo, descricao, contraparte, tipo, mes, mesLabel, travado,
  rubricaSugerida, aberto, onAbertoChange, onTrocado,
}: {
  codTitulo: string | null;
  codigo: string | null;
  descricao: string | null;
  contraparte: string | null;
  tipo: "dre" | "dfc";
  mes: string;
  mesLabel: string;
  travado: boolean;
  /** Rubrica em que o fornecedor vinha caindo — vira o primeiro grupo da lista. */
  rubricaSugerida?: string | null;
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  onTrocado: () => void | Promise<void>;
}) {
  const [escolhida, setEscolhida] = useState<CategoriaOmie | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { categorias, carregando } = useCategoriasOmie(aberto);
  const montado = useRef(true);
  useEffect(() => () => { montado.current = false; }, []);

  // Fechar sem confirmar não guarda escolha nenhuma.
  useEffect(() => { if (!aberto) setEscolhida(null); }, [aberto]);

  const atual = categorias.find((c) => c.codigo === codigo);
  const rubricaAtual = rubricaDe(atual, tipo);

  const sugeridas = rubricaSugerida
    ? categorias.filter((c) => rubricaDe(c, tipo) === rubricaSugerida && c.codigo !== codigo)
    : [];
  const sugeridasCod = new Set(sugeridas.map((c) => c.codigo));
  const demais = categorias.filter((c) => !sugeridasCod.has(c.codigo));

  const trocar = useCallback(async () => {
    if (!escolhida || !codTitulo) return;
    setEnviando(true);
    const { data, error } = await supabase.functions.invoke("omie-trocar-categoria", {
      body: { action: "trocar", cod_titulo: codTitulo, codigo: escolhida.codigo, origem: tipo, mes },
    });
    if (!montado.current) return;
    setEnviando(false);

    const resposta = data as RespostaTroca | null;
    if (error || resposta?.status === "erro") {
      const msg = resposta?.erro ?? "Não consegui alterar no Omie. " + (error?.message ?? "");
      // A recusa mais comum: o mês já está fechado no Omie. A mensagem dele diz
      // quem fechou e quando; o que falta é dizer o que fazer com isso.
      const periodoFechado = /per[ií]odo cont[áa]bil/i.test(msg);
      toast.error(msg, {
        duration: 12000,
        description: periodoFechado
          ? "O ERP está com esse mês fechado. Reabra o período no Omie (ou fale com quem fechou) e tente de novo."
          : undefined,
      });
      return;
    }

    const de = resposta?.de?.descricao ?? "categoria anterior";
    const para = resposta?.para?.descricao ?? escolhida.descricao;
    const rubNova = tipo === "dre" ? resposta?.para?.rubrica_dre : resposta?.para?.rubrica_dfc;
    toast.success(
      resposta?.ja_estava
        ? `No Omie já estava em ${para}. O Hub foi acertado.`
        : `No Omie: ${de} → ${para}.` + (rubNova ? ` Vai para ${rubNova}.` : ""),
      { duration: 6000 },
    );
    onAbertoChange(false);
    await onTrocado();
  }, [escolhida, codTitulo, tipo, mes, onAbertoChange, onTrocado]);

  // Sem nCodTitulo não há o que alterar no Omie (não deve acontecer, mas o
  // painel não pode oferecer um botão que não faz nada).
  if (!codTitulo) {
    return (
      <>
        <div className="truncate text-foreground/90" title={descricao ?? undefined}>{descricao ?? "—"}</div>
        <div className="mt-px truncate font-mono text-[9.5px] text-muted-foreground">{codigo ?? "—"}</div>
      </>
    );
  }

  const rubricaEscolhida = rubricaDe(escolhida ?? undefined, tipo);
  const semRubrica = !!escolhida && !rubricaEscolhida;

  return (
    <Popover open={aberto} onOpenChange={onAbertoChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Trocar a categoria deste lançamento no Omie"
          className="group -mx-1 w-full overflow-hidden rounded px-1 py-0.5 text-left transition hover:bg-secondary"
        >
          {/* Coluna de largura fixa: a descrição corta, e o texto inteiro fica
              no hover junto com o convite a trocar. */}
          <div className="flex items-center gap-1 text-foreground/90" title={descricao ?? undefined}>
            <span className="truncate">{descricao ?? "—"}</span>
            <Pencil className="h-2.5 w-2.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
          </div>
          <div className="mt-px truncate font-mono text-[9.5px] text-muted-foreground">{codigo ?? "—"}</div>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[380px] p-0">
        <Command
          filter={(value, search) => {
            const t = value.toLowerCase();
            return search.split(/\s+/).every((s) => t.includes(s.toLowerCase())) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Buscar categoria do Omie…" className="h-9" />
          <CommandList className="max-h-[280px]">
            {carregando && (
              <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando categorias…
              </div>
            )}
            <CommandEmpty>Nenhuma categoria com esse texto.</CommandEmpty>

            {sugeridas.length > 0 && (
              <CommandGroup heading={`Onde ${contraparte ?? "o fornecedor"} vinha caindo`}>
                {sugeridas.map((c) => (
                  <ItemCategoria key={c.codigo} c={c} tipo={tipo} atual={c.codigo === codigo}
                    escolhida={escolhida?.codigo === c.codigo} onEscolher={setEscolhida} />
                ))}
              </CommandGroup>
            )}

            {!carregando && (
              <CommandGroup heading={sugeridas.length ? "Todas as categorias" : "Categorias"}>
                {demais.map((c) => (
                  <ItemCategoria key={c.codigo} c={c} tipo={tipo} atual={c.codigo === codigo}
                    escolhida={escolhida?.codigo === c.codigo} onEscolher={setEscolhida} />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>

        {/* Confirmação: trocar categoria mexe no ERP, não é ajuste de tela. */}
        {escolhida && (
          <div className="border-t border-border bg-muted/40 px-3 py-2.5">
            <div className="text-[11.5px] leading-relaxed text-foreground">
              <b>{descricao ?? codigo}</b> → <b>{escolhida.descricao}</b>
            </div>
            {rubricaEscolhida && rubricaEscolhida !== rubricaAtual && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Na {tipo.toUpperCase()} sai de <b>{rubricaAtual ?? "sem rubrica"}</b> e entra em <b>{rubricaEscolhida}</b>.
              </div>
            )}
            {semRubrica && (
              <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                Esta categoria não está no DE-PARA da {tipo.toUpperCase()} — o lançamento sai da
                demonstração até alguém mapeá-la.
              </div>
            )}
            {travado && (
              <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                {mesLabel} está travado: o Omie muda, mas o valor na tela continua vindo do tracker.
              </div>
            )}
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button
                onClick={() => setEscolhida(null)}
                disabled={enviando}
                className="rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={trocar}
                disabled={enviando}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {enviando ? <><Loader2 className="h-3 w-3 animate-spin" /> Alterando no Omie…</> : "Trocar no Omie"}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ItemCategoria({
  c, tipo, atual, escolhida, onEscolher,
}: {
  c: CategoriaOmie;
  tipo: "dre" | "dfc";
  atual: boolean;
  escolhida: boolean;
  onEscolher: (c: CategoriaOmie) => void;
}) {
  const rubrica = rubricaDe(c, tipo);
  return (
    <CommandItem
      // `value` é o que a busca varre: descrição + código + rubrica, para achar
      // tanto por "onboarding" quanto por "2.02.92" ou pelo nome da linha da DRE.
      value={`${c.descricao} ${c.codigo} ${rubrica ?? ""}`}
      onSelect={() => { if (!atual) onEscolher(c); }}
      className={cn("items-start gap-2 py-1.5", atual && "opacity-60", escolhida && "bg-secondary")}
    >
      <Check className={cn("mt-0.5 h-3 w-3 shrink-0", atual || escolhida ? "opacity-100" : "opacity-0")} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-foreground">{c.descricao}</div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">{c.codigo}</span>
          {rubrica
            ? <span>→ {rubrica}</span>
            : <span className="text-amber-700">fora do DE-PARA</span>}
          {atual && <span>· atual</span>}
        </div>
      </div>
    </CommandItem>
  );
}
