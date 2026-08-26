/**
 * Cadastrar colaboradores como fornecedor no Omie.
 *
 * Sempre em dois passos: ao abrir, roda a SIMULAÇÃO e mostra o que aconteceria
 * pessoa a pessoa; só depois libera o botão que executa. Os dois passos chamam
 * a MESMA Edge Function, com `simular` ligado ou desligado — não são dois
 * caminhos que podem divergir.
 *
 * A tela mostra quem está bloqueado junto com o resto, e não escondido: quem
 * some da lista some do provisionamento depois, e folha com uma pessoa a menos
 * não dá erro em lugar nenhum.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Building2, Check, KeyRound, Loader2, RefreshCw, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Acao = "criar" | "alterar_pix" | "ja_ok" | "bloqueado";

type Resultado = {
  codigo: string;
  nome: string;
  acao: Acao;
  motivo?: string;
  codigoClienteOmie?: number;
  chavePix?: string;
  feito?: boolean;
  erro?: string;
};

type Resposta = {
  status: string;
  erro?: string;
  simulado?: boolean;
  resumo?: Record<string, number>;
  nao_encontrados?: string[];
  resultados?: Resultado[];
};

/** Como cada ação se apresenta. A ordem aqui é a ordem da lista na tela. */
const ACOES: Record<Acao, { rotulo: string; desc: string; icone: typeof Check; classe: string; ordem: number }> = {
  criar: {
    rotulo: "Criar",
    desc: "Ainda não existe no Omie",
    icone: UserPlus,
    classe: "bg-pos/12 text-pos border-pos/25",
    ordem: 0,
  },
  alterar_pix: {
    rotulo: "Gravar PIX",
    desc: "Existe no Omie, mas sem chave PIX",
    icone: KeyRound,
    // `info` é token do design system mas não vira utilitária no tailwind.config —
    // só `pos`, `neg`, `neu` e `warn` estão lá. Usa o token direto.
    classe: "border-[hsl(var(--info)/0.25)] bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]",
    ordem: 1,
  },
  bloqueado: {
    rotulo: "Bloqueado",
    desc: "Precisa de gente antes de seguir",
    icone: AlertTriangle,
    classe: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30",
    ordem: 2,
  },
  ja_ok: {
    rotulo: "Nada a fazer",
    desc: "Já cadastrado, com a mesma chave PIX",
    icone: Check,
    classe: "bg-muted text-muted-foreground border-border",
    ordem: 3,
  },
};

export default function CadastrarNoOmieDialog({
  aberto, onFechar, codigos, rotuloDoMes, onConcluido,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** `codigo` do RH de quem entrou no mês. */
  codigos: string[];
  rotuloDoMes: string;
  onConcluido?: () => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [executado, setExecutado] = useState(false);

  const chamar = useCallback(async (simular: boolean) => {
    const { data, error } = await supabase.functions.invoke("omie-colaboradores-cadastrar", {
      body: { codigos, simular },
    });
    if (error) throw new Error(error.message);
    const r = data as Resposta;
    if (r?.status !== "ok") throw new Error(r?.erro || "Falha ao falar com o Omie.");
    return r;
  }, [codigos]);

  // Simula ao abrir. Reabrir sempre reconsulta: entre uma abertura e outra
  // alguém pode ter cadastrado a pessoa direto no Omie.
  useEffect(() => {
    if (!aberto) return;
    setResposta(null); setErro(null); setExecutado(false); setCarregando(true);
    chamar(true)
      .then(setResposta)
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false));
  }, [aberto, chamar]);

  const executar = async () => {
    setEnviando(true);
    try {
      const r = await chamar(false);
      setResposta(r);
      setExecutado(true);
      const feitos = r.resumo?.feitos ?? 0;
      const falhos = r.resumo?.com_erro ?? 0;
      if (feitos) toast.success(`${feitos} cadastrado(s) no Omie`);
      if (falhos) toast.error(`${falhos} não passaram — veja o motivo na lista`);
      if (!feitos && !falhos) toast.info("Nada a fazer: todos já estavam cadastrados.");
      onConcluido?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg);
      toast.error(msg);
    } finally {
      setEnviando(false);
    }
  };

  const resultados = [...(resposta?.resultados ?? [])].sort(
    (a, b) => ACOES[a.acao].ordem - ACOES[b.acao].ordem || a.nome.localeCompare(b.nome, "pt-BR"),
  );
  const aFazer = (resposta?.resumo?.criar ?? 0) + (resposta?.resumo?.alterar_pix ?? 0);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cadastrar no Omie · entraram em {rotuloDoMes}</DialogTitle>
          <DialogDescription>
            Cria o fornecedor de quem ainda não tem cadastro e grava a chave PIX de quem
            está sem. Sem fornecedor no Omie, a pessoa não entra no provisionamento da folha.
          </DialogDescription>
        </DialogHeader>

        {carregando && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Consultando o Omie, um CNPJ por vez…
          </div>
        )}

        {erro && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </div>
        )}

        {resposta && !carregando && (
          <>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACOES) as Acao[]).map((a) => {
                const n = resposta.resumo?.[a] ?? 0;
                if (!n) return null;
                const { rotulo, icone: Icone, classe } = ACOES[a];
                return (
                  <span
                    key={a}
                    className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium", classe)}
                  >
                    <Icone className="size-3.5" />
                    {rotulo} · <span className="tabular-nums">{n}</span>
                  </span>
                );
              })}
            </div>

            <div className="divide-y rounded-xl border">
              {resultados.map((r) => {
                const { rotulo, desc, icone: Icone, classe } = ACOES[r.acao];
                return (
                  <div key={r.codigo} className="flex items-start gap-3 px-3.5 py-2.5">
                    <span className={cn("mt-0.5 grid size-6 flex-none place-items-center rounded-full border", classe)}>
                      <Icone className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="text-sm font-medium">{r.nome}</span>
                        <span className="mono text-[11px] text-muted-foreground">{r.codigo}</span>
                        {r.feito && (
                          <span className="rounded bg-pos/15 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-pos">
                            Feito
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.erro ? <span className="text-destructive">{r.erro}</span> : (r.motivo ?? desc)}
                      </p>
                      {r.chavePix && r.acao !== "bloqueado" && (
                        <p className="mono mt-0.5 text-[11px] text-muted-foreground">PIX: {r.chavePix}</p>
                      )}
                    </div>
                    <span className="mt-0.5 flex-none text-[11px] text-muted-foreground">{rotulo}</span>
                  </div>
                );
              })}
              {resultados.length === 0 && (
                <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">
                  Ninguém para cadastrar.
                </p>
              )}
            </div>

            {!!resposta.nao_encontrados?.length && (
              <p className="text-xs text-muted-foreground">
                Sem correspondência no espelho do RH: {resposta.nao_encontrados.join(", ")}
              </p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-muted-foreground">
                {executado
                  ? "Executado. Rode de novo para conferir o estado atual."
                  : aFazer > 0
                    ? `Nada foi criado ainda — isto é a prévia de ${aFazer} alteração(ões).`
                    : "Nada a fazer: ninguém precisa de cadastro ou de chave PIX."}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onFechar} disabled={enviando}>
                  {executado ? "Fechar" : "Cancelar"}
                </Button>
                {executado ? (
                  <Button variant="outline" onClick={() => { setExecutado(false); setCarregando(true); chamar(true).then(setResposta).finally(() => setCarregando(false)); }}>
                    <RefreshCw className="size-4" />
                    Reconferir
                  </Button>
                ) : (
                  <Button onClick={executar} disabled={enviando || aFazer === 0}>
                    {enviando ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
                    {enviando ? "Cadastrando…" : `Cadastrar ${aFazer} no Omie`}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
