import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ListPlus, Loader2, Mail, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { urlDaFuncao } from "@/lib/urlFuncao";

/**
 * Os e-mails acionáveis do briefing, com a solução já preparada.
 *
 * O PEDIDO QUE ORIGINOU ISTO (29/08/2026): "tudo que for ação e cair no briefing
 * eu quero poder ir lendo e já ir endereçando solução por ali mesmo". Então cada
 * item tem as DUAS saídas, e quem lê escolhe:
 *
 *   • RESPONDER o remetente — quando há gente do outro lado esperando algo;
 *   • VIRAR TAREFA — quando o útil é fazer, não responder. "Sua cobrança vence
 *     amanhã" pede pagamento, não cordialidade.
 *
 * O CLIQUE É O CONTROLE, e é por isso que a IA não envia sozinha. O resto da
 * leva desta data deu autonomia a ela — aponta o título de uma nota quando a
 * prova é forte. Aqui a régua muda porque a consequência muda: errar o desempate
 * de uma nota custa uma linha interna que se desfaz; errar um e-mail custa uma
 * mensagem que saiu com o nome da empresa, e para isso não existe desfazer.
 *
 * A MENSAGEM ENCONTRADA APARECE ANTES DO BOTÃO. O item do briefing não guarda o
 * id do Gmail, então a mensagem é procurada por remetente e assunto — e assunto
 * se repete todo mês ("Sua fatura chegou"). Mostrar QUAL mensagem vai receber a
 * resposta é o que separa isto de um envio às cegas.
 *
 * O TEXTO É EDITÁVEL e o que vai é o da caixa, não o do banco. Mostrar
 * editável e enviar outra coisa seria a pior armadilha de uma tela feita para
 * revisar.
 *
 * SOME QUANDO VAZIO: bloco vazio permanente ensina a ignorar a região da tela.
 */

type Acao = {
  chave: string;
  remetente: string;
  assunto: string | null;
  data_email: string | null;
  acao: string | null;
  veredito: "responder" | "so_acao";
  sugestao: string | null;
  porque: string | null;
  gmail_id: string | null;
  msg_assunto: string | null;
  msg_data: string | null;
  tarefa_id: string | null;
  enviado_em: string | null;
};

const db = supabase as any;

const dataBR = (iso: string | null) => {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : null;
};

export function RespostasSugeridas() {
  const [itens, setItens] = useState<Acao[]>([]);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const ler = useCallback(() => {
    db.rpc("email_acoes_pendentes", { p_limite: 8 }).then(
      ({ data }: { data: Acao[] | null }) => {
        const lista = data ?? [];
        setItens(lista);
        setTextos((t) => ({
          ...Object.fromEntries(lista.map((i) => [i.chave, i.sugestao ?? ""])),
          ...t, // o que a pessoa já editou vence a releitura
        }));
      },
    );
  }, []);

  useEffect(() => { ler(); }, [ler]);

  const enviar = useCallback(async (p: Acao) => {
    setOcupado(p.chave);
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const token = sessao?.session?.access_token;
      if (!token) throw new Error("sessão expirada — recarregue a página");

      const resp = await fetch(urlDaFuncao("email-responder"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enviar",
          chave: p.chave,
          texto: textos[p.chave] ?? p.sugestao ?? "",
        }),
      });
      const r = await resp.json().catch(() => ({}));
      if (!resp.ok || !r?.ok) throw new Error(r?.error ?? `HTTP ${resp.status}`);

      toast.success(`Respondido para ${r.para ?? "o remetente"}.`);
      setItens((xs) => xs.map((x) => (x.chave === p.chave ? { ...x, enviado_em: "agora" } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }, [textos]);

  const virarTarefa = useCallback(async (p: Acao) => {
    setOcupado(p.chave);
    try {
      const { data, error } = await db.rpc("email_acao_virar_tarefa", { p_chave: p.chave });
      if (error) throw new Error(error.message);
      toast.success("Virou tarefa no Backlog.");
      setItens((xs) => xs.map((x) => (x.chave === p.chave ? { ...x, tarefa_id: String(data) } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }, []);

  if (!itens.length) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Mail className="h-4 w-4 text-muted-foreground" />
        {itens.length} e-mail{itens.length > 1 ? "s" : ""} do briefing com solução pronta
      </p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
        A IA preparou; você resolve daqui — respondendo, virando tarefa, ou os dois.
      </p>

      <ul className="mt-2.5 space-y-3">
        {itens.map((p) => {
          const trabalhando = ocupado === p.chave;
          return (
            <li key={p.chave} className="rounded border border-border/70 p-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                <span className="font-medium">{p.remetente}</span>
                {dataBR(p.data_email) && (
                  <span className="text-muted-foreground">{dataBR(p.data_email)}</span>
                )}
              </div>
              {p.assunto && (
                <p className="truncate text-[12px] text-muted-foreground">{p.assunto}</p>
              )}

              {/* A ação que o briefing identificou — é ela que vira tarefa. */}
              {p.acao && <p className="mt-1 text-[12.5px]">{p.acao}</p>}

              {p.porque && (
                <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  {p.porque}
                </p>
              )}

              {/* Resposta só quando cabe responder e ainda não foi enviada. */}
              {p.veredito === "responder" && !p.enviado_em && (
                <>
                  <Textarea
                    className="mt-1.5 min-h-[80px] text-[12.5px]"
                    value={textos[p.chave] ?? ""}
                    onChange={(e) => setTextos((t) => ({ ...t, [p.chave]: e.target.value }))}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {p.gmail_id
                      ? <>Vai como resposta a: <span className="font-medium">{p.msg_assunto || p.assunto}</span>
                          {dataBR(p.msg_data) && ` · ${dataBR(p.msg_data)}`}</>
                      : "Não localizei a mensagem original no Gmail — responda por lá, ou use como tarefa."}
                  </p>
                </>
              )}

              <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
                {p.enviado_em && (
                  <span className="mr-auto flex items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> respondido
                  </span>
                )}
                {p.tarefa_id && (
                  <span className="mr-auto flex items-center gap-1 text-[11.5px] text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5" /> virou tarefa
                  </span>
                )}

                {!p.tarefa_id && (
                  <Button
                    size="sm" variant="outline" className="h-7"
                    disabled={trabalhando}
                    onClick={() => virarTarefa(p)}
                  >
                    {trabalhando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
                    Virar tarefa
                  </Button>
                )}

                {p.veredito === "responder" && !p.enviado_em && (
                  <Button
                    size="sm" className="h-7"
                    disabled={trabalhando || !p.gmail_id || !(textos[p.chave] ?? "").trim()}
                    onClick={() => enviar(p)}
                  >
                    {trabalhando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Enviar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
