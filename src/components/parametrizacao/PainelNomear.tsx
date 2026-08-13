import { useEffect, useMemo, useState } from "react";
import {
  CreditCard, Building2, Sparkles, Link2, Loader2, Save, Trash2, EyeOff,
  Check, ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import { sugestaoDeApelido, chaveContraparte, type Candidato } from "@/lib/apelidos";
import {
  salvarApelido, removerApelido, juntarGrafia, ignorarContraparte,
  type FornecedorCadastro,
} from "@/hooks/useApelidos";

/* ---------------------------------------------------------------------------
 * O painel onde uma contraparte ganha nome.
 *
 * Metade dele é FORMULÁRIO e metade é CONTEXTO, e o contexto é o que faz a coisa
 * funcionar: na hora de nomear você também não lembra o que foi. Ver os dois
 * lançamentos, ambos em Mogi das Cruzes, ambos em "Eventos e Feiras", maio e
 * julho, R$ 4.292 no total — isso acende a luz. Um campo de texto vazio não.
 * ------------------------------------------------------------------------- */

const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
  functions: { invoke: (n: string, o?: { body?: unknown }) => any };
};

type Lancamento = {
  data: string | null;
  descricao: string | null;
  categoria: string | null;
  cidade: string | null;
  valor: number | null;
};

const brlStr = (v: number | null | undefined) => valorExato(v ?? 0);
const brl = (v: number | null | undefined) => comValorExato(v ?? 0, brlStr(v));

const dataCurta = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

/* ----- quem contratou -------------------------------------------------------
 * Popover + Command em vez de `Select` porque a lista é o time inteiro e rolar
 * atrás de um nome é pior do que digitar três letras. Mesmo padrão do seletor de
 * categoria do drill-down (`TrocarCategoria`), inclusive o `filter` que aceita
 * as palavras em qualquer ordem — "freitas luiza" acha "Luiza Freitas". */
function SeletorDono({
  pessoas, valor, onEscolher,
}: {
  pessoas: { id: string; nome: string }[];
  valor: string;
  onEscolher: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const escolhido = pessoas.find((p) => p.id === valor) ?? null;

  const escolher = (id: string) => { onEscolher(id); setAberto(false); };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={aberto}
          className="mt-1 flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-[13px] ring-offset-background transition hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className={cn("truncate", !escolhido && "text-muted-foreground")}>
            {escolhido?.nome ?? "Quem contratou"}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command
          filter={(value, search) => {
            const t = value.toLowerCase();
            return search.split(/\s+/).every((s) => t.includes(s.toLowerCase())) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Buscar pessoa…" className="h-9" />
          <CommandList className="max-h-[240px]">
            <CommandEmpty>Ninguém com esse nome.</CommandEmpty>
            <CommandGroup>
              {/* Primeiro item: tirar o dono. Some quando não há o que tirar. */}
              {!!valor && (
                <CommandItem value="nenhum limpar" onSelect={() => escolher("")}
                  className="text-[12.5px] text-muted-foreground">
                  — ninguém definido —
                </CommandItem>
              )}
              {pessoas.map((p) => (
                <CommandItem key={p.id} value={p.nome} onSelect={() => escolher(p.id)}
                  className="text-[12.5px]">
                  <Check className={cn("mr-2 h-3.5 w-3.5", p.id === valor ? "opacity-100" : "opacity-0")} />
                  {p.nome}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export type Alvo = {
  candidato: Candidato;
  /** o cadastro, quando a contraparte já foi nomeada antes */
  cadastro?: FornecedorCadastro | null;
  /** o que a IA propôs na fila — entra como rascunho, ainda não é cadastro */
  rascunho?: { apelido: string; oQueE?: string | null } | null;
};

export function PainelNomear({
  alvo,
  cadastro,
  onFechar,
  onGravado,
}: {
  alvo: Alvo | null;
  cadastro: FornecedorCadastro[];
  onFechar: () => void;
  onGravado: () => void;
}) {
  const [apelido, setApelido] = useState("");
  const [oQueE, setOQueE] = useState("");
  const [donoId, setDonoId] = useState<string>("");
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null);
  const [colaboradores, setColaboradores] = useState<{ id: string; nome: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [juntarA, setJuntarA] = useState<string>("");

  const c = alvo?.candidato ?? null;
  const jaCadastrado = alvo?.cadastro ?? null;

  /* Reabastece o formulário a cada contraparte aberta. */
  useEffect(() => {
    if (!alvo) return;
    // O cadastro manda; na falta dele, o rascunho que a IA propôs na fila — para
    // clicar na linha não jogar fora a sugestão que acabou de aparecer.
    setApelido(jaCadastrado?.apelido ?? alvo.rascunho?.apelido ?? "");
    setOQueE(jaCadastrado?.o_que_e ?? alvo.rascunho?.oQueE ?? "");
    setDonoId(jaCadastrado?.dono_id ?? "");
    setJuntarA("");
    setLancamentos(null);

    let vivo = true;
    db.rpc("parametrizacao_lancamentos", {
      p_origem: alvo.candidato.origem,
      p_nome: alvo.candidato.nome,
      p_limite: 40,
    }).then(({ data, error }: { data: Lancamento[] | null; error: unknown }) => {
      if (!vivo) return;
      setLancamentos(error ? [] : (data ?? []));
    });
    return () => { vivo = false; };
  }, [alvo, jaCadastrado]);

  useEffect(() => {
    db.from("lib_colaboradores").select("id,nome").eq("status", "ativo").order("nome")
      .then(({ data }: { data: { id: string; nome: string }[] | null }) => setColaboradores(data ?? []));
  }, []);

  /* Os outros cadastros, para "juntar a uma contraparte que já existe" — sem
     oferecer a própria linha como destino de si mesma. */
  const destinos = useMemo(() => {
    const minhaChave = c ? chaveContraparte(c.nome) : "";
    return cadastro
      .filter((f) => (f.apelido ?? "").trim() && chaveContraparte(f.nome) !== minhaChave)
      .sort((a, b) => (a.apelido ?? "").localeCompare(b.apelido ?? "", "pt-BR"));
  }, [cadastro, c]);

  if (!c) return null;

  const sugerir = async () => {
    setSugerindo(true);
    try {
      const { data, error } = await db.functions.invoke("parametrizacao-sugerir", {
        body: {
          contrapartes: [{
            nome: c.nome,
            origem: c.origem,
            categoria: c.categoria,
            cidade: c.cidade,
            lancamentos: c.lancamentos,
            total: c.total,
            primeira: c.primeira,
            ultima: c.ultima,
            exemplos: (lancamentos ?? []).slice(0, 8).map((l) => l.descricao).filter(Boolean),
          }],
        },
      });
      if (error) throw error;
      const s = data?.sugestoes?.[0];
      if (!s?.apelido) throw new Error("A IA não conseguiu propor um nome para esta contraparte.");
      setApelido(s.apelido);
      if (s.o_que_e) setOQueE(s.o_que_e);
      toast.success(
        s.confianca === "alta" ? "Sugestão com confiança alta — confira e salve."
          : "Sugestão incerta — a IA não reconheceu o nome. Use como rascunho.",
      );
    } catch (e) {
      toast.error((e as Error)?.message ?? "Não foi possível pedir a sugestão.");
    } finally {
      setSugerindo(false);
    }
  };

  const gravar = async () => {
    setSalvando(true);
    const { error } = await salvarApelido(c.nome, {
      apelido,
      oQueE,
      donoId: donoId || null,
      documento: c.documento,
      categoria: c.categoria,
      origem: c.origem,
    });
    setSalvando(false);
    if (error) { toast.error(error); return; }
    toast.success(`"${c.nome}" agora aparece como "${apelido.trim()}" na DRE e na DFC.`);
    onGravado();
    onFechar();
  };

  const juntar = async () => {
    const destino = destinos.find((d) => d.id === juntarA);
    if (!destino) { toast.error("Escolha a contraparte de destino."); return; }
    setSalvando(true);
    const { error } = await juntarGrafia(destino.id, c.nome, c.origem);
    setSalvando(false);
    if (error) { toast.error(error); return; }
    toast.success(`"${c.nome}" passou a valer como "${destino.apelido}".`);
    onGravado();
    onFechar();
  };

  const ignorar = async () => {
    setSalvando(true);
    const { error } = await ignorarContraparte(c.nome, { documento: c.documento, origem: c.origem });
    setSalvando(false);
    if (error) { toast.error(error); return; }
    toast.success(`"${c.nome}" saiu da fila e do cálculo de cobertura.`);
    onGravado();
    onFechar();
  };

  const limpar = async () => {
    if (!jaCadastrado?.id) return;
    setSalvando(true);
    const { error } = await removerApelido(jaCadastrado.id);
    setSalvando(false);
    if (error) { toast.error(error); return; }
    toast.success("Apelido removido. O fornecedor continua no cadastro.");
    onGravado();
    onFechar();
  };

  const Icone = c.origem === "cartao" ? CreditCard : Building2;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="shrink-0 space-y-0 border-b border-border px-5 pb-3 pt-5 text-left">
          <SheetTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="break-all">{c.nome}</span>
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {c.origem === "cartao" ? "cartão" : "Omie"}
            </Badge>
            <span>{c.lancamentos} lançamento{c.lancamentos === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{brl(c.total)}</span>
            {c.cidade && <><span>·</span><span>{c.cidade}</span></>}
            {c.categoria && <><span>·</span><span className="truncate">{c.categoria}</span></>}
            {c.documento && <><span>·</span><span className="num">{c.documento}</span></>}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* ---------------- o formulário ---------------- */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="apelido" className="text-[12px]">Apelido</Label>
                <Button
                  type="button" variant="ghost" size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  onClick={sugerir} disabled={sugerindo}
                >
                  {sugerindo
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Sparkles className="h-3 w-3" />}
                  Sugerir
                </Button>
              </div>
              <Input
                id="apelido" value={apelido} onChange={(e) => setApelido(e.target.value)}
                placeholder={sugestaoDeApelido(c.nome)} className="mt-1 h-8 text-[13px]"
              />
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                É este nome que passa a aparecer na DRE, na DFC e no cartão.
              </p>
            </div>

            <div>
              <Label htmlFor="oquee" className="text-[12px]">O que é</Label>
              <Textarea
                id="oquee" value={oQueE} onChange={(e) => setOQueE(e.target.value)}
                rows={2} className="mt-1 text-[13px]"
                placeholder="A frase que você responderia se perguntassem na reunião."
              />
            </div>

            <div>
              <Label className="text-[12px]">Dono</Label>
              <SeletorDono
                pessoas={colaboradores}
                valor={donoId}
                onEscolher={setDonoId}
              />
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                A saída quando ninguém lembra: sabe-se a quem perguntar.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={gravar} disabled={salvando || apelido.trim().length < 2} size="sm" className="gap-1.5">
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar
              </Button>
              {jaCadastrado?.id && (
                <Button onClick={limpar} disabled={salvando} size="sm" variant="ghost" className="gap-1.5 text-[12px]">
                  <Trash2 className="h-3.5 w-3.5" />
                  Tirar o apelido
                </Button>
              )}
              {/* Transferência entre contas próprias, pagamento de fatura e
                  tarifa já saem na RPC. Isto é para o que escapar — sem saída,
                  a linha fica no topo para sempre e a cobertura nunca fecha. */}
              <Button onClick={ignorar} disabled={salvando} size="sm" variant="ghost"
                className="ml-auto gap-1.5 text-[12px] text-muted-foreground">
                <EyeOff className="h-3.5 w-3.5" />
                Não é fornecedor
              </Button>
            </div>
          </div>

          {/* ---------------- juntar a quem já tem nome ----------------
              Para os 41 lojistas que o extrato entrega cortados em 20 caracteres
              e para os que viram só "DE", "MERC": não precisam de apelido
              próprio, precisam ser reconhecidos como alguém que já tem. */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-medium">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              Ou: isto é outra grafia de algo que já tem nome
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Select value={juntarA} onValueChange={setJuntarA}>
                <SelectTrigger className="h-8 flex-1 text-[12px]">
                  <SelectValue placeholder="Escolher a contraparte" />
                </SelectTrigger>
                <SelectContent>
                  {destinos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.apelido} <span className="text-muted-foreground">· {d.nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={juntar} disabled={!juntarA || salvando} size="sm" variant="secondary">
                Juntar
              </Button>
            </div>
          </div>

          {/* ---------------- o contexto que faz lembrar ---------------- */}
          <div>
            <div className="mb-1.5 text-[12px] font-medium">
              Lançamentos
              {c.primeira && c.ultima && (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {dataCurta(c.primeira)} – {dataCurta(c.ultima)}
                </span>
              )}
            </div>

            {lancamentos === null ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </div>
            ) : lancamentos.length === 0 ? (
              <div className="py-4 text-center text-[12px] text-muted-foreground">
                Nenhum lançamento encontrado.
              </div>
            ) : (
              <table className="w-full text-[11.5px]">
                <tbody>
                  {lancamentos.map((l, i) => (
                    <tr key={i} className="border-b border-border/50 align-top last:border-0">
                      <td className="whitespace-nowrap py-1.5 pr-2 num text-muted-foreground">
                        {dataCurta(l.data)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="break-all">{l.descricao ?? "—"}</div>
                        {l.categoria && (
                          <div className="text-[10px] text-muted-foreground">{l.categoria}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right num font-medium text-primary">
                        {brl(l.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
