/**
 * O rodapé da prévia: enviar o lote ao Omie, ou testar com dois títulos antes.
 *
 * O TESTE existe por uma dúvida concreta que a documentação não responde: o
 * exemplo do `IncluirContaPagarPorLote` mostra só os campos simples, e não
 * prova que o endpoint em lote aceita `departamentos` e
 * `cnab_integracao_bancaria`. Se ignorar os blocos aninhados, o título nasce
 * sem departamento e sem os dados do PIX — e isso NÃO dá erro, só sai errado.
 * Descobrir isso com dois títulos custa dois cliques; com cento e dois, custa
 * uma folha inteira remontada à mão.
 *
 * Por isso o teste devolve as chaves criadas e um botão para apagá-las. Teste
 * sem desfazer é aposta.
 *
 * O desfazer da SESSÃO só alcança o que esta aba criou. Quem recarregou a
 * página perdeu a lista e ficaria apagando cem títulos à mão no ERP — daí o
 * "apagar a competência inteira", que remonta as chaves `FOLHA-` a partir do
 * espelho do RH em vez de depender de tê-las guardado.
 */

import { useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { cn } from "@/lib/utils";
import { doisParaTestar, type Candidato } from "@/lib/folha/teste";

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/** O que `folha-omie-enviar` devolve, nas três ações. */
type Resultado = { integracao: string; nome: string; criado: boolean; erro?: string };

type Resposta = {
  status: string;
  erro?: string;
  titulos?: number;
  falharam?: number;
  /** As chaves `FOLHA-…` criadas — é por elas que o teste é desfeito. */
  integracoes?: string[];
  resultados?: Resultado[];
  /** Só de `excluir_competencia`. */
  excluidos?: number;
  nao_encontrados?: number;
  recusados?: { integracao: string; nome: string; erro: string }[];
};

export default function EnviarFolhaOmie({
  competencia, candidatos, totalDoLote, recusa, onEnviado,
}: {
  competencia: string;
  candidatos: Candidato[];
  totalDoLote: number;
  /** Motivo que impede o envio completo. `null` = liberado. */
  recusa: string | null;
  onEnviado: () => void;
}) {
  const [ocupado, setOcupado] = useState<null | "teste" | "tudo" | "limpar" | "apagarTudo">(null);
  const [criados, setCriados] = useState<string[]>([]);
  const [falhas, setFalhas] = useState<Resultado[]>([]);
  const [confirmando, setConfirmando] = useState<null | "tudo" | "prontos" | "apagarTudo">(null);

  const teste = doisParaTestar(candidatos);
  /* Quem já dá para enviar. Existe porque a alternativa a "tudo ou nada" não é
     desligar a trava — é mandar quem está pronto e deixar o resto pendente.
     Uma pessoa com cadastro errado não pode segurar a folha de outras cem. */
  const prontos = candidatos.filter((c) => c.pronto);
  const pendentes = candidatos.length - prontos.length;
  const parcial = !!recusa && prontos.length > 0 && pendentes > 0;

  /* `invocar` desembrulha o corpo do erro. Sem ele, qualquer recusa do Omie
     chega como "Edge Function returned a non-2xx status code" — uma frase com
     a qual não dá para fazer nada: não se sabe se é para tentar de novo, se o
     payload está errado ou se o mês está fechado no ERP. */
  const chamar = async (body: Record<string, unknown>): Promise<Resposta> =>
    invocar<Resposta>(supabase.functions.invoke("folha-omie-enviar", { body }));

  const enviarTeste = async () => {
    setOcupado("teste");
    setFalhas([]);
    try {
      const r = await chamar({
        acao: "enviar", competencia, codigos: teste.map((t) => t.codigo),
      });
      setCriados(r.integracoes ?? []);
      const ruins = (r.resultados ?? []).filter((x) => !x.criado);
      setFalhas(ruins);

      /* Zero criados NÃO é sucesso. A primeira versão disto mostrava
         "0 título(s) criados no Omie" com ícone de certo — a tela dizia que
         tinha dado tudo bem e o motivo real ficava só na resposta. */
      if (ruins.length) {
        toast.error(`${ruins.length} título(s) recusados pelo Omie`, {
          description: ruins[0].erro?.slice(0, 160),
        });
      } else {
        toast.success(`${r.titulos} título(s) criados no Omie`, {
          description: "Confira no ERP se o departamento e o PIX chegaram.",
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async () => {
    setOcupado("limpar");
    try {
      await chamar({ acao: "excluir", integracoes: criados });
      setCriados([]);
      toast.success("Títulos de teste apagados do Omie");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  /* Apaga a folha inteira da competência no Omie.
   *
   * As chaves não vêm de lugar nenhum guardado: são remontadas do espelho do
   * RH, porque `FOLHA-<codigo>-<AAAA-MM>` é determinístico. Quem nunca foi
   * provisionado volta como "não encontrado", que é resposta e não erro. */
  const apagarCompetencia = async () => {
    setOcupado("apagarTudo");
    try {
      const r = await chamar({ acao: "excluir_competencia", competencia });
      setCriados([]);
      setFalhas([]);
      setConfirmando(null);
      const recusados = r.recusados ?? [];
      if (recusados.length) {
        /* Título já baixado ou conciliado o Omie não deixa excluir — e isso é
           o certo, não uma falha nossa. Vai escrito para ninguém tentar de
           novo achando que foi problema de rede. */
        setFalhas(recusados.map((x) => ({ ...x, criado: false })));
        toast.error(`${r.excluidos ?? 0} apagados, ${recusados.length} o Omie recusou`, {
          description: "Título já baixado ou conciliado não pode ser excluído pela API.",
        });
      } else {
        toast.success(`${r.excluidos ?? 0} título(s) de ${competencia} apagados do Omie`);
      }
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  const enviarTudo = async (somenteProntos: boolean) => {
    setOcupado("tudo");
    try {
      const r = await chamar(somenteProntos
        ? { acao: "enviar", competencia, codigos: prontos.map((p) => p.codigo) }
        : { acao: "enviar", competencia });
      const ruins = (r.resultados ?? []).filter((x) => !x.criado);
      setFalhas(ruins);
      setCriados(r.integracoes ?? []);
      if (ruins.length) {
        toast.error(`${r.titulos} criados, ${ruins.length} recusados`, {
          description: "A competência NÃO foi marcada como enviada — reenvie depois de corrigir.",
        });
      } else {
        toast.success(`Folha de ${competencia} provisionada — ${r.titulos} títulos`);
      }
      setConfirmando(null);
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-3 border-t pt-3">
      {criados.length > 0 && (
        <div className="rounded-xl border border-[hsl(var(--info)/0.3)] bg-[hsl(var(--info)/0.08)] px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold text-[hsl(var(--info))]">
            {criados.length} título(s) de teste criados no Omie
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Abra no ERP e confira o que a documentação não garante: se o <b>departamento</b> está
            preenchido e se os dados do <b>PIX</b> chegaram. Depois apague por aqui.
          </p>
          <ul className="mono mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
            {criados.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <Button
            variant="outline" size="sm" className="mt-2 gap-1.5"
            onClick={excluir} disabled={ocupado !== null}
          >
            {ocupado === "limpar" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Apagar os {criados.length} do Omie
          </Button>
        </div>
      )}

      {falhas.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold text-destructive">
            {falhas.length} título(s) recusados pelo Omie
          </p>
          <button
            className="mt-1 text-xs text-primary hover:underline"
            onClick={() => {
              const linhas = falhas.map((f) => `• ${f.nome}: ${f.erro ?? "sem motivo"}`);
              const texto = ["Títulos recusados pelo Omie:", "", ...linhas].join("\n");
              navigator.clipboard.writeText(texto)
                .then(() => toast.success("Lista copiada"), () => toast.error("Não deu para copiar"));
            }}
          >
            Copiar a lista
          </button>
          <ul className="mt-1.5 space-y-1">
            {falhas.map((f) => (
              <li key={f.integracao} className="text-xs">
                <span className="font-medium">{f.nome}</span>
                <span className="mono ml-1.5 text-[11px] text-muted-foreground">{f.integracao}</span>
                <span className="mt-0.5 block break-words text-muted-foreground">{f.erro}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmando && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold text-destructive">
            {confirmando === "apagarTudo"
              ? `Apagar do Omie TODOS os títulos da folha de ${competencia}?`
              : confirmando === "prontos"
                ? `Criar ${prontos.length} títulos no Omie, deixando ${pendentes} de fora?`
                : `Criar ${candidatos.length} títulos de ${BRL(totalDoLote)} no Omie?`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {confirmando === "apagarTudo"
              ? "Só apaga o que tem chave FOLHA- desta competência — nenhum outro título do ERP é "
                + "tocado. Título já baixado ou conciliado o Omie recusa, e o motivo vem escrito. "
                + "A competência volta a 'pendente' e pode ser provisionada de novo."
              : confirmando === "prontos"
                ? `A competência ${competencia} NÃO será marcada como enviada — o que ficou de fora `
                  + "pode ser mandado depois, e quem já foi criado é recusado por duplicidade em vez "
                  + "de virar título repetido."
                : `Isto marca a competência ${competencia} como enviada e passa a recusar um segundo `
                  + "envio. Desfazer depois é apagar título por título no ERP."}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmando(null)} disabled={ocupado !== null}>
              Cancelar
            </Button>
            {confirmando === "apagarTudo" ? (
              <Button
                size="sm" variant="destructive" className="gap-1.5"
                onClick={apagarCompetencia} disabled={ocupado !== null}
              >
                {ocupado === "apagarTudo" && <Loader2 className="size-3.5 animate-spin" />}
                Confirmo, apagar tudo
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => enviarTudo(confirmando === "prontos")}
                disabled={ocupado !== null}
                className="gap-1.5"
              >
                {ocupado === "tudo" && <Loader2 className="size-3.5 animate-spin" />}
                Confirmo, provisionar
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Escrito na tela, e não só no código: os títulos vão sem centro de
          custo, e quem confere a DRE por área precisa saber disso ANTES de
          estranhar o buraco. */}
      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
        Os títulos vão <b>sem departamento</b> — o Omie recusa esse campo na API
        (<span className="mono">Tag [DEPARTAMENTOS] não faz parte da estrutura</span>). A
        distribuição por área tem de ser feita no ERP depois. A folha por área desta tela
        continua valendo, porque sai do de-para do Hub.
      </p>

      {/* Botão desabilitado sem explicação à vista parece defeito. O motivo fica
          em bloco, e não em texto miúdo cinza, para a diferença entre "travado"
          e "quebrado" ser óbvia sem passar o mouse em nada. */}
      {recusa && !parcial && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold text-amber-700 dark:text-amber-400">
            O envio está travado — o botão não está quebrado
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{recusa}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className={cn("max-w-[55%] text-xs", recusa ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {parcial
            ? `${pendentes} pessoa(s) com cadastro incompleto ficam de fora — o resto vai.`
            : recusa
              ? "Resolva o que está acima para liberar."
              : "Lote em ordem. Nada é criado até você clicar."}
        </p>
        <div className="flex gap-2">
          {/* Discreto de propósito: apagar a folha inteira não é operação de
              rotina, mas é a única saída para quem recarregou a página e perdeu
              a lista da sessão. A confirmação diz o que vai acontecer. */}
          <Button
            variant="ghost"
            onClick={() => setConfirmando("apagarTudo")}
            disabled={ocupado !== null || confirmando !== null}
            title={`Apaga do Omie os títulos com chave FOLHA- de ${competencia}. `
              + "Nenhum outro título do ERP é tocado."}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Apagar a folha de {competencia}
          </Button>
          <Button
            variant="outline"
            onClick={enviarTeste}
            disabled={ocupado !== null || teste.length === 0 || criados.length > 0}
            title={teste.length === 0
              ? "Ninguém pronto para o teste — resolva as pendências primeiro."
              : `Cria só ${teste.map((t) => t.nome).join(" e ")} no Omie, para conferir o formato.`}
            className="gap-1.5"
          >
            {ocupado === "teste" ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
            Testar com {teste.length}
          </Button>
          {parcial ? (
            <Button
              onClick={() => setConfirmando("prontos")}
              disabled={ocupado !== null || confirmando !== null}
              title={`Manda os ${prontos.length} com cadastro completo. Os ${pendentes} pendentes `
                + "ficam para quando o cadastro for corrigido."}
              className="gap-1.5"
            >
              <Send className="size-4" />
              Provisionar os {prontos.length} prontos
            </Button>
          ) : (
            <Button
              onClick={() => setConfirmando("tudo")}
              disabled={ocupado !== null || !!recusa || confirmando !== null}
              title={recusa ?? undefined}
              className="gap-1.5"
            >
              <Send className="size-4" />
              Provisionar {candidatos.length} no Omie
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
