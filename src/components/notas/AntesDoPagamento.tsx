/* ---------------------------------------------------------------------------
 * A LISTA DE QUEM RECEBE NOTA ANTES DO PAGAMENTO — liberar e revisar.
 *
 * A régua existe desde 02/09/2026 e funciona: quem está em
 * `nf_nota_antes_do_pagamento` tem a linha PENDING/OVERDUE destravada no painel,
 * para alguém marcar e mandar. O que não existia era COMO ENTRAR NELA. A lista
 * nasceu de uma migration — carregada da foto do `invoiceSettings` que o Asaas
 * tinha antes do desligamento — e a tela até apontava para um lugar onde ela
 * pudesse ser editada ("está na lista de Parametrização"), lugar que nunca foi
 * construído. Então o caso número cinco não tinha caminho nenhum: dependia de
 * uma migration para uma decisão que é de operação, não de código.
 *
 * A PORTA FICA NA LINHA BLOQUEADA, e é a decisão de desenho deste arquivo. Quem
 * precisa disto está olhando a cobrança agora, com a caixa de seleção apagada e
 * "A cobrança não foi recebida." no hover — é ali que a pergunta nasce, e é ali
 * que a resposta tem de estar. Uma tela de configuração noutro menu obrigaria a
 * pessoa a sair, achar o CNPJ, digitá-lo sem errar e voltar; e digitar CNPJ à mão
 * para destravar emissão fiscal é um erro de digitação a uma tecla de distância
 * de emitir nota para o tomador errado. Daqui o documento vem da linha.
 *
 * TRÊS COISAS QUE O DIÁLOGO TEM DE FAZER, nenhuma cosmética:
 *
 *   • PEDIR O MOTIVO, e recusar sem ele. É o campo que impede a lista de virar
 *     folclore: daqui a um ano, um CNPJ ali dentro sem uma linha de explicação é
 *     um CNPJ que ninguém ousa tirar e ninguém sabe por que está.
 *   • PERGUNTAR QUAL DOS DOIS MOTIVOS é, porque a régua é uma e as populações são
 *     duas opostas — cliente que precisa da nota para pagar, parceiro que nos
 *     deve comissão. O Hub escreve essa frase em três lugares (selo, aviso de
 *     emissão, sino das 8h) e escrevê-la errada é pior do que não escrevê-la.
 *   • DIZER O RAIO EM VOZ ALTA. A liberação é por CNPJ, não por cobrança: vale
 *     para tudo o que aquele documento tiver em aberto, hoje e depois. Quem
 *     clica tem de saber que acabou de destravar também a mensalidade do
 *     parceiro que também é cliente — e há vários.
 * ------------------------------------------------------------------------- */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  FileClock, HandCoins, Loader2, Trash2, TriangleAlert, Info, Check, UserPlus,
} from "lucide-react";
import {
  TIPOS_ANTES_DO_PAGAMENTO, tipoConhecido, formatarDoc, statusAsaas,
  type TipoAntesDoPagamento,
} from "@/lib/notasFiscais";

const sb = supabase as any;

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataStr = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

/** O ícone de cada tipo. O selo do painel usa os mesmos dois. */
export const ICONE_TIPO: Record<TipoAntesDoPagamento, typeof FileClock> = {
  paga_contra_nota: FileClock,
  comissao: HandCoins,
};

export interface EntradaAntesDoPagamento {
  doc: string;
  nome: string | null;
  motivo: string;
  tipo: TipoAntesDoPagamento;
  criado_em: string;
  criado_por: string | null;
  regra_asaas: string | null;
}

/** O que o diálogo precisa saber da cobrança que puxou o gatilho. */
export interface CobrancaParaLiberar {
  id_asaas: string;
  cliente_asaas: string | null;
  cnpj_cpf: string | null;
  valor: number;
  descricao: string | null;
  data_vencimento: string | null;
  status_asaas: string | null;
}

/**
 * Lê a lista inteira, com tipo e motivo.
 *
 * São quatro linhas hoje e a tabela não cresce por conta própria: ler tudo junto
 * com o painel é mais barato do que qualquer cache e garante que a régua da tela
 * e a do banco falem do mesmo conjunto no mesmo instante.
 */
export async function lerAntesDoPagamento(): Promise<EntradaAntesDoPagamento[]> {
  const { data, error } = await sb
    .from("nf_nota_antes_do_pagamento")
    .select("doc, nome, motivo, tipo, criado_em, criado_por, regra_asaas")
    .eq("ativo", true)
    .order("nome");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, tipo: tipoConhecido(r.tipo) }));
}

/* =========================================================================
 * LIBERAR — o diálogo que abre a partir da linha bloqueada.
 * ====================================================================== */

export function LiberarAntesDoPagamento({
  cobranca, aberto, onFechar, onLiberado,
}: {
  cobranca: CobrancaParaLiberar | null;
  aberto: boolean;
  onFechar: () => void;
  /**
   * Chamado depois de gravar. `emitirAgora` diz o que fazer em seguida — marcar a
   * linha e parar, ou sair emitindo a nota inteira (cadastro do tomador
   * incluído). São dois pedidos diferentes e o botão clicado é quem os separa.
   */
  onLiberado: (doc: string, idAsaas: string, emitirAgora: boolean) => void | Promise<void>;
}) {
  const { profile, user } = useAuth();
  /* O TIPO NASCE EM COMISSÃO, e não é preguiça de default: a régua de cliente
     que paga contra nota chegou completa da foto do Asaas (os quatro que
     existem), então quem abre este diálogo a partir de uma linha, hoje, está
     quase sempre liberando um parceiro de comissão. O rádio continua à vista. */
  const [tipo, setTipo] = useState<TipoAntesDoPagamento>("comissao");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  /* O TOMADOR EXISTE NO OMIE? É a pergunta que decide se a emissão vai funcionar
     depois de tudo isto, e ela é feita AQUI por um motivo que só apareceu ao
     revisar o caminho inteiro: para um parceiro que só nos deve comissão, a
     resposta é provavelmente "não" — ele nunca foi cliente.

     E o Hub NÃO TEM COMO CONSERTAR ISSO SOZINHO neste caso. A fila de cadastro
     automático (`omie_clientes_a_criar`) é construída a partir de
     `notas_fiscais_auditoria(...)->'clientes'`, que não enxerga cobrança
     pendente — logo o parceiro não entra nela, e o botão "cadastrar no Omie" da
     aba Auditoria não aparece para ele. Sem este aviso, a sequência seria:
     liberar, marcar, emitir, e só então receber "Cliente sem cadastro no Omie"
     sem nenhuma indicação de onde resolver. Falha silenciosa no fim de um fluxo
     de quatro passos é a pior forma de descobrir um pré-requisito. */
  const [cadastroOmie, setCadastroOmie] = useState<"lendo" | "tem" | "falta" | "erro">("lendo");

  // Diálogo que reabre é diálogo novo: nem o motivo de outro parceiro nem o tipo
  // escolhido ontem podem vazar para a próxima liberação.
  useEffect(() => {
    if (aberto) { setTipo("comissao"); setMotivo(""); }
  }, [aberto, cobranca?.id_asaas]);

  const doc = useMemo(() => String(cobranca?.cnpj_cpf ?? "").replace(/\D/g, ""), [cobranca?.cnpj_cpf]);
  const t = TIPOS_ANTES_DO_PAGAMENTO[tipo];

  useEffect(() => {
    if (!aberto || !doc) return;
    let vivo = true;
    setCadastroOmie("lendo");
    void (async () => {
      /* `limit(1)` e não `maybeSingle()`. Hoje `omie_clientes_doc` é 1:1 (6.614
         linhas, 6.614 documentos), então os dois dariam o mesmo — mas o
         `maybeSingle` trata "veio mais de uma linha" como ERRO, e o dia em que o
         espelho ganhasse um documento repetido o cliente BEM cadastrado é que
         cairia no aviso de "não deu para conferir". A pergunta aqui é só "existe
         alguma?", e ela não deve poder falhar por causa da resposta ser "duas". */
      const { data, error } = await sb
        .from("omie_clientes_doc").select("codigo").eq("doc", doc).limit(1);
      if (!vivo) return;
      // Erro de leitura NÃO vira "falta": afirmar ausência por falha de rede
      // mandaria alguém cadastrar de novo quem já está lá, e cadastro duplicado
      // no Omie emite nota para o tomador errado.
      setCadastroOmie(error ? "erro" : data?.[0]?.codigo ? "tem" : "falta");
    })();
    return () => { vivo = false; };
  }, [aberto, doc]);

  const liberar = async (emitirAgora: boolean) => {
    if (!cobranca || !doc) return;
    if (!motivo.trim()) {
      toast.error("Escreva o motivo.", {
        description: "É o que explica, daqui a um ano, por que este CNPJ está na lista.",
      });
      return;
    }
    setSalvando(true);
    try {
      /* `upsert` e não `insert`: o documento é a chave primária e a remoção da
         lista é um `ativo = false`, não um `delete` (o motivo de ontem vale como
         histórico). Sem o upsert, religar quem já saiu uma vez morreria em
         violação de chave — e a mensagem do Postgres não explicaria nada a quem
         está tentando emitir uma nota. */
      const { error } = await sb
        .from("nf_nota_antes_do_pagamento")
        .upsert({
          doc,
          nome: cobranca.cliente_asaas ?? null,
          motivo: motivo.trim(),
          tipo,
          ativo: true,
          criado_por: profile?.nome ?? user?.email ?? "hub",
        }, { onConflict: "doc" });
      if (error) throw error;

      toast.success(`${cobranca.cliente_asaas ?? formatarDoc(doc)} entrou na lista.`, {
        description: "As cobranças pendentes deste CNPJ ficam destraváveis no painel. " +
          "Nenhuma sai sozinha — a rodada automática continua só em recebida.",
        duration: 12000,
      });
      await onLiberado(doc, cobranca.id_asaas, emitirAgora);
      onFechar();
    } catch (e: any) {
      toast.error("Não deu para liberar.", { description: e?.message, duration: 15000 });
    } finally {
      setSalvando(false);
    }
  };

  if (!cobranca) return null;
  const st = statusAsaas(cobranca.status_asaas);

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o && !salvando) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileClock className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            Emitir a nota antes de receber
          </DialogTitle>
          <DialogDescription className="text-xs">
            A emissão automática só alcança cobrança recebida. Esta lista abre a pendente e a
            vencida — por ato de alguém, uma nota por clique, e com o motivo registrado.
          </DialogDescription>
        </DialogHeader>

        {/* A cobrança que está na mesa. Sem isto, o diálogo pede uma decisão
            sobre um CNPJ solto. */}
        <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs">
          <div className="font-medium text-foreground">{cobranca.cliente_asaas ?? "cliente sem nome"}</div>
          <div className="num mt-0.5 text-[11px] text-muted-foreground">{formatarDoc(doc) || "sem documento"}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="num font-medium text-foreground">{brl(cobranca.valor)}</span>
            <span>vence {dataStr(cobranca.data_vencimento)}</span>
            <span className="rounded border border-border bg-background px-1.5 py-0.5">{st.rotulo}</span>
          </div>
          {cobranca.descricao && (
            <div className="mt-1.5 line-clamp-2 text-[11px] italic text-muted-foreground" title={cobranca.descricao}>
              “{cobranca.descricao}”
            </div>
          )}
        </div>

        {/* POR QUE a nota sai antes. A régua é a mesma para os dois; o que muda é
            a frase que o selo, o aviso de emissão e o sino das 8h vão dizer. */}
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-foreground">Por que a nota sai antes do dinheiro?</legend>
          {(Object.keys(TIPOS_ANTES_DO_PAGAMENTO) as TipoAntesDoPagamento[]).map((k) => {
            const info = TIPOS_ANTES_DO_PAGAMENTO[k];
            const Icone = ICONE_TIPO[k];
            return (
              <label
                key={k}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs",
                  tipo === k ? "border-sky-500/50 bg-sky-500/5" : "border-border hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="tipo-antes-do-pagamento"
                  checked={tipo === k}
                  onChange={() => setTipo(k)}
                  className="mt-0.5 h-3.5 w-3.5 accent-sky-600"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <Icone className="h-3.5 w-3.5" />
                    {info.rotulo}
                  </span>
                  <span className="mt-0.5 block leading-relaxed text-muted-foreground">{info.ajuda}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">Motivo (obrigatório)</span>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t.motivoExemplo}
            rows={3}
            maxLength={500}
            className="text-xs"
          />
          <span className="block text-[11px] text-muted-foreground">
            Fica gravado ao lado do CNPJ. É o que responde, meses depois, por que esta exceção existe —
            e o que permite tirá-la da lista com segurança quando ela deixar de valer.
          </span>
        </label>

        {/* O PRÉ-REQUISITO QUE NÃO SE VÊ. A nota é emitida contra um cadastro do
            Omie, e a liberação daqui não cria nenhum. Ver o comentário do estado
            `cadastroOmie`: para o parceiro de comissão este é o caso provável, e
            é o único degrau do fluxo que o Hub não consegue resolver sozinho. */}
        {cadastroOmie === "falta" && (
          <div className="flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5 text-[11px] leading-relaxed text-sky-800 dark:text-sky-300">
            <UserPlus className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Este CNPJ ainda não tem cadastro no Omie — e o Hub cria antes de emitir.</strong> É o
              primeiro passo de “Liberar e emitir agora”: endereço e razão social saem da Receita Federal, a
              cidade é conferida pelo CEP nos Correios, e o cadastro nasce no ERP. Só para se faltar algo que
              nenhuma dessas fontes tem — e aí a tela diz o que falta, em vez de devolver “cliente sem
              cadastro”.
            </span>
          </div>
        )}
        {cadastroOmie === "erro" && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              Não deu para conferir se este CNPJ tem cadastro no Omie. A liberação funciona de todo jeito;
              se a emissão voltar com “Cliente sem cadastro no Omie”, é isso.
            </span>
          </div>
        )}

        {/* O RAIO, dito antes do clique. A liberação é por documento e não por
            cobrança: foi a escolha de desenho, e ela tem consequência. */}
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Isto vale para <strong>todas as cobranças deste CNPJ</strong>, esta e as futuras — inclusive a
            mensalidade, se o parceiro também for cliente. O que ele <em>não</em> faz: emitir sozinho.
            A rodada automática continua só em cobrança recebida, e cada nota daqui sai de um clique.
          </span>
        </div>

        {/* DOIS BOTÕES, E O PRINCIPAL É O QUE EMITE.
            Quem abriu este diálogo veio de uma linha bloqueada querendo uma nota
            — não querendo cadastrar um CNPJ numa lista. "Liberar e emitir agora"
            é o pedido inteiro; "só liberar" existe para quem está arrumando a
            lista antes do tempo (o parceiro assinou, a cobrança sai semana que
            vem) e não quer nota nenhuma hoje. */}
        <DialogFooter className="sm:justify-between">
          <button
            onClick={onFechar}
            disabled={salvando}
            className="ghost-btn rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Cancelar
          </button>
          <span className="flex gap-2">
            <button
              onClick={() => liberar(false)}
              disabled={salvando || !motivo.trim() || !doc}
              className="ghost-btn rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
              title="Grava a liberação e marca a linha. A nota não sai agora — você emite quando quiser."
            >
              Só liberar
            </button>
            <button
              onClick={() => liberar(true)}
              disabled={salvando || !motivo.trim() || !doc}
              className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              title={!doc
                ? "A cobrança está sem CNPJ/CPF — sem documento não há o que liberar."
                : "Libera e emite: o Hub cadastra o tomador no Omie se faltar, cria a OS, fatura e acompanha até o número da nota."}
            >
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Liberar e emitir agora
            </button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* =========================================================================
 * A LISTA — revisar e tirar.
 *
 * Existe porque exceção sem revisão é exceção permanente: a lista destrava
 * emissão fiscal, e quem entra nela por um motivo que durou um mês continua
 * dentro para sempre se ninguém puder olhar. Tirar é `ativo = false` e não
 * `delete` — o motivo de ontem explica o histórico de emissões de ontem.
 * ====================================================================== */

export function ListaAntesDoPagamento({
  aberto, onFechar, entradas, onMudou,
}: {
  aberto: boolean;
  onFechar: () => void;
  entradas: EntradaAntesDoPagamento[];
  onMudou: () => void | Promise<void>;
}) {
  const [removendo, setRemovendo] = useState<string | null>(null);

  const remover = async (e: EntradaAntesDoPagamento) => {
    if (!window.confirm(
      `Tirar ${e.nome ?? formatarDoc(e.doc)} da lista?\n\n` +
      "As cobranças pendentes deste CNPJ voltam a ficar bloqueadas no painel: a nota passa a sair " +
      "só depois do pagamento, como a de todo mundo.\n\n" +
      "As notas já emitidas não são afetadas.",
    )) return;
    setRemovendo(e.doc);
    try {
      const { error } = await sb
        .from("nf_nota_antes_do_pagamento")
        .update({ ativo: false })
        .eq("doc", e.doc);
      if (error) throw error;
      toast.success(`${e.nome ?? formatarDoc(e.doc)} saiu da lista.`);
      await onMudou();
    } catch (err: any) {
      toast.error("Não deu para remover.", { description: err?.message });
    } finally {
      setRemovendo(null);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileClock className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            Nota antes do pagamento
          </DialogTitle>
          <DialogDescription className="text-xs">
            Quem está aqui tem as cobranças pendentes e vencidas destraváveis no painel. Duas
            situações opostas com a mesma trava: cliente que precisa da NFS-e para conseguir pagar,
            e parceiro que nos deve comissão de indicação.
          </DialogDescription>
        </DialogHeader>

        {entradas.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            A lista está vazia. Ela se enche a partir da linha bloqueada no painel, no botão
            “Nota antes de receber”.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-border bg-muted/60">
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="p-2">Quem</th>
                  <th className="p-2">Por quê</th>
                  <th className="p-2">Motivo registrado</th>
                  <th className="w-8 p-2" />
                </tr>
              </thead>
              <tbody>
                {entradas.map((e) => {
                  const info = TIPOS_ANTES_DO_PAGAMENTO[e.tipo];
                  const Icone = ICONE_TIPO[e.tipo];
                  return (
                    <tr key={e.doc} className="border-b border-border/50 align-top last:border-0">
                      <td className="max-w-[180px] p-2">
                        <div className="truncate font-medium text-foreground">{e.nome ?? "—"}</div>
                        <div className="num text-[11px] text-muted-foreground">{formatarDoc(e.doc)}</div>
                      </td>
                      <td className="p-2">
                        <span
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400"
                          title={info.ajuda}
                        >
                          <Icone className="h-2.5 w-2.5" />
                          {info.rotulo}
                        </span>
                      </td>
                      <td className="max-w-[340px] p-2 leading-relaxed text-muted-foreground">
                        {e.motivo}
                        <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                          {e.criado_por ?? "—"}
                          {e.criado_em ? ` · ${dataStr(String(e.criado_em).slice(0, 10))}` : ""}
                          {/* A prova de origem dos quatro primeiros: não foi
                              alguém achando que o cliente paga contra nota, foi
                              a configuração que estava em produção no Asaas. */}
                          {e.regra_asaas ? ` · Asaas: ${e.regra_asaas}` : ""}
                        </div>
                      </td>
                      <td className="p-2">
                        <button
                          onClick={() => remover(e)}
                          disabled={removendo === e.doc}
                          className="ghost-icone rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          title="Tirar da lista — as cobranças pendentes voltam a ficar bloqueadas"
                        >
                          {removendo === e.doc
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" />
          <span>
            Estar na lista não emite nada: a rodada automática continua só em cobrança recebida, e
            aqui cada nota sai de um clique. O sino avisa de manhã quando uma cobrança destas está
            vencendo sem nota.
          </span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
