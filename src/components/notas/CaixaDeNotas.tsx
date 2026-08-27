/* ---------------------------------------------------------------------------
 * A CAIXA DE NOTAS — jogue os arquivos aqui e o Hub descobre de quem são.
 *
 * O pedido, em 27/08/2026: *"eu vou ter que abrir cada um desses links para
 * pegar a nota. Até tudo bem, vai ter que ser manual mesmo. Mas depois, para
 * achar cada lançamento desse e colocar a nota, vai dar maior trabalho. Cria um
 * espaço onde eu posso jogar notas avulsas."*
 *
 * ESTA TELA NÃO DECIDE NADA. Ela recebe arquivo e mostra o que aconteceu com
 * ele. Quem lê é a `nota-ler-arquivo` (texto quando o PDF tem texto, IA quando é
 * foto ou digitalização); quem escolhe o lançamento é o `notas_externas_casar`,
 * com as mesmas oito regras que valem para o que entra por e-mail, planilha e
 * Drive; quem anexa no ERP é a `omie-anexar-comprovante`.
 *
 * O ESTADO DE CADA LINHA É DEDUZIDO NO BANCO (`caixa_notas_lista`), e não
 * guardado numa coluna: seria uma quinta verdade sobre a mesma nota, ao lado de
 * `alvo_id_unico`, `confianca`, `fila_erp` e `enviado_erp_em`.
 *
 * O QUE PRECISA DE GENTE FICA EM CIMA. "Sem dono" é o único trabalho de verdade
 * desta tela; o resto anda sozinho e está aqui só para quem quiser conferir.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { brlStr, dataStr, formatarDoc, type LinhaTitulo } from "@/lib/notasErp";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Clock, Eye, HelpCircle, Loader2, Search,
  Send, Upload, X,
} from "lucide-react";

const sb = supabase as any;

/** Uma leva por chamada. O servidor recusa acima disso e a tela não deve tentar. */
const POR_LEVA = 12;
const ACEITA = ".pdf,.xml,.jpg,.jpeg,.png,.webp,.zip";

type Estado = "lendo" | "nao_deu" | "sem_dono" | "esperando" | "subindo" | "no_omie";

type LinhaCaixa = {
  id: number;
  fonte: string;
  arquivo: string;
  detalhe: string | null;
  visto_em: string | null;
  lido_em: string | null;
  leitura_erro: string | null;
  nome: string | null;
  cnpj: string | null;
  valor: number | null;
  documento: string | null;
  data_doc: string | null;
  tipo_documento: string | null;
  casamento: string | null;
  confianca: string | null;
  alvo_id_unico: string | null;
  alvo_favorecido: string | null;
  alvo_valor: number | null;
  alvo_data: string | null;
  enviado_erp_em: string | null;
  erro_erp: string | null;
  estado: Estado;
};

const ESTADO: Record<Estado, { rotulo: string; ajuda: string; tom: string; ordem: number }> = {
  sem_dono: {
    rotulo: "Sem dono", ordem: 1,
    tom: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    ajuda: "O Hub leu o papel e nenhuma regra achou o lançamento. É o único trabalho desta tela: apontar qual é.",
  },
  nao_deu: {
    rotulo: "Não deu para ler", ordem: 2,
    tom: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
    ajuda: "O arquivo está ilegível, veio num formato que a leitura não abre, ou a IA falhou. A varredura tenta de novo sozinha quando a falha é passageira.",
  },
  esperando: {
    rotulo: "Achou — confirme", ordem: 3,
    tom: "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
    ajuda: "Casou por valor e data, sem o CNPJ para provar. Um clique manda ao Omie.",
  },
  lendo: {
    rotulo: "Lendo", ordem: 4,
    tom: "border-border bg-muted/50 text-muted-foreground",
    ajuda: "Entrou agora. A leitura tira do papel o fornecedor, o CNPJ, o valor e a data — foto e digitalização passam pela IA e demoram alguns segundos a mais.",
  },
  subindo: {
    rotulo: "Subindo ao Omie", ordem: 5,
    tom: "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    ajuda: "Casou com identidade (chave fiscal ou CNPJ + valor) e está na fila. Ninguém precisa fazer nada.",
  },
  no_omie: {
    rotulo: "No Omie", ordem: 6,
    tom: "border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    ajuda: "O anexo já está no título dentro do ERP.",
  },
};

/* ============================ o achador de título ============================
 *
 * Aparece só na linha sem dono, e nasce com a busca preenchida pelo que a
 * leitura tirou do papel — CNPJ quando há, senão o nome. É o que transforma
 * "procure o lançamento" em "confirme este". */

function AcharTitulo({ linha, aoApontar }: {
  linha: LinhaCaixa;
  aoApontar: (cod: number) => Promise<void>;
}) {
  const [busca, setBusca] = useState(() => linha.cnpj || linha.nome || "");
  const [linhas, setLinhas] = useState<LinhaTitulo[] | null>(null);
  const [procurando, setProcurando] = useState(false);

  const procurar = useCallback(async (termo: string) => {
    if (termo.trim().length < 3) { setLinhas([]); return; }
    setProcurando(true);
    const { data, error } = await sb.rpc("cap_notas_titulos", {
      p_de: null, p_ate: null,
      /* Sem recorte de situação: a nota avulsa às vezes é a segunda de um título
         que já tem anexo, e escondê-lo faria a busca "não achar" o que existe. */
      p_busca: termo.trim(), p_limite: 40,
    });
    setProcurando(false);
    if (error) { toast.error(`Busca falhou: ${error.message}`); setLinhas([]); return; }
    setLinhas((data as LinhaTitulo[]) ?? []);
  }, []);

  useEffect(() => { void procurar(busca); /* a primeira busca é automática */ }, []); // eslint-disable-line

  /* O MAIS PARECIDO PRIMEIRO: mesmo valor do papel na frente, depois a data mais
     próxima. Sem isso a lista vem na ordem do banco e a linha certa fica no meio
     de quarenta. */
  const ordenadas = useMemo(() => {
    const v = linha.valor ?? null;
    const d = linha.data_doc ? new Date(linha.data_doc).getTime() : null;
    return [...(linhas ?? [])].sort((a, b) => {
      const dv = (x: LinhaTitulo) => (v == null ? 0 : Math.abs(Number(x.valor) - v));
      const dd = (x: LinhaTitulo) => {
        if (d == null || !x.competencia) return 0;
        return Math.abs(new Date(x.competencia).getTime() - d);
      };
      return dv(a) - dv(b) || dd(a) - dd(b);
    });
  }, [linhas, linha.valor, linha.data_doc]);

  return (
    <div className="mt-2 rounded border border-border bg-muted/30 p-2">
      <div className="flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[12.5px]"
          placeholder="fornecedor, CNPJ ou nº do título"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void procurar(busca); }}
        />
        <button className="chip shrink-0" onClick={() => void procurar(busca)} disabled={procurando}>
          {procurando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Procurar"}
        </button>
      </div>

      {linhas && !linhas.length && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Nenhum lançamento com esse termo. Tente pelo CNPJ, ou pelo nome como o Omie o escreve.
        </p>
      )}

      {!!ordenadas.length && (
        <div className="mt-2 max-h-56 divide-y divide-border overflow-auto rounded border border-border bg-background">
          {ordenadas.map((t) => {
            const mesmoValor = linha.valor != null && Math.abs(Number(t.valor) - linha.valor) < 0.01;
            return (
              <button
                key={t.cod_titulo}
                className="flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-muted/60"
                onClick={() => void aoApontar(t.cod_titulo)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {t.favorecido}
                  <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                    {t.cod_titulo}
                  </span>
                </span>
                <span className={cn("shrink-0 tabular-nums", mesmoValor && "font-semibold text-emerald-700 dark:text-emerald-400")}>
                  {brlStr(Number(t.valor))}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{dataStr(t.competencia)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================= a tela ================================= */

export function CaixaDeNotas() {
  const [linhas, setLinhas] = useState<LinhaCaixa[] | null>(null);
  const [subindo, setSubindo] = useState<{ feitos: number; total: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [mostrarEmail, setMostrarEmail] = useState(false);
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const ler = useCallback(async () => {
    const { data, error } = await sb.rpc("caixa_notas_lista", { p_dias: 7, p_limite: 200 });
    if (error) { toast.error(`Não deu para ler a caixa: ${error.message}`); return; }
    setLinhas((data as LinhaCaixa[]) ?? []);
  }, []);

  useEffect(() => { void ler(); }, [ler]);

  /* ENQUANTO HOUVER "LENDO", RELÊ SOZINHA. A leitura por IA leva ~25s por
     arquivo e a pessoa fica olhando a tela — sem isto ela apertaria F5 para
     descobrir se acabou. Para quando não há mais nada em movimento, porque um
     `setInterval` eterno numa aba aberta o dia todo é uma chamada por minuto
     para sempre. */
  const emMovimento = (linhas ?? []).some((l) => l.estado === "lendo" || l.estado === "subindo");
  useEffect(() => {
    if (!emMovimento) return;
    const t = setInterval(() => void ler(), 6000);
    return () => clearInterval(t);
  }, [emMovimento, ler]);

  async function enviar(arquivos: File[]) {
    const bons = arquivos.filter((f) => f.size > 0);
    if (!bons.length) return;
    setSubindo({ feitos: 0, total: bons.length });

    /* EM LEVAS, e em série. Um POST com vinte PDF em base64 passa dos limites do
       gateway; e o servidor lê os arquivos na mesma chamada, então mandar tudo
       de uma vez estouraria o tempo dele em vez do nosso. */
    for (let i = 0; i < bons.length; i += POR_LEVA) {
      const leva = bons.slice(i, i + POR_LEVA);
      try {
        const payload = await Promise.all(leva.map(async (f) => ({
          nome: f.name,
          mime: f.type || null,
          base64: await base64De(f),
        })));
        const r = await invocar<any>(sb.functions.invoke("nota-caixa", {
          body: { action: "subir", arquivos: payload },
        }));
        for (const ruim of r?.recusados ?? []) toast.error(`${ruim.nome}: ${ruim.erro}`);
        setSubindo({ feitos: Math.min(i + leva.length, bons.length), total: bons.length });
        await ler();
      } catch (e: any) {
        toast.error(`Não deu para enviar: ${e?.message ?? e}`);
        break;
      }
    }
    setSubindo(null);
    void ler();
  }

  async function apontar(id: number, cod: number) {
    const { data, error } = await sb.rpc("caixa_nota_apontar", { p_id: id, p_cod_titulo: cod });
    if (error) { toast.error(error.message); return; }
    if (data && (data as any).ok === false) { toast.error(String((data as any).erro)); return; }
    toast.success(`Ligada ao título ${cod}. O Hub leva ao Omie.`);
    await ler();
  }

  /* CONFIRMAR E ENFILEIRAR SÃO DOIS GESTOS NO BANCO, e um só na tela.
     `notas_externas_confirmar` só carimba `alvo_manual` — ela nem toca em
     `fila_erp`, de propósito, porque no Acervo confirmar e mandar são decisões
     separadas. Aqui não são: quem clica em "é esta" está mandando. Chamar só a
     primeira deixaria a nota confirmada e parada, que é o pior desfecho
     possível para um botão que promete subir. */
  async function confirmar(id: number) {
    const { error } = await sb.rpc("notas_externas_confirmar", { p_ids: [id] });
    if (error) { toast.error(error.message); return; }
    const { data: n, error: e2 } = await sb.rpc("notas_externas_enfileirar", { p_ids: [id] });
    if (e2) { toast.error(`Confirmada, mas não entrou na fila: ${e2.message}`); await ler(); return; }
    if (!n) toast.warning("Confirmada, mas a fila recusou — veja \"Falta um passo\".");
    else toast.success("Confirmada. Está na fila do Omie.");
    await ler();
  }

  async function ignorar(id: number) {
    const { error } = await sb.rpc("notas_externas_ignorar", { p_id: id, p_motivo: "descartada na caixa" });
    if (error) { toast.error(error.message); return; }
    await ler();
  }

  async function abrir(id: number) {
    setAbrindo(id);
    try {
      const r = await invocar<any>(sb.functions.invoke("nota-caixa", { body: { action: "abrir", id } }));
      if (r?.url) window.open(r.url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(`Não deu para abrir: ${e?.message ?? e}`);
    } finally {
      setAbrindo(null);
    }
  }

  const visiveis = useMemo(() => {
    const base = (linhas ?? []).filter((l) => mostrarEmail || l.fonte === "caixa");
    return [...base].sort((a, b) =>
      ESTADO[a.estado].ordem - ESTADO[b.estado].ordem ||
      String(b.visto_em ?? "").localeCompare(String(a.visto_em ?? "")),
    );
  }, [linhas, mostrarEmail]);

  const doEmail = (linhas ?? []).filter((l) => l.fonte === "email");
  const contagem = useMemo(() => {
    const m = new Map<Estado, number>();
    for (const l of visiveis) m.set(l.estado, (m.get(l.estado) ?? 0) + 1);
    return m;
  }, [visiveis]);

  return (
    <div className="space-y-3">
      {/* ------------------------- a porta ------------------------- */}
      <div
        className={cn(
          "card-surface flex flex-col items-center justify-center gap-2 border-2 border-dashed p-6 text-center transition",
          arrastando ? "border-primary bg-primary/5" : "border-border",
        )}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault(); setArrastando(false);
          void enviar(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-[13.5px] font-medium">
          Arraste as notas para cá, ou{" "}
          <button className="underline underline-offset-2" onClick={() => entrada.current?.click()}>
            escolha os arquivos
          </button>
        </p>
        <p className="max-w-2xl text-[12px] text-muted-foreground">
          PDF, XML, foto ou print — e ZIP com a pasta inteira. O Hub lê cada um, acha o
          lançamento e anexa no Omie sozinho quando o papel se identifica. O que ele não
          conseguir ligar sozinho aparece aqui embaixo como <b>Sem dono</b>, para você
          apontar num clique.
        </p>
        <input
          ref={entrada} type="file" multiple accept={ACEITA} className="hidden"
          onChange={(e) => { void enviar(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        {subindo && (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            enviando e lendo {subindo.feitos} de {subindo.total}…
          </p>
        )}
      </div>

      {/* ------------------------- o que está nela ------------------------- */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(ESTADO) as Estado[])
              .sort((a, b) => ESTADO[a].ordem - ESTADO[b].ordem)
              .filter((e) => (contagem.get(e) ?? 0) > 0)
              .map((e) => (
                <span key={e} className={cn("rounded border px-1.5 py-0.5 text-[11.5px]", ESTADO[e].tom)}
                      title={ESTADO[e].ajuda}>
                  {contagem.get(e)} {ESTADO[e].rotulo.toLowerCase()}
                </span>
              ))}
            {!visiveis.length && (
              <span className="text-[12.5px] text-muted-foreground">
                A caixa está vazia. Jogue os arquivos aí em cima.
              </span>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={mostrarEmail} onChange={(e) => setMostrarEmail(e.target.checked)} />
            mostrar o que entrou por e-mail ({doEmail.length} em 7 dias)
          </label>
        </div>

        <div className="mt-3 divide-y divide-border">
          {visiveis.map((l) => {
            const meta = ESTADO[l.estado];
            return (
              <div key={l.id} className="py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[11px]", meta.tom)}
                        title={meta.ajuda}>
                    {meta.rotulo}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{l.arquivo}</span>
                  {l.fonte === "email" && (
                    <span className="shrink-0 rounded border border-border px-1 text-[10.5px] text-muted-foreground">
                      e-mail
                    </span>
                  )}
                  <button className="ghost-icone shrink-0" onClick={() => void abrir(l.id)}
                          disabled={abrindo === l.id} title="Abrir o arquivo">
                    {abrindo === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  </button>
                  {l.estado !== "no_omie" && (
                    <button className="ghost-icone shrink-0" onClick={() => void ignorar(l.id)}
                            title="Descartar — não é nota de nada">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* O QUE O HUB LEU. Fica visível de propósito: quando o casamento
                    sair errado, é aqui que se vê se a culpa foi da leitura. */}
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {l.valor != null || l.nome ? (
                    <>
                      leu: {l.nome || "fornecedor não identificado"}
                      {l.cnpj ? ` · ${formatarDoc(l.cnpj)}` : ""}
                      {l.valor != null ? ` · ${brlStr(Number(l.valor))}` : " · sem valor"}
                      {l.data_doc ? ` · ${dataStr(l.data_doc)}` : ""}
                      {l.documento ? ` · nº ${l.documento}` : ""}
                    </>
                  ) : l.estado === "lendo" ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> abrindo o arquivo…
                    </span>
                  ) : (
                    l.leitura_erro || "nada foi extraído do arquivo"
                  )}
                </p>

                {l.leitura_erro && l.valor != null && (
                  <p className="mt-0.5 text-[11.5px] text-amber-700 dark:text-amber-400">{l.leitura_erro}</p>
                )}

                {l.alvo_id_unico && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="font-medium">{l.alvo_favorecido ?? `título ${l.alvo_id_unico}`}</span>
                    <span className="text-muted-foreground">
                      {l.alvo_valor != null ? brlStr(Number(l.alvo_valor)) : ""}
                      {l.alvo_data ? ` · ${dataStr(l.alvo_data)}` : ""}
                      {l.casamento ? ` · por ${l.casamento}` : ""}
                    </span>
                    {l.estado === "esperando" && (
                      <button className="chip" onClick={() => void confirmar(l.id)}>
                        <Send className="h-3.5 w-3.5" /> É esta — pode subir
                      </button>
                    )}
                  </p>
                )}

                {l.erro_erp && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-red-700 dark:text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> {l.erro_erp}
                  </p>
                )}

                {l.estado === "sem_dono" && (
                  <AcharTitulo linha={l} aoApontar={(cod) => apontar(l.id, cod)} />
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-3 flex items-start gap-1.5 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Quem casa a nota com o lançamento é a mesma regra que vale para o e-mail, a
          planilha e o Drive — identidade (chave fiscal, ou CNPJ + valor) sobe sozinha;
          valor e data pedem um clique. A IA aqui só TRANSCREVE o papel: ela nunca escolhe
          o título.
        </p>
      </div>
    </div>
  );
}

/** Lê o arquivo como base64 sem o prefixo `data:`. */
function base64De(f: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^;]+;base64,/, ""));
    r.onerror = () => erro(new Error(`não deu para ler ${f.name}`));
    r.readAsDataURL(f);
  });
}
