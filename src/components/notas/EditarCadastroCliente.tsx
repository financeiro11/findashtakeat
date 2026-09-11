/* ---------------------------------------------------------------------------
 * EDITAR O CADASTRO DO CLIENTE À MÃO — dentro do Hub, nos dois sistemas.
 *
 * O QUE FALTAVA. `CorrigirCadastro` resolve o endereço com o que a Receita ou o
 * CEP respondem, e isso cobre o caso comum. Mas a própria tela tem um recado
 * para o caso que sobra: "o cadastro do Omie já bate com a Receita/CEP — não há
 * campo a corrigir daqui, e mesmo assim a nota não saiu". O exemplo que trouxe
 * este arquivo é o mais simples que existe: o Omie recusa o faturamento com
 * "falta preencher o E-mail", e e-mail não está em cadastro federal nenhum.
 * Sem um lugar para digitar, o conserto saía do Hub — abrir o Omie, achar o
 * cliente, digitar, voltar, reemitir — e o Asaas continuava torto para a
 * cobrança do mês seguinte.
 *
 * TRÊS COISAS QUE ESTA TELA FAZ QUESTÃO DE MOSTRAR, e todas vêm de escrever em
 * cadastro de terceiro:
 *
 *   • O FORMULÁRIO COMEÇA IGUAL AO CADASTRO. Nada vem pré-preenchido com
 *     "sugestão": o que estiver escrito num campo é o que está no Omie hoje.
 *     Assim toda diferença listada embaixo é uma diferença que a pessoa
 *     digitou, e o contador "3 campos alterados" quer dizer o que parece querer.
 *   • CADA CAMPO DIZ ONDE VAI DAR. E-mail, telefone e endereço são o mesmo dado
 *     nos dois sistemas; razão social e cidade não atravessam — no Asaas o nome
 *     é o fantasia que a equipe de cobrança reconhece na tela, e a cidade de lá
 *     vem do CEP.
 *   • CAMPO EM BRANCO NÃO APAGA. Deixar vazio é "não mexi". Quem precisa
 *     esvaziar um campo faz no Omie, de propósito: apagar cadastro alheio não
 *     pode estar a um backspace de distância numa tela de conserto.
 *
 * A régua (o que é válido, o que mudou, o que atravessa) mora em
 * `src/lib/cadastroCliente.ts`, testada, e é a MESMA que a Edge Function aplica
 * antes de gravar. O servidor é quem manda — ele relê o cadastro no Omie na hora
 * e recusa CEP que os Correios não conhecem.
 * ------------------------------------------------------------------------- */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Loader2, Pencil, Save, ArrowRight, ChevronDown, Building2, CreditCard } from "lucide-react";
import {
  CAMPOS_CADASTRO, DEF_DO_CAMPO, cidadeSemUf, errosDoCadastro, mudancas,
  mudancasNoAsaas, camposAEnviar,
  type CampoCadastro, type ValoresCadastro,
} from "@/lib/cadastroCliente";

const sb = supabase as any;

/** O recorte do diagnóstico que esta tela precisa. Estrutural de propósito:
 *  assim o componente não importa o tipo de quem o desenha, e não há ciclo. */
export interface ClienteEditavel {
  doc: string;
  nome: string;
  n_cod_cli: number | null;
  id_customer: string;
  omie: Record<string, string> | null;
  asaas: Record<string, string | null>;
}

const LARGURA: Record<"curta" | "media" | "larga", string> = {
  curta: "col-span-2", media: "col-span-3", larga: "col-span-6",
};

/** O cadastro de hoje, na forma em que uma pessoa o digita. Vem do Omie quando
 *  ele existe — é ele quem emite a nota; o Asaas só entra quando não há cadastro
 *  no ERP, e aí o que a tela escreve é só lá mesmo. */
function baseDoCliente(c: ClienteEditavel): ValoresCadastro {
  const de = (c.omie ?? c.asaas ?? {}) as Record<string, string | null>;
  const out: ValoresCadastro = {};
  for (const d of CAMPOS_CADASTRO) {
    const v = String(de[d.campo] ?? "");
    out[d.campo] = d.campo === "cidade" ? cidadeSemUf(v) : v;
  }
  return out;
}

export function EditarCadastroCliente({
  cliente, ids, onGravado,
}: {
  cliente: ClienteEditavel;
  /** As cobranças que esta edição destrava — vão para o rastro da correção. */
  ids: string[];
  /** Chamado quando algo foi de fato escrito, para a tela de trás recarregar. */
  onGravado: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [valores, setValores] = useState<ValoresCadastro>(() => baseDoCliente(cliente));
  const [salvando, setSalvando] = useState<string | null>(null);
  /* O que esta tela já gravou nesta sessão. Sem isto, depois de salvar o
     formulário continuaria acusando as mesmas diferenças contra o cadastro que
     foi lido ANTES da escrita — convidando ao segundo clique de algo que já
     aconteceu. O servidor recusaria (devolve "nada mudou"), mas a tela estaria
     mentindo até alguém apertar Reler. */
  const [gravado, setGravado] = useState<ValoresCadastro>({});

  const base = useMemo(
    () => ({ ...baseDoCliente(cliente), ...gravado }),
    [cliente, gravado],
  );

  /* Quando o diagnóstico é relido, o formulário volta a espelhar o cadastro. A
     chave é o CONTEÚDO e não o objeto: o pai remonta a lista a cada render, e
     comparar por identidade limparia o que alguém está digitando. */
  const assinatura = JSON.stringify(baseDoCliente(cliente));
  useEffect(() => {
    setValores(baseDoCliente(cliente));
    setGravado({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  const erros = useMemo(() => errosDoCadastro(valores), [valores]);
  const lista = useMemo(() => mudancas(base, valores), [base, valores]);
  const temErro = Object.keys(erros).length > 0;

  /* O que de fato mudaria no Asaas: dos campos alterados, os que atravessam a
     ponte E ainda são diferentes lá. Contar os que já estão iguais faria o botão
     prometer uma escrita que o servidor recusaria com "nada mudou" — e o número
     entre parênteses é a única coisa que a pessoa tem para decidir se vale
     apertá-lo. */
  const noAsaas = useMemo(() => {
    const baseAsaas: ValoresCadastro = {};
    for (const d of CAMPOS_CADASTRO) baseAsaas[d.campo] = String(cliente.asaas?.[d.campo] ?? "");
    return mudancasNoAsaas(mudancas(baseAsaas, camposAEnviar(lista)));
  }, [cliente.asaas, lista]);

  const semOmie = !cliente.n_cod_cli;

  /** O contato que o Asaas tem e o ERP não — é o atalho do caso mais comum.
   *  Só contato: puxar ENDEREÇO do Asaas é o que produziu a fila de notas presas
   *  em E0240, e por isso não existe botão para isso aqui. */
  const doAsaas = (campo: CampoCadastro): string => String(cliente.asaas?.[campo] ?? "").trim();

  const salvar = async (alvos: ("omie" | "asaas")[]) => {
    const campos = camposAEnviar(lista);
    if (!Object.keys(campos).length) return;
    setSalvando(alvos.join("+"));
    try {
      const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
        body: { action: "editar_cadastro", doc: cliente.doc, alvos, ids, campos },
      });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      const r = data?.resultado ?? {};
      const escreveu = alvos.filter((a) => r[a]?.ok === true);
      const falhou = alvos.filter((a) => r[a] && r[a].ok === false && !r[a].nada_mudou);

      if (falhou.length) {
        toast.error(`${cliente.nome}: ${falhou.join(" e ")} não aceitou a alteração.`, {
          description: falhou.map((a) => r[a].motivo).join(" · "), duration: 14000,
        });
      }
      if (escreveu.length) {
        /* Só o que o sistema confirmou vira "gravado". Se o Omie aceitou e o
           Asaas recusou, o formulário tem de continuar oferecendo o Asaas. */
        setGravado((g) => ({ ...g, ...campos }));
        toast.success(`${cliente.nome}: cadastro atualizado em ${escreveu.join(" e ")}.`, {
          description: lista.map((m) => DEF_DO_CAMPO[m.campo].rotulo).join(", "),
        });
        onGravado();
      } else if (!falhou.length) {
        toast.info("Nada foi escrito.", {
          description: alvos.map((a) => r[a]?.motivo).filter(Boolean).join(" · "),
          duration: 10000,
        });
      }
    } catch (e: any) {
      toast.error(`Falha ao editar ${cliente.nome}.`, { description: e?.message });
    } finally {
      setSalvando(null);
    }
  };

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="mt-2.5 flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
      >
        <Pencil className="h-3 w-3" />
        Editar cadastro à mão
      </button>
    );
  }

  return (
    <div className="mt-2.5 rounded border border-border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <Pencil className="h-3 w-3 text-primary" />
          Editar cadastro à mão
        </span>
        <button
          onClick={() => setAberto(false)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="h-3 w-3 rotate-180" /> fechar
        </button>
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {semOmie
          ? "Este cliente não tem cadastro no Omie — daqui só dá para arrumar o do Asaas. Para criá-lo no ERP, use a aba Auditoria."
          : "Os campos mostram o que está no Omie agora. Campo em branco não apaga nada: o que ficar vazio não é escrito."}
      </p>

      <div className="mt-2 grid grid-cols-6 gap-2">
        {CAMPOS_CADASTRO.map((d) => {
          const erro = erros[d.campo];
          const mudouEste = lista.some((m) => m.campo === d.campo);
          const sugestao = (d.campo === "email" || d.campo === "telefone") ? doAsaas(d.campo) : "";
          const ofereceAsaas = !!sugestao && !String(valores[d.campo] ?? "").trim();
          return (
            <div key={d.campo} className={LARGURA[d.largura]}>
              <label className="flex items-baseline justify-between gap-1">
                <span className="text-[10px] text-muted-foreground" title={d.ajuda}>
                  {d.rotulo}
                  {d.ajuda && <span className="ml-0.5 text-muted-foreground/50">*</span>}
                </span>
                <span className="text-[9px] text-muted-foreground/60">
                  {d.onde === "ambos" ? "Omie + Asaas" : "só Omie"}
                </span>
              </label>
              <Input
                value={valores[d.campo] ?? ""}
                maxLength={d.limite}
                onChange={(e) => setValores((v) => ({ ...v, [d.campo]: e.target.value }))}
                className={cn(
                  "mt-0.5 h-7 px-2 text-[11px]",
                  erro && "border-destructive",
                  !erro && mudouEste && "border-emerald-500/60",
                )}
              />
              {erro && <p className="mt-0.5 text-[9px] text-destructive">{erro}</p>}
              {/* O atalho do caso mais comum: o contato existe no Asaas e falta
                  no ERP. Não vale para endereço — ver o comentário em `doAsaas`. */}
              {!erro && ofereceAsaas && (
                <button
                  onClick={() => setValores((v) => ({ ...v, [d.campo]: sugestao }))}
                  className="mt-0.5 truncate text-[9px] text-primary hover:underline"
                  title={`O Asaas tem "${sugestao}" neste campo. Clique para trazer.`}
                >
                  usar o do Asaas: {sugestao}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* O que muda, antes do botão — a mesma promessa do diff automático. */}
      {lista.length > 0 && (
        <table className="mt-2.5 w-full text-[11px]">
          <tbody>
            {lista.map((m) => (
              <tr key={m.campo} className="border-b border-border/40 last:border-0">
                <td className="w-28 py-1 text-muted-foreground">{DEF_DO_CAMPO[m.campo].rotulo}</td>
                <td className={cn("py-1", m.vazio ? "italic text-muted-foreground/60" : "text-foreground")}>
                  {m.de || "(vazio)"}
                </td>
                <td className="w-6 py-1 text-center text-muted-foreground">
                  <ArrowRight className="mx-auto h-3 w-3" />
                </td>
                <td className="py-1 font-medium text-emerald-700 dark:text-emerald-400">{m.para}</td>
                <td className="w-24 py-1 text-right text-[10px] text-muted-foreground">
                  {m.vazio ? "estava em branco" : "substitui"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {!semOmie && (
          <button
            onClick={() => salvar(["omie"])}
            disabled={!!salvando || temErro || lista.length === 0}
            className="flex items-center gap-1.5 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            {salvando === "omie" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Building2 className="h-3 w-3" />}
            Salvar no Omie
          </button>
        )}
        {noAsaas.length > 0 && (
          <button
            onClick={() => salvar(semOmie ? ["asaas"] : ["omie", "asaas"])}
            disabled={!!salvando || temErro}
            className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40"
            title={
              "O Asaas é a ORIGEM do dado: sem consertar lá, o mesmo cliente volta torto na próxima cobrança.\n\n" +
              `Lá mudaria: ${noAsaas.map((m) => `${DEF_DO_CAMPO[m.campo].rotulo} → ${m.para}`).join(" · ")}`
            }
          >
            {salvando?.includes("asaas") ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />}
            {semOmie
              ? `Salvar no Asaas (${noAsaas.length})`
              : `Salvar no Omie e no Asaas (${noAsaas.length} campo${noAsaas.length > 1 ? "s" : ""} lá)`}
          </button>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {temErro
            ? "Corrija os campos em vermelho."
            : lista.length === 0
              ? "Nada alterado ainda."
              : semOmie && noAsaas.length === 0
                /* Sem cadastro no Omie e mexendo só em campo que não atravessa a
                   ponte: não há onde gravar, e um botão desabilitado sem frase
                   deixaria a pessoa procurando o que fez de errado. */
                ? "Só o Omie guarda estes campos, e este cliente não tem cadastro lá."
                : `${lista.length} campo${lista.length > 1 ? "s" : ""} alterado${lista.length > 1 ? "s" : ""}`}
          {Object.keys(gravado).length > 0 && (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Save className="h-3 w-3" /> gravado — use Reler para conferir no Omie
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
