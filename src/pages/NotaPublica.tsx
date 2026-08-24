// `/n/<token>` — uma anotação aberta por quem não tem conta no Hub.
//
// Fora do AppLayout e fora do MobileLayout de propósito: esta é a única tela do Hub que
// abre sem sessão, então não pode depender de nada que o login monte. Uma coluna só,
// que serve igual no telefone e no computador.
//
// O que a pessoa daqui pode: LER e COMENTAR. Editar continua sendo do time — quem tem
// login abre a mesma nota por /notas/<id> e edita lá.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FileText, Link2Off, Lock } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { NotaConteudo } from "@/components/mobile/NotaConteudo";
import { Conversa } from "@/components/notas/Comentarios";
import { fmtDataHora } from "@/lib/mobile/formato";
import {
  comentarNotaPublica, resolverNotaPublica,
  type Comentario, type NotaPublicaOk,
} from "@/lib/notas/compartilhar";
import takeatLogo from "@/assets/takeat-logo-white.png";

/** Vermelho institucional da Takeat, o mesmo do link do líder da auditoria. */
const TINTA = "hsl(0 72% 30%)";

/** O nome fica no aparelho: quem volta para acompanhar a nota não redigita a cada vez. */
const CHAVE_NOME = "nota-publica:autor";

function Cabecalho() {
  return (
    <header className="sticky top-0 z-20" style={{ backgroundColor: TINTA }}>
      <div className="mx-auto flex max-w-[720px] items-center gap-2.5 px-5 py-3">
        <img src={takeatLogo} alt="Takeat" className="h-6 w-6 object-contain" />
        <span className="text-[13px] font-medium tracking-wide text-white/85">Hub Financeiro</span>
      </div>
    </header>
  );
}

function Carregando() {
  return (
    <div className="min-h-screen bg-background">
      <Cabecalho />
      <main className="mx-auto max-w-[720px] space-y-6 px-5 py-8">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-10 w-72" />
        <div className="space-y-3 pt-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-full" />
        </div>
      </main>
    </div>
  );
}

function Recusa({ mensagem }: { mensagem: string }) {
  return (
    <div className="min-h-screen bg-background">
      <Cabecalho />
      <main className="mx-auto max-w-[720px] px-5 py-16">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border">
          <Link2Off className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Não conseguimos abrir esta anotação</h1>
        <p className="mt-2 max-w-[440px] text-sm leading-relaxed text-muted-foreground">{mensagem}</p>
        <p className="mt-6 max-w-[440px] text-sm leading-relaxed text-muted-foreground">
          Se o link deveria funcionar, peça um novo a quem compartilhou com você.
        </p>
      </main>
    </div>
  );
}

export default function NotaPublica() {
  const { token } = useParams<{ token: string }>();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState<NotaPublicaOk | null>(null);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [nome, setNome] = useState(() => {
    try { return localStorage.getItem(CHAVE_NOME) ?? ""; } catch { return ""; }
  });

  const carregar = useCallback(async () => {
    if (!token) { setErro("Link inválido"); setCarregando(false); return; }
    const r = await resolverNotaPublica(token);
    if ("erro" in r && r.erro) {
      setErro(r.erro);
    } else {
      const ok = r as NotaPublicaOk;
      setNota(ok);
      setComentarios(ok.comentarios ?? []);
      document.title = `${ok.titulo || "Anotação"} · Takeat`;
    }
    setCarregando(false);
  }, [token]);

  useEffect(() => {
    document.title = "Takeat · Anotação";
    carregar();
  }, [carregar]);

  async function enviar(texto: string, autor: string): Promise<boolean> {
    if (!token) return false;
    const limpo = autor.trim();
    if (!limpo) { toast.error("Escreva seu nome para o time saber quem comentou"); return false; }
    try { localStorage.setItem(CHAVE_NOME, limpo); } catch { /* modo privado */ }

    const r = await comentarNotaPublica(token, limpo, texto);
    if ("erro" in r && r.erro) { toast.error(r.erro); return false; }
    setComentarios((prev) => [...prev, (r as { comentario: Comentario }).comentario]);
    toast.success("Comentário enviado");
    return true;
  }

  if (carregando) return <Carregando />;
  if (erro || !nota) return <Recusa mensagem={erro ?? "Link inválido"} />;

  return (
    <div className="min-h-screen bg-background pb-16">
      <Cabecalho />

      {nota.capa && (
        <div className="mx-auto max-w-[720px]">
          <img src={nota.capa} alt="" className="h-40 w-full object-cover sm:h-52" />
        </div>
      )}

      <main className="mx-auto max-w-[720px] px-5">
        <section className="pt-8">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Anotação compartilhada
          </div>
          <h1 className="mt-2 flex items-start gap-3 text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">
            <span className="shrink-0">{nota.icone || "📄"}</span>
            <span className="min-w-0 break-words">{nota.titulo || "Sem título"}</span>
          </h1>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {nota.compartilhado_por ? `Compartilhada por ${nota.compartilhado_por} · ` : ""}
            editada em {fmtDataHora(nota.atualizado_em)}
            {nota.ultimo_editor ? ` por ${nota.ultimo_editor}` : ""}
          </p>
        </section>

        <article className="mt-6 border-t border-border pt-6">
          <NotaConteudo doc={nota.conteudo} />
        </article>

        <section className="mt-10 border-t border-border pt-6">
          <Conversa
            comentarios={comentarios}
            onEnviar={nota.permite_comentario ? enviar : undefined}
            somenteLeitura={!nota.permite_comentario}
            nomePedido={{ valor: nome, aoMudar: setNome }}
            compacto
          />
        </section>

        <footer className="mt-12 border-t border-border pt-5">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Este endereço abre <strong className="font-medium text-foreground">só esta
              anotação</strong>, em modo leitura. Quem compartilhou pode revogá-lo a qualquer
              momento — não repasse a ninguém.
            </p>
          </div>
          <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <FileText className="h-3 w-3" /> Takeat · Hub Financeiro
          </div>
        </footer>
      </main>
    </div>
  );
}
