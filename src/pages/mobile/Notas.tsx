// Aba Notas — lista de `workspace_pages` (o "Anotações" do desktop) navegável por pasta.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Star, Plus, Loader2, FileText, Home } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useAoVoltar } from "@/hooks/useAoVoltar";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtData } from "@/lib/mobile/formato";
import { resumoDoc, textoParaDoc } from "@/lib/mobile/notas";
import { CAMPOS_PAGINA, carregarPaginas, type PaginaWorkspace } from "@/lib/mobile/paginas";

export default function MobileNotas() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [paginas, setPaginas] = useState<PaginaWorkspace[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);

  const pastaId = params.get("pasta");

  const buscar = useCallback(
    () =>
      carregarPaginas()
        .then(setPaginas)
        .catch((e) => toast.error("Erro ao carregar notas: " + e.message))
        .finally(() => setCarregando(false)),
    [],
  );

  useEffect(() => { buscar(); }, [buscar]);
  // As notas são do time inteiro e mudam no computador enquanto o celular está no bolso —
  // mesmo motivo de Tarefas e Extratos recarregarem ao voltar.
  useAoVoltar(buscar);

  const porId = useMemo(() => new Map(paginas.map((p) => [p.id, p])), [paginas]);
  const filhos = useMemo(() => {
    const mapa = new Map<string, PaginaWorkspace[]>();
    for (const p of paginas) {
      const chave = p.parent_id ?? "__raiz__";
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(p);
    }
    return mapa;
  }, [paginas]);

  const trilha = useMemo(() => {
    const caminho: PaginaWorkspace[] = [];
    let atual = pastaId ? porId.get(pastaId) : undefined;
    while (atual) {
      caminho.unshift(atual);
      atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
    }
    return caminho;
  }, [pastaId, porId]);

  const noNivel = filhos.get(pastaId ?? "__raiz__") ?? [];
  const favoritas = pastaId ? [] : paginas.filter((p) => p.is_favorite);
  const restantes = pastaId ? noNivel : noNivel.filter((p) => !p.is_favorite);

  async function criar(titulo: string, corpo: string) {
    const { data, error } = await supabase.from("workspace_pages").insert({
      parent_id: pastaId,
      title: titulo,
      icon: "📝",
      content: textoParaDoc(corpo) as any,
      created_by: user?.id ?? null,
      created_by_name: profile?.nome ?? null,
      last_edited_by: profile?.nome ?? null,
    }).select(CAMPOS_PAGINA).single();
    if (error) { toast.error("Erro ao criar nota: " + error.message); return false; }
    setPaginas((ps) => [data as PaginaWorkspace, ...ps]);
    toast.success("Nota criada");
    navigate(`/notas/${(data as PaginaWorkspace).id}`);
    return true;
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando notas…
      </div>
    );
  }

  return (
    <div className="relative pb-24">
      {trilha.length > 0 && (
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2.5 text-[12px] text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => setParams({})} className="flex shrink-0 items-center gap-1 py-1">
            <Home className="h-3.5 w-3.5" /> Notas
          </button>
          {/* Trilha curta: numa tela de 375px só o pai imediato cabe além do atual. */}
          {trilha.slice(-2).map((p, i, arr) => (
            <span key={p.id} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button
                onClick={() => setParams({ pasta: p.id })}
                className={cn("max-w-[140px] truncate py-1", i === arr.length - 1 && "font-semibold text-foreground")}
              >
                {p.title || "Sem título"}
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className="space-y-5 px-4 pt-4">
        {favoritas.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Star className="h-3 w-3 fill-primary text-primary" /> Favoritas
            </h2>
            <ul className="space-y-2">
              {favoritas.map((p) => (
                <CardNota key={p.id} p={p} nFilhos={filhos.get(p.id)?.length ?? 0} onEntrar={() => setParams({ pasta: p.id })} />
              ))}
            </ul>
          </section>
        )}

        <section>
          {favoritas.length > 0 && (
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Todas</h2>
          )}
          {restantes.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
              Nenhuma nota aqui ainda.
            </div>
          ) : (
            <ul className="space-y-2">
              {restantes.map((p) => (
                <CardNota key={p.id} p={p} nFilhos={filhos.get(p.id)?.length ?? 0} onEntrar={() => setParams({ pasta: p.id })} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <button
        onClick={() => setCriando(true)}
        aria-label="Nova nota"
        className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        <Plus className="h-6 w-6" />
      </button>

      <FolhaNovaNota aberta={criando} onFechar={() => setCriando(false)} onCriar={criar} />
    </div>
  );
}

function CardNota({ p, nFilhos, onEntrar }: { p: PaginaWorkspace; nFilhos: number; onEntrar: () => void }) {
  const previa = resumoDoc(p.content, 80);
  return (
    <li className="flex items-stretch overflow-hidden rounded-xl border border-border bg-card">
      <Link to={`/notas/${p.id}`} className="flex min-w-0 flex-1 items-start gap-3 p-3.5 active:bg-secondary/50">
        <span className="mt-0.5 shrink-0 text-[18px] leading-none">{p.icon || "📄"}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">{p.title || "Sem título"}</span>
            {p.is_favorite && <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />}
          </span>
          {previa && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{previa}</span>}
          <span className="mt-1 block text-[11px] text-muted-foreground">
            editado em {fmtData(p.updated_at)}
            {p.last_edited_by ? ` · ${p.last_edited_by}` : ""}
          </span>
        </span>
      </Link>
      {nFilhos > 0 && (
        <button
          onClick={onEntrar}
          aria-label={`Abrir as ${nFilhos} páginas de ${p.title}`}
          className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 border-l border-border text-muted-foreground active:bg-secondary"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="num text-[10px]">{nFilhos}</span>
        </button>
      )}
    </li>
  );
}

function FolhaNovaNota({
  aberta, onFechar, onCriar,
}: {
  aberta: boolean;
  onFechar: () => void;
  onCriar: (titulo: string, corpo: string) => Promise<boolean>;
}) {
  const [titulo, setTitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (aberta) { setTitulo(""); setCorpo(""); } }, [aberta]);

  const enviar = async () => {
    if (!titulo.trim()) { toast.error("Dê um título à nota"); return; }
    setSalvando(true);
    const ok = await onCriar(titulo.trim(), corpo);
    setSalvando(false);
    if (ok) onFechar();
  };

  return (
    <Drawer open={aberta} onOpenChange={(v) => !v && onFechar()}>
      <DrawerContent className="max-h-[88dvh]">
        <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <DrawerTitle className="text-[16px]">Nova nota</DrawerTitle>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Título</Label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="h-11 text-base" placeholder="Sobre o quê?" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Conteúdo</Label>
              <Textarea
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                rows={8}
                className="text-base"
                placeholder={"Texto simples.\n\n# Título\n- item da lista\n**negrito**"}
              />
            </div>
            <Button onClick={enviar} disabled={salvando} className="h-12 w-full text-[14px] font-semibold">
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar nota
            </Button>
            <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Tabela, imagem e capa continuam no computador — aqui é texto com marcação simples.
            </p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
