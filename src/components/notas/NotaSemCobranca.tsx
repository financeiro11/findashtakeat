/* ---------------------------------------------------------------------------
 * NOTA SEM COBRANÇA — a NFS-e avulsa que não parte de uma cobrança do Asaas.
 *
 * DUAS PORTAS, UM FORMULÁRIO (14/09/2026). "Puxar do Asaas" busca o cliente no
 * espelho (e, se não achar, no próprio Asaas) e PREENCHE o tomador; "Digitar
 * tudo" começa em branco. Nos dois casos o que a nota leva é o que está no
 * formulário na hora do clique — é isso que a pessoa conferiu.
 *
 * O QUE ESTE DIÁLOGO NÃO FAZ: emitir. Ele grava a nota pedida
 * (`sem_cobranca_preparar`, que confere tudo de novo no servidor) e entrega o
 * carimbo `avl_…` ao `EmitirAgora`, que conduz a mesma corrente de toda nota:
 * cadastro do tomador → OS e lote → prefeitura → número no Hub.
 *
 * DOIS AVISOS QUE NÃO PODEM FALTAR, porque são as duas diferenças reais para a
 * nota de cobrança: a classificação fiscal é a das mensalidades (o molde), e o
 * título a receber que o Omie cria fica em aberto (não há pagamento a conferir).
 * ------------------------------------------------------------------------- */

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Download, FilePlus, Info, Loader2, Pencil, Search, TriangleAlert, User } from "lucide-react";
import { formatarDoc } from "@/lib/notasFiscais";
import {
  CABE_NA_NOTA, TOMADOR_VAZIO, docValido, faltasDaNota, lerValorBRL, soDigitos,
  tomadorDoAsaas, tomadorParaAsaas, mesclarConsulta, type Tomador, type CampoConsultado,
} from "@/lib/notaSemCobranca";
import type { EmissaoSemCobranca } from "./EmitirAgora";

const sb = supabase as any;

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** As fontes que `consultar_tomador` devolve, em português de tela. O que não
 *  estiver aqui é o cadastro federal de contato (cnpja, receitaws…). */
const ROTULO_FONTE: Record<string, string> = {
  omie: "Omie", receita: "Receita", asaas: "Asaas", correios: "Correios",
};

const ROTULO_CAMPO: Record<CampoConsultado, string> = {
  nome: "nome", email: "e-mail", telefone: "telefone", cep: "CEP", endereco: "logradouro",
  numero: "número", complemento: "complemento", bairro: "bairro", cidade: "cidade", uf: "UF",
};

const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

interface ClienteAsaas { id_asaas: string; nome: string | null; documento: string | null; dados: any }
interface Parecida { id: string; valor: number; descricao: string; criado_em: string }

/** A mensagem da função, e não o "non-2xx status code" genérico do cliente. */
async function mensagemDe(error: any, data: any): Promise<string> {
  if (data?.erro) return String(data.erro);
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.erro) return String(corpo.erro);
  } catch { /* sem corpo legível */ }
  return error?.message ?? "Erro sem mensagem.";
}

export function NotaSemCobranca({
  aberto, onFechar, onPronto,
}: {
  aberto: boolean;
  onFechar: () => void;
  onPronto: (nota: EmissaoSemCobranca) => void;
}) {
  const [modo, setModo] = useState<"asaas" | "manual">("asaas");
  const [busca, setBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscandoNoAsaas, setBuscandoNoAsaas] = useState(false);
  const [achados, setAchados] = useState<ClienteAsaas[] | null>(null);
  const [idCustomer, setIdCustomer] = useState<string | null>(null);
  const [tomador, setTomador] = useState<Tomador>(TOMADOR_VAZIO);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [vencimento, setVencimento] = useState(hojeISO());
  /* `undefined` = ainda não perguntado; `null` = perguntado e não tem. A
     diferença decide se o endereço é exigido, então não pode virar um só. */
  const [codigoOmie, setCodigoOmie] = useState<number | null | undefined>(undefined);
  const [parecidas, setParecidas] = useState<Parecida[]>([]);
  const [enviando, setEnviando] = useState(false);

  /* Tudo nasce vazio a cada abertura: nota é ATO, e o tomador de ontem num
     formulário de hoje é uma nota para a pessoa errada a um clique. */
  useEffect(() => {
    if (!aberto) return;
    setModo("asaas"); setBusca(""); setAchados(null); setIdCustomer(null);
    setTomador(TOMADOR_VAZIO); setValor(""); setDescricao(""); setVencimento(hojeISO());
    setCodigoOmie(undefined); setParecidas([]); setEnviando(false);
  }, [aberto]);

  /* O DOCUMENTO RESPONDE DUAS PERGUNTAS antes do clique: já tem cadastro no Omie
     (e então o endereço daqui não vai a lugar nenhum) e já saiu nota sem cobrança
     para ele (a duplicata que nenhuma sombra pega, porque não há cobrança). */
  const doc = soDigitos(tomador.doc);
  useEffect(() => {
    if (!docValido(doc)) { setCodigoOmie(undefined); setParecidas([]); return; }
    let vivo = true;
    (async () => {
      const [cli, par] = await Promise.all([
        sb.from("omie_clientes_doc").select("codigo").eq("doc", doc).order("codigo").limit(1),
        sb.from("nf_notas_sem_cobranca").select("id, valor, descricao, criado_em")
          .eq("doc", doc).order("criado_em", { ascending: false }).limit(5),
      ]);
      if (!vivo) return;
      setCodigoOmie(cli.error ? null : (cli.data?.[0]?.codigo ?? null));
      setParecidas(par.error ? [] : (par.data ?? []));
    })();
    return () => { vivo = false; };
  }, [doc]);

  /* ------------------------ O PREENCHIMENTO AUTOMÁTICO ------------------------
   * Digitou um CNPJ/CPF válido → `consultar_tomador` busca no Omie, na Receita,
   * no Asaas e no cadastro federal de contato, e o formulário se preenche. No
   * modo "digitar tudo" o achado SOBRESCREVE (foi isso que se pediu); com o
   * cliente puxado do Asaas, só tapa buraco. Digitou um CEP e falta endereço →
   * os Correios completam.
   *
   * `ultimaConsulta` guarda o documento da resposta que vale: uma resposta
   * atrasada de um CNPJ anterior não pode preencher o formulário do atual. */
  const [consultando, setConsultando] = useState<"doc" | "cep" | null>(null);
  const [fontes, setFontes] = useState<Partial<Record<CampoConsultado, string>>>({});
  const [avisosConsulta, setAvisosConsulta] = useState<string[]>([]);
  const ultimaConsulta = useRef("");
  const ultimoCep = useRef("");

  useEffect(() => {
    if (!aberto) return;
    setFontes({}); setAvisosConsulta([]); setConsultando(null);
    ultimaConsulta.current = ""; ultimoCep.current = "";
  }, [aberto]);

  useEffect(() => {
    if (!aberto || !docValido(doc) || ultimaConsulta.current === doc) return;
    if (modo === "asaas" && !idCustomer) return;
    ultimaConsulta.current = doc;
    const sobrescrever = modo === "manual";
    const herdados = sobrescrever ? (Object.keys(fontes) as CampoConsultado[]) : [];
    setConsultando("doc");
    setAvisosConsulta([]);
    (async () => {
      const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
        body: { action: "consultar_tomador", doc },
      });
      if (ultimaConsulta.current !== doc) return;
      setConsultando(null);
      if (error || data?.status !== "ok") {
        setAvisosConsulta([`Não deu para consultar este documento agora: ${await mensagemDe(error, data)} Preencha à mão.`]);
        return;
      }
      const achado = (data.tomador ?? {}) as Partial<Record<CampoConsultado, string>>;
      setTomador((t) => mesclarConsulta(t, achado, { sobrescrever, herdados }));
      setFontes(data.fontes ?? {});
      setAvisosConsulta(Array.isArray(data.avisos) ? data.avisos : []);
      if (!Object.keys(achado).length) {
        setAvisosConsulta((a) => [...a, "Nenhuma fonte conhece este documento. Preencha o tomador à mão."]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, doc, modo, idCustomer]);

  const cepDigitado = soDigitos(tomador.cep);
  useEffect(() => {
    if (!aberto || cepDigitado.length !== 8 || ultimoCep.current === cepDigitado) return;
    if (consultando === "doc") return;
    if (tomador.endereco.trim() && tomador.cidade.trim()) { ultimoCep.current = cepDigitado; return; }
    ultimoCep.current = cepDigitado;
    setConsultando("cep");
    (async () => {
      const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
        body: { action: "consultar_tomador", cep: cepDigitado },
      });
      setConsultando((c) => (c === "cep" ? null : c));
      if (error || data?.status !== "ok") return;
      setTomador((t) => mesclarConsulta(t, data.tomador ?? {}, { sobrescrever: false }));
      if (Array.isArray(data.avisos) && data.avisos.length) setAvisosConsulta((a) => [...a, ...data.avisos]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, cepDigitado, consultando]);

  const temCadastroOmie = typeof codigoOmie === "number";
  const faltas = useMemo(
    () => faltasDaNota({ tomador, valor, descricao, vencimento }, { temCadastroOmie }),
    [tomador, valor, descricao, vencimento, temCadastroOmie],
  );
  const valorLido = lerValorBRL(valor);
  const desc = descricao.replace(/\s+/g, " ").trim();

  const procurar = async () => {
    const q = busca.trim();
    if (q.length < 2) return;
    setBuscando(true);
    try {
      const dig = soDigitos(q);
      const ehDocumento = dig.length >= 11 && /^[\d.\-/\s]+$/.test(q);
      let consulta = sb.from("asaas_cache").select("id_asaas, nome, documento, dados")
        .eq("tipo", "customer").limit(15);
      consulta = ehDocumento
        ? consulta.eq("documento", dig)
        : consulta.ilike("nome", `%${q.replace(/[%_]/g, "")}%`);
      const { data, error } = await consulta;
      if (error) throw error;
      setAchados(data ?? []);
    } catch (e: any) {
      toast.error(`A busca falhou: ${e?.message ?? e}`);
    } finally {
      setBuscando(false);
    }
  };

  /* O espelho enche três vezes por dia; cliente cadastrado hoje de manhã não
     está nele. A ação `cobranca` da `asaas-sync` busca por documento ou nome, com
     meia dúzia de requisições, e grava o que achar — depois é só reler. */
  const procurarNoAsaas = async () => {
    const q = busca.trim();
    if (q.length < 2) return;
    setBuscandoNoAsaas(true);
    try {
      const dig = soDigitos(q);
      const corpo = dig.length >= 11 && /^[\d.\-/\s]+$/.test(q) ? { documento: dig } : { nome: q };
      const { data, error } = await sb.functions.invoke("asaas-sync", { body: { action: "cobranca", ...corpo } });
      if (error || data?.ok === false) throw new Error(await mensagemDe(error, data));
      if (!Number(data?.clientes ?? 0)) toast.info("O Asaas também não tem cliente com essa busca.");
      await procurar();
    } catch (e: any) {
      toast.error(`Não deu para buscar no Asaas: ${e?.message ?? e}`);
    } finally {
      setBuscandoNoAsaas(false);
    }
  };

  /* Trocar de cliente ou de modo zera a consulta anterior: sem isso, o mesmo
     documento escolhido de novo não seria consultado, e o aviso da Receita de
     outro cliente continuaria na tela. */
  const esquecerConsulta = () => {
    ultimaConsulta.current = ""; ultimoCep.current = "";
    setFontes({}); setAvisosConsulta([]); setConsultando(null);
  };

  const escolher = (c: ClienteAsaas) => {
    esquecerConsulta();
    setIdCustomer(c.id_asaas);
    setTomador(tomadorDoAsaas(c.dados));
  };

  const trocarModo = (m: "asaas" | "manual") => {
    esquecerConsulta();
    setModo(m);
    setIdCustomer(null);
    setTomador(TOMADOR_VAZIO);
    setAchados(null);
  };

  const campo = (k: keyof Tomador) => ({
    value: tomador[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTomador((t) => ({ ...t, [k]: e.target.value })),
  });

  const emitir = async () => {
    if (faltas.length || valorLido == null) return;
    const aviso =
      `Emitir NFS-e de ${brl(valorLido)} para ${tomador.nome.trim()} (${formatarDoc(doc)})?\n\n` +
      `Corpo da nota: "${desc}"\n\n` +
      `Não há cobrança no Asaas por trás desta nota. O Omie cria o título a receber, e ele fica EM ABERTO ` +
      `até alguém dar baixa.\n\n` +
      `Nota emitida não se apaga — cancela-se, com prazo e justificativa.`;
    if (!window.confirm(aviso)) return;

    setEnviando(true);
    try {
      const origem = modo === "asaas" && idCustomer ? "asaas" : "manual";
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
        body: {
          action: "sem_cobranca_preparar",
          origem,
          id_customer: origem === "asaas" ? idCustomer : null,
          tomador: tomadorParaAsaas(tomador),
          valor: valorLido,
          descricao: desc,
          vencimento,
        },
      });
      if (error || data?.erro || !data?.id) throw new Error(await mensagemDe(error, data));
      onPronto({ id: String(data.id), nome: tomador.nome.trim(), doc, valor: valorLido });
    } catch (e: any) {
      toast.error(`A nota não foi preparada: ${e?.message ?? e}`);
      setEnviando(false);
    }
  };

  const escolhido = modo === "manual" || idCustomer !== null;

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o && !enviando) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FilePlus className="h-4 w-4 text-primary" />
            Nota sem cobrança
          </DialogTitle>
          <DialogDescription className="text-xs">
            NFS-e avulsa que não parte de uma cobrança do Asaas. Puxe o cliente de lá ou digite o tomador inteiro — o
            Hub confere o endereço na Receita e nos Correios e cadastra no Omie o que faltar.
          </DialogDescription>
        </DialogHeader>

        {/* ------------------------------ a porta ------------------------------ */}
        <div className="flex gap-1 rounded-md border border-border p-1 text-xs">
          {([
            ["asaas", "Puxar cliente do Asaas", User],
            ["manual", "Digitar tudo", Pencil],
          ] as const).map(([m, rotulo, Icone]) => (
            <button
              key={m}
              onClick={() => trocarModo(m)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 font-medium transition-colors",
                modo === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icone className="h-3.5 w-3.5" />
              {rotulo}
            </button>
          ))}
        </div>

        {modo === "asaas" && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void procurar(); }}
                  placeholder="Nome ou CNPJ/CPF do cliente no Asaas"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <button
                onClick={() => void procurar()}
                disabled={buscando || busca.trim().length < 2}
                className="rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {buscando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Buscar"}
              </button>
            </div>

            {achados !== null && (
              <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                {achados.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs text-muted-foreground">
                    <span>Nenhum cliente no espelho do Asaas com essa busca.</span>
                    <button
                      onClick={() => void procurarNoAsaas()}
                      disabled={buscandoNoAsaas}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      {buscandoNoAsaas ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      Procurar direto no Asaas
                    </button>
                  </div>
                ) : achados.map((c) => (
                  <button
                    key={c.id_asaas}
                    onClick={() => escolher(c)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 border-b border-border px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-muted",
                      idCustomer === c.id_asaas && "bg-primary/5",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{c.nome ?? c.dados?.name ?? "—"}</span>
                      <span className="num block text-[11px] text-muted-foreground">
                        {c.documento ? formatarDoc(c.documento) : "sem documento"}
                        {c.dados?.deleted ? " · apagado no Asaas" : ""}
                      </span>
                    </span>
                    {idCustomer === c.id_asaas && <span className="shrink-0 text-[11px] font-medium text-primary">escolhido</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------ o tomador ------------------------------ */}
        {escolhido && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-foreground">Tomador</div>
            {modo === "asaas" && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Preenchido com o cadastro do Asaas. O que você mudar aqui vale só para esta nota — o Asaas não é alterado.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <label className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  CNPJ/CPF
                  {consultando && (
                    <span className="flex items-center gap-1 text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {consultando === "doc" ? "buscando no Omie, Receita e Asaas…" : "buscando o CEP…"}
                    </span>
                  )}
                </span>
                {/* Travado quando veio do Asaas: o servidor confere que o documento é
                    o do cliente escolhido, e trocar só aqui emitiria para outro. */}
                <Input
                  {...campo("doc")}
                  disabled={modo === "asaas"}
                  autoFocus={modo === "manual"}
                  placeholder={modo === "manual" ? "Digite e o resto se preenche" : undefined}
                  className="num h-8 text-xs"
                />
              </label>
              <label className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-4">
                Nome / razão social
                <Input {...campo("nome")} className="h-8 text-xs" />
              </label>
            </div>

            {/* DE ONDE VEIO CADA CAMPO. Preenchimento automático sem origem é
                dado que ninguém confere: "e-mail do Asaas" e "endereço da Receita"
                pedem olhares diferentes antes de virar documento fiscal. */}
            {Object.keys(fontes).length > 0 && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Preenchido por{" "}
                {Object.entries(
                  (Object.entries(fontes) as Array<[CampoConsultado, string]>).reduce<Record<string, string[]>>(
                    (acc, [campo, fonte]) => {
                      const rotulo = ROTULO_FONTE[fonte] ?? "cadastro federal de contato";
                      (acc[rotulo] ??= []).push(ROTULO_CAMPO[campo] ?? campo);
                      return acc;
                    }, {},
                  ),
                ).map(([rotulo, campos]) => `${rotulo} (${campos.join(", ")})`).join(" · ")}
                . Confira antes de emitir.
              </p>
            )}
            {avisosConsulta.length > 0 && (
              <div className="space-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                {avisosConsulta.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            )}

            {docValido(doc) && codigoOmie !== undefined && (
              temCadastroOmie ? (
                <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    Este documento já tem cadastro no Omie (código <span className="num">{codigoOmie}</span>). A nota sai
                    para o cadastro de lá, e o endereço abaixo não o altera — o Hub não escreve por cima de cadastro
                    existente.
                  </span>
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Sem cadastro no Omie: o Hub cria com estes dados, conferidos na Receita (CNPJ) e nos Correios (CEP).
                </p>
              )
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <label className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-4">
                E-mail {temCadastroOmie ? "" : "(obrigatório)"}
                <Input {...campo("email")} type="email" className="h-8 text-xs" />
              </label>
              <label className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground">
                Telefone
                <Input {...campo("telefone")} className="num h-8 text-xs" />
              </label>
              <label className="col-span-1 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-2">
                CEP
                <Input {...campo("cep")} className="num h-8 text-xs" />
              </label>
              <label className="col-span-1 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-4">
                Logradouro
                <Input {...campo("endereco")} className="h-8 text-xs" />
              </label>
              <label className="col-span-1 space-y-0.5 text-[11px] text-muted-foreground">
                Número
                <Input {...campo("numero")} className="h-8 text-xs" />
              </label>
              <label className="col-span-1 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-2">
                Complemento
                <Input {...campo("complemento")} className="h-8 text-xs" />
              </label>
              <label className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-3">
                Bairro
                <Input {...campo("bairro")} className="h-8 text-xs" />
              </label>
              <label className="col-span-1 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-4">
                Cidade
                <Input {...campo("cidade")} className="h-8 text-xs" />
              </label>
              <label className="col-span-1 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-2">
                UF
                <Input {...campo("uf")} maxLength={2} className="h-8 text-xs uppercase" />
              </label>
            </div>

            {/* ------------------------------ a nota ------------------------------ */}
            <div className="pt-1 text-xs font-semibold text-foreground">Nota</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5 text-[11px] text-muted-foreground">
                Valor
                <Input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="R$ 0,00"
                  className="num h-8 text-xs"
                />
                {valor && (
                  <span className={cn("block", valorLido == null && "text-destructive")}>
                    {valorLido == null ? "valor não reconhecido" : `lido como ${brl(valorLido)}`}
                  </span>
                )}
              </label>
              <label className="space-y-0.5 text-[11px] text-muted-foreground">
                Vencimento do título no Omie
                <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="num h-8 text-xs" />
              </label>
            </div>
            <label className="block space-y-0.5 text-[11px] text-muted-foreground">
              Descrição do serviço — é o texto que o cliente lê na nota
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className={cn("block text-right", desc.length > CABE_NA_NOTA && "text-destructive")}>
                {desc.length}/{CABE_NA_NOTA}
              </span>
            </label>

            {parecidas.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                <div className="flex items-center gap-1.5 font-semibold">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Já saiu nota sem cobrança para este documento
                </div>
                {parecidas.map((p) => (
                  <div key={p.id} className="mt-0.5 flex justify-between gap-2">
                    <span className="truncate">
                      {new Date(p.criado_em).toLocaleDateString("pt-BR")} · {p.descricao}
                    </span>
                    <span className="num shrink-0">{brl(Number(p.valor))}</span>
                  </div>
                ))}
                <div className="mt-1">Confira se esta não é a mesma nota. Nenhuma guarda automática pega essa duplicata.</div>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                A nota sai com a <strong className="text-foreground">mesma classificação fiscal das mensalidades</strong>{" "}
                (código de serviço, alíquotas e categoria copiados da última nota autorizada). Se o serviço for de outra
                natureza, não emita por aqui. O título a receber que o Omie cria fica <strong className="text-foreground">em
                aberto</strong>: sem cobrança no Asaas, o Hub não tem como saber que o dinheiro entrou.
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {escolhido && faltas.length > 0 && (
            <span className="mr-auto text-[11px] text-muted-foreground">Falta: {faltas.join(" · ")}</span>
          )}
          <button
            onClick={onFechar}
            disabled={enviando}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void emitir()}
            disabled={!escolhido || faltas.length > 0 || enviando || codigoOmie === undefined}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {enviando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Emitir nota{valorLido != null ? ` de ${brl(valorLido)}` : ""}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
