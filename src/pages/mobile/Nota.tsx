// Uma nota em tela cheia. Leitura por padrão; edição só quando é seguro (ver notas.ts).

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Loader2, Pencil, Star, Lock, X, Check, Archive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NotaConteudo } from "@/components/mobile/NotaConteudo";
import { docParaTexto, podeEditarNoCelular, textoParaDoc } from "@/lib/mobile/notas";
import { fmtData } from "@/lib/mobile/formato";
import { carregarNota, type PaginaResumo, type PaginaWorkspace } from "@/lib/mobile/paginas";

export default function MobileNota() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [nota, setNota] = useState<PaginaWorkspace | null>(null);
  const [subpaginas, setSubpaginas] = useState<PaginaResumo[]>([]);
  const [trilha, setTrilha] = useState<PaginaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [editandoCabecalho, setEditandoCabecalho] = useState(false);
  const [tituloRascunho, setTituloRascunho] = useState("");
  const [iconeRascunho, setIconeRascunho] = useState("");

  // A rota /notas/:id troca sem desmontar a tela (subpágina abre outra subpágina), então a
  // busca depende do `id` — sem isso a segunda nota abriria com o conteúdo da primeira.
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    setCarregando(true);
    setEditando(false);
    carregarNota(id)
      .then((r) => {
        if (!vivo) return;
        setNota(r.nota);
        setSubpaginas(r.filhos);
        setTrilha(r.trilha);
      })
      .catch((e) => { if (vivo) toast.error("Erro ao carregar a nota: " + e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [id]);

  const editavel = nota ? podeEditarNoCelular(nota.content) : false;

  function abrirEdicao() {
    if (!nota) return;
    setRascunho(docParaTexto(nota.content));
    setEditando(true);
  }

  async function salvar() {
    if (!nota) return;
    setSalvando(true);
    const content = textoParaDoc(rascunho);
    const { error } = await supabase
      .from("workspace_pages")
      .update({ content: content as any, last_edited_by: profile?.nome ?? null })
      .eq("id", nota.id);
    setSalvando(false);
    if (error) { toast.error("Não deu para salvar: " + error.message); return; }
    setNota({ ...nota, content, last_edited_by: profile?.nome ?? null, updated_at: new Date().toISOString() });
    setEditando(false);
    toast.success("Nota salva");
  }

  async function alternarFavorita() {
    if (!nota) return;
    const proximo = !nota.is_favorite;
    setNota({ ...nota, is_favorite: proximo });
    const { error } = await supabase.from("workspace_pages").update({ is_favorite: proximo }).eq("id", nota.id);
    if (error) {
      setNota((n) => (n ? { ...n, is_favorite: !proximo } : n));
      toast.error(error.message);
    }
  }

  /** Título e ícone. Vão juntos porque é o mesmo cabeçalho e a mesma gravação. */
  async function salvarCabecalho() {
    if (!nota) return;
    const titulo = tituloRascunho.trim();
    if (!titulo) { toast.error("A nota precisa de um título"); return; }
    // `icon` aceita nulo no banco e a tela já cai para 📄 quando vazio.
    const icone = iconeRascunho.trim() || null;
    if (titulo === nota.title && icone === (nota.icon ?? null)) { setEditandoCabecalho(false); return; }

    setSalvando(true);
    const { error } = await supabase
      .from("workspace_pages")
      .update({ title: titulo, icon: icone, last_edited_by: profile?.nome ?? null })
      .eq("id", nota.id);
    setSalvando(false);
    if (error) { toast.error("Não deu para salvar: " + error.message); return; }
    setNota({ ...nota, title: titulo, icon: icone, last_edited_by: profile?.nome ?? null });
    setEditandoCabecalho(false);
    toast.success("Nota renomeada");
  }

  /**
   * "Excluir" no celular é o mesmo "Arquivar" do computador.
   *
   * `workspace_pages.archived` já existe e o desktop tem a aba Arquivo para restaurar —
   * então a nota sai da lista sem sair do banco, e quem apagar sem querer no celular tem
   * para onde voltar. Um `delete` de verdade continua só no computador, atrás do diálogo
   * de confirmação de lá.
   */
  async function arquivar() {
    if (!nota) return;
    if (!confirm(`Arquivar "${nota.title || "Sem título"}"? Ela sai das listas, mas dá para restaurar no computador.`)) return;

    const { error } = await supabase.from("workspace_pages").update({ archived: true }).eq("id", nota.id);
    if (error) { toast.error(error.message); return; }

    navigate(nota.parent_id ? `/notas?pasta=${nota.parent_id}` : "/notas");
    toast.success("Nota arquivada", {
      action: {
        label: "Desfazer",
        onClick: async () => {
          const { error: err } = await supabase.from("workspace_pages").update({ archived: false }).eq("id", nota.id);
          if (err) { toast.error(err.message); return; }
          toast.success("Nota restaurada");
          navigate(`/notas/${nota.id}`);
        },
      },
    });
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!nota) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-[14px] text-muted-foreground">Nota não encontrada, arquivada ou oculta.</p>
        <Button asChild variant="outline" className="mt-4 h-11"><Link to="/notas">Voltar para Notas</Link></Button>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          onClick={() => navigate(nota.parent_id ? `/notas?pasta=${nota.parent_id}` : "/notas")}
          aria-label="Voltar"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[12px] text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link to="/notas" className="shrink-0 py-1">Notas</Link>
          {trilha.slice(-1).map((p) => (
            <span key={p.id} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <Link to={`/notas?pasta=${p.id}`} className="max-w-[140px] truncate py-1">{p.title || "Sem título"}</Link>
            </span>
          ))}
        </nav>
        <button
          onClick={alternarFavorita}
          aria-label={nota.is_favorite ? "Remover dos favoritos" : "Favoritar"}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
        >
          <Star className={cn("h-5 w-5", nota.is_favorite && "fill-primary text-primary")} />
        </button>
      </div>

      <div className="px-4 pt-4">
        {editandoCabecalho ? (
          <div>
            <div className="flex items-start gap-2">
              {/* Campo curto e separado: no celular o teclado de emoji é nativo, então
                  basta um input com espaço para um caractere. */}
              <Input
                value={iconeRascunho}
                onChange={(e) => setIconeRascunho(e.target.value)}
                aria-label="Ícone da nota"
                className="h-11 w-14 shrink-0 text-center text-xl"
                placeholder="📄"
              />
              <Input
                autoFocus
                value={tituloRascunho}
                onChange={(e) => setTituloRascunho(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") salvarCabecalho(); }}
                aria-label="Título da nota"
                className="h-11 flex-1 text-base font-semibold"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button onClick={salvarCabecalho} disabled={salvando} className="h-10 flex-1 text-[13px]">
                {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                Salvar
              </Button>
              <Button variant="outline" onClick={() => setEditandoCabecalho(false)} disabled={salvando} className="h-10 text-[13px]">
                <X className="mr-1.5 h-4 w-4" /> Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setTituloRascunho(nota.title || "");
              setIconeRascunho(nota.icon || "");
              setEditandoCabecalho(true);
            }}
            className="flex w-full items-start gap-2 text-left active:opacity-60"
          >
            <h1 className="flex min-w-0 flex-1 items-start gap-2 text-[22px] font-bold leading-tight tracking-tight">
              <span className="shrink-0">{nota.icon || "📄"}</span>
              <span className="min-w-0 break-words">{nota.title || "Sem título"}</span>
            </h1>
            <Pencil className="mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
        <div className="mt-1.5 text-[11.5px] text-muted-foreground">
          editado em {fmtData(nota.updated_at)}
          {nota.last_edited_by ? ` · ${nota.last_edited_by}` : ""}
        </div>

        {editando ? (
          <div className="mt-4">
            <Textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              rows={18}
              className="min-h-[50dvh] text-base leading-relaxed"
            />
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Marcação simples: <span className="num"># título</span>, <span className="num">- item</span>,{" "}
              <span className="num">**negrito**</span>, <span className="num">[texto](link)</span>.
            </p>
            <div className="mt-3 flex gap-2">
              <Button onClick={salvar} disabled={salvando} className="h-11 flex-1">
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
              <Button variant="outline" onClick={() => setEditando(false)} disabled={salvando} className="h-11">
                <X className="mr-2 h-4 w-4" /> Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3">
              <NotaConteudo doc={nota.content} />
            </div>

            {editavel ? (
              <Button variant="outline" onClick={abrirEdicao} className="mt-6 h-11 w-full">
                <Pencil className="mr-2 h-4 w-4" /> Editar
              </Button>
            ) : (
              <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-secondary/50 p-3 text-[12px] leading-snug text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Esta nota tem formatação que o editor do celular não representa (tabela, imagem
                  ou destaque). Editar aqui apagaria esse conteúdo — abra no computador.
                </span>
              </div>
            )}
          </>
        )}

        {!editando && (
          <div className="mt-6 border-t border-border pt-4">
            <Button
              variant="outline"
              onClick={arquivar}
              className="h-11 w-full border-destructive/30 text-destructive active:bg-destructive/10"
            >
              <Archive className="mr-2 h-4 w-4" /> Arquivar nota
            </Button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              Sai das listas do celular e do computador. Para restaurar depois, a aba
              Arquivo das Anotações no computador.
            </p>
          </div>
        )}

        {subpaginas.length > 0 && !editando && (
          <div className="mt-8">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Páginas dentro desta
            </h2>
            <ul className="space-y-2">
              {subpaginas.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/notas/${p.id}`}
                    className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-3 active:bg-secondary/50"
                  >
                    <span className="shrink-0 text-[16px] leading-none">{p.icon || "📄"}</span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{p.title || "Sem título"}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
