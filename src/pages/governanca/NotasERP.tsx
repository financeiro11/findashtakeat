/* /governanca/notas-erp — "a nota do fornecedor está dentro do Omie?"
 *
 * A PERGUNTA QUE ESTA TELA RESPONDE é a que não tinha resposta até 25/08/2026.
 * O Hub sabia o que ELE tinha mandado (82 anexos) e o que a varredura do PIX
 * tinha lido de UMA conta. Para todo o resto — o cartão corporativo, o BTG, as
 * contas de subvenção — um título com nota anexada à mão no ERP e um título sem
 * nota nenhuma eram indistinguíveis daqui.
 *
 * O NÚMERO PRECISA SOBREVIVER A UMA PERGUNTA. Por isso a tela é construída em
 * cima de duas coisas que não são opinião:
 *
 *   • o DENOMINADOR vem da régua (`omie_categoria_regra`), e a régua é visível e
 *     editável na última aba. Transferência entre contas próprias, folha, tributo
 *     e tarifa bancária não têm nota de fornecedor; contá-las como "faltando"
 *     derruba a cobertura por um motivo que não é problema.
 *
 *   • o NUMERADOR vem de `ListarAnexo` chamado no Omie, título a título, e não
 *     do que o Hub acha que mandou. Anexo posto à mão por alguém conta; anexo que
 *     o Hub mandou e o Omie recusou, não conta.
 *
 * E ENQUANTO HOUVER TÍTULO NÃO VERIFICADO, a cobertura é dita como PISO, nunca
 * como o número. Prometer precisão que o dado ainda não tem é o jeito mais rápido
 * de perder a autoridade do painel inteiro.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, CreditCard,
  ExternalLink, Eye, FileWarning, FilterX, Flame, Loader2, Paperclip, RefreshCw, Scale,
  Search, Send, ShieldAlert, ShieldCheck, ShieldQuestion, ThumbsDown, ThumbsUp, Upload,
} from "lucide-react";
import { resolverComprovante } from "@/lib/comprovante";
import {
  brlStr, categoriasCriticas, dataStr, fatias, formatarDoc, frasePanorama, mesCurto,
  nomeDaLinha, ondeAbrir, pctStr, periodoPadrao, resumoDoCorte, urlParaEmbutir,
  GRAVIDADE, GRAVIDADES, REGRA, SITUACAO,
  SITUACOES_EXIGIVEIS, SITUACOES_FALTANDO, SITUACOES_NOSSAS,
  type FacetasNotas, type Gravidade, type LinhaTitulo, type OndeAbrir, type Regra,
  type ResumoNotas, type SituacaoTitulo,
} from "@/lib/notasErp";
import { useApelidos } from "@/hooks/useApelidos";
import { nomeExibido } from "@/lib/apelidos";
import { invocar } from "@/lib/erroEdge";
/* O filtro-de-coluna do Hub. Nasceu na Parametrização e continua morando lá —
   é genérico (cabeçalho, botão de barra, lista marcável, faixa de número, faixa
   de meses) e não sabe nada daquela tela. */
import {
  BotaoFiltravel, CabecalhoFiltravel, FaixaMeses, FaixaNumero, ListaMarcavel,
} from "@/components/parametrizacao/FiltroCabecalho";

const sb = supabase as any;
const brl = (n: number) => comValorExato(n, brlStr(n));

/* O bucket é PRIVADO: o caminho não abre sozinho, precisa de URL assinada.
   `resolverComprovante` é o mesmo resolvedor que a auditoria já usa — dois
   jeitos de abrir o mesmo bucket seria dois jeitos de quebrar. */
async function abrirCopia(caminho: string) {
  try {
    window.open(await resolverComprovante(caminho), "_blank", "noopener");
  } catch (e: any) {
    toast.error(`Não deu para abrir a cópia: ${e?.message ?? e}`);
  }
}

/** CNPJ só com dígitos não se confere de olho — e é por ele que se procura. */
const cnpjBonito = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return v ?? "";
};

/**
 * O valor com atraso, para o que dispara consulta.
 *
 * `cap_notas_titulos` abre o `omie_cache` inteiro (10.965 movimentos num único
 * JSONB) a cada chamada: 880 ms medidos. Ligada direto no `onChange`, a busca
 * por "cesan" custava CINCO dessas — quatro delas de resultados que ninguém
 * chegou a ver, todas concorrendo com a varredura pelo mesmo banco.
 */
function useComAtraso<T>(valor: T, ms = 350): T {
  const [lento, setLento] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setLento(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return lento;
}

/**
 * O nome de cada linha, com o apelido por cima — inclusive no gasto de cartão,
 * cujo lojista só existe dentro da observação. Ver `nomeDaLinha`.
 */
function useNomeDaLinha() {
  const mapa = useApelidos();
  return useCallback(
    (l: Pick<LinhaTitulo, "favorecido" | "favorecido_cru" | "observacao" | "doc">) =>
      nomeDaLinha(l, (nome, doc) => nomeExibido(mapa, nome, doc ?? null)),
    [mapa],
  );
}

/** Favorecido em duas linhas: o nome que se lê, e o que se procura no Omie. */
function Favorecido({ l, nomear }: {
  l: LinhaTitulo;
  nomear: ReturnType<typeof useNomeDaLinha>;
}) {
  const n = nomear(l);
  return (
    <>
      <span className="block">
        {n.nome}
        {n.deCartao && (
          <span className="ml-1.5 text-[11px] text-muted-foreground" title="Gasto de cartão: o lojista vem da observação do título">
            cartão
          </span>
        )}
      </span>
      <span className="block font-mono text-[11px] text-muted-foreground">
        {/* O nome CRU fica aqui porque é ele que se procura no Omie — e some do
            filtro se não estiver escrito na linha (convenção do repo). */}
        {n.cru !== n.nome ? `${n.cru} · ` : ""}
        {formatarDoc(l.doc)} · título {l.cod_titulo}
      </span>
    </>
  );
}

/* ============================ o arquivo, aqui ============================
 *
 * POR QUE ABRIR O ARQUIVO É PARTE DA TELA, e não um link para o ERP.
 *
 * A aba "Anexo a conferir" pede uma decisão — "é a nota deste título?" — e
 * mostrava só o NOME do arquivo: `nf_undefined_correta.pdf`,
 * `5aef68b9-...tmp.pdf`, `whatsappimage2026-04-02at16.05.40 (2).jpeg`. São
 * exatamente os nomes que não dizem nada; é por isso que aquelas linhas estão
 * ali. Decidir por eles é adivinhar, e a alternativa — abrir o Omie, procurar o
 * título, baixar o anexo, voltar — é o trabalho que a tela existe para poupar.
 *
 * O arquivo vem de dois lugares e quem olha não precisa saber de qual: se o ERP
 * tem anexo, é o dele (é o que está valendo); se não tem e o Hub tem, é o do Hub
 * (é o que vai subir). Ver `ondeAbrir`.
 */

type Arquivo = { fonte: string; nome: string; tipo?: string | null; url?: string; base64?: string };

/** base64 → endereço que o navegador exibe. Blob, e não `data:`: iframe com
 *  `data:` é bloqueado pelo Chrome, e o quadro sairia branco sem erro. */
function urlDeBase64(base64: string, tipo: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: tipo }));
}

function useArquivoDoTitulo(cod: number | null, onde: OndeAbrir) {
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!cod || !onde) { setArquivo(null); setErro(null); return; }
    let vivo = true;
    let criada: string | null = null;
    setCarregando(true); setErro(null); setArquivo(null);
    (async () => {
      try {
        const d = await invocar<Arquivo>(
          sb.functions.invoke("omie-anexo-abrir", { body: { action: onde, cod_titulo: cod } }),
        );
        if (!vivo) return;
        const tipo = d?.tipo || "application/pdf";
        if (d?.base64) { criada = urlDeBase64(d.base64, tipo); setArquivo({ ...d, tipo, url: criada }); }
        else setArquivo({ ...d, tipo });
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    // O Blob fica na memória da aba até alguém devolvê-lo. Uma fila de 30 anexos
    // conferidos em sequência são 30 arquivos vazando sem isto.
    return () => { vivo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [cod, onde]);

  return { arquivo, carregando, erro };
}

/**
 * O visor: o arquivo grande, e ao lado dele o que se precisa saber para decidir.
 *
 * `aoDecidir` é opcional de propósito. Em "Anexo a conferir" o visor É a tela de
 * trabalho — olhar e responder no mesmo lugar, com o próximo da fila a um clique
 * — e na aba Títulos ele é só uma conferida.
 */
/* O PRÓXIMO DA FILA, BUSCADO ENQUANTO SE OLHA O ATUAL.
 *
 * Quem confere anexo anda em linha reta: 2/32, 3/32, 4/32. O link do próximo
 * pode ser pedido durante os segundos em que a pessoa olha o de agora — e
 * quando ela clica em "Próximo", ele já está guardado.
 *
 * Não guarda nada em memória de propósito: o resultado vai para
 * `omie_anexo_link` no servidor, e é de lá que o clique seguinte lê. Assim o
 * trabalho aproveita também para quem abrir a mesma fila depois. */
function usePreBuscar(cod: number | null | undefined, onde: OndeAbrir) {
  useEffect(() => {
    if (!cod || onde !== "erp") return;
    const t = setTimeout(() => {
      void sb.functions.invoke("omie-anexo-abrir", { body: { action: "erp", cod_titulo: cod } })
        .catch(() => {});
    }, 400); // o suficiente para não disparar em cada tecla de navegação rápida
    return () => clearTimeout(t);
  }, [cod, onde]);
}

function VisorAnexo({ linha, onde, nomear, aoFechar, aoDecidir, salvando, fila, proximoCod }: {
  linha: LinhaTitulo;
  onde: Exclude<OndeAbrir, null>;
  nomear: ReturnType<typeof useNomeDaLinha>;
  aoFechar: () => void;
  aoDecidir?: (veredito: "nota" | "nao_e_nota") => void;
  salvando?: boolean;
  fila?: { indice: number; total: number; ir: (passo: 1 | -1) => void };
  /** O título que vem depois na fila, para buscar o link antes do clique. */
  proximoCod?: number | null;
}) {
  const { arquivo, carregando, erro } = useArquivoDoTitulo(linha.cod_titulo, onde);
  usePreBuscar(proximoCod, onde);
  const n = nomear(linha);
  const ehImagem = /^image\//i.test(arquivo?.tipo ?? "") || /\.(png|jpe?g|webp|gif)$/i.test(arquivo?.nome ?? "");

  return (
    <Dialog open onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <DialogContent className="flex h-[88vh] max-w-6xl flex-col gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3 pr-12">
          <div className="min-w-0">
            <DialogTitle className="truncate text-[14px] font-semibold">{n.nome}</DialogTitle>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {n.cru !== n.nome ? `${n.cru} · ` : ""}título {linha.cod_titulo} ·{" "}
              {brlStr(linha.valor)} · {dataStr(linha.competencia)}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {onde === "erp" ? "anexo do Omie" : `arquivo do Hub · ${arquivo?.fonte ?? linha.nota_no_hub}`}
              {arquivo?.nome ? ` · ${arquivo.nome}` : ""}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {fila && fila.total > 1 && (
              <span className="mr-1 flex items-center gap-1 text-[12px] text-muted-foreground">
                <button className="ghost-icone" onClick={() => fila.ir(-1)} aria-label="Anterior">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {fila.indice + 1}/{fila.total}
                <button className="ghost-icone" onClick={() => fila.ir(1)} aria-label="Próximo">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </span>
            )}
            {arquivo?.url && (
              <a className="chip" href={arquivo.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Nova aba
              </a>
            )}
            {aoDecidir && (
              <>
                <button className={cn("chip", TOM.ok)} disabled={salvando} onClick={() => aoDecidir("nota")}>
                  <ThumbsUp className="h-3.5 w-3.5" /> É a nota
                </button>
                <button className={cn("chip", TOM.falta)} disabled={salvando} onClick={() => aoDecidir("nao_e_nota")}>
                  <ThumbsDown className="h-3.5 w-3.5" /> Não é
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-muted/40">
          {carregando && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando o arquivo…
            </div>
          )}
          {!carregando && erro && (
            <div className="flex h-full items-center justify-center p-8">
              <p className="max-w-xl text-center text-[13px] text-muted-foreground">
                <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-amber-500" />
                {erro}
              </p>
            </div>
          )}
          {!carregando && !erro && arquivo?.url && (
            ehImagem
              ? <img src={arquivo.url} alt={arquivo.nome} className="mx-auto max-h-full" />
              : <iframe src={urlParaEmbutir(arquivo.url)} title={arquivo.nome} className="h-full w-full border-0" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ANEXAR A NOTA AQUI, na linha que a cobra.
 *
 * Era o buraco no meio da esteira: o Hub sabia dizer quem devia nota por quatro
 * caminhos automáticos e nenhum servia para o caso mais comum — a nota chegou
 * por fora (WhatsApp, portal do fornecedor, link no corpo do e-mail) e a pessoa
 * está com ela na mão, olhando para a linha. O caminho existente era abrir o
 * Omie noutra aba, achar o título e anexar lá — e aí o Hub só ficava sabendo na
 * varredura seguinte, sem nunca registrar de onde veio.
 *
 * Um clique põe o arquivo no acervo, espalha para as outras listas que cobram o
 * mesmo gasto e enfileira para o ERP. Ver `nota-anexar-titulo`.
 *
 * O `<input>` é recriado a cada anexo (`key`): sem isso, escolher o MESMO
 * arquivo duas vezes não dispara `onChange` — o valor não mudou — e o segundo
 * clique parece que não fez nada.
 */
function BotaoAnexar({ l, onPronto }: { l: LinhaTitulo; onPronto: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [rodada, setRodada] = useState(0);

  async function enviar(arquivo: File) {
    if (arquivo.size > 10 * 1024 * 1024) {
      toast.error("Arquivo maior que 10 MB.");
      return;
    }
    setEnviando(true);
    try {
      const base64 = await new Promise<string>((ok, falhou) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result ?? "").split(",")[1] ?? "");
        r.onerror = () => falhou(new Error("não deu para ler o arquivo"));
        r.readAsDataURL(arquivo);
      });
      /* `invocar` desembrulha o erro que a função devolve DENTRO de um 200 —
         padrão desta casa, e sem ele um "Formato inválido" passaria como
         sucesso silencioso. Ver `erroEdge.ts`. */
      const r = await invocar<any>(sb.functions.invoke("nota-anexar-titulo", {
        body: { cod_titulo: l.cod_titulo, nome: arquivo.name, base64, mime: arquivo.type || null },
      }));
      toast.success(
        r?.enviando
          ? "Nota anexada e a caminho do Omie."
          : "Nota anexada. Ela sobe ao Omie na próxima rodada (a cada 15 min).",
      );
      onPronto();
    } catch (e: any) {
      toast.error(`Não deu para anexar: ${e?.message ?? e}`);
    } finally {
      setEnviando(false);
      setRodada((n) => n + 1);
    }
  }

  return (
    <label
      className={cn("ghost-icone cursor-pointer", enviando && "pointer-events-none opacity-60")}
      title={`Anexar a nota deste título (${l.cod_titulo}) — vai para o acervo, para as outras listas e para o Omie`}
    >
      {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      <span className="sr-only">Anexar a nota</span>
      <input
        key={rodada}
        type="file"
        className="hidden"
        accept=".pdf,.xml,.jpg,.jpeg,.png,.webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviar(f);
        }}
      />
    </label>
  );
}

/** O botão que abre o visor — some quando não há arquivo nenhum para ver. */
function BotaoAbrir({ l, onAbrir }: { l: LinhaTitulo; onAbrir: (onde: Exclude<OndeAbrir, null>) => void }) {
  const onde = ondeAbrir(l);
  if (!onde) return null;
  return (
    <button
      className="ghost-icone"
      onClick={() => onAbrir(onde)}
      title={onde === "erp" ? "Abrir o anexo que está no Omie" : "Abrir a nota que o Hub tem"}
      aria-label="Abrir o arquivo"
    >
      <Eye className="h-4 w-4" />
    </button>
  );
}

type Aba = "panorama" | "categorias" | "fornecedores" | "titulos" | "acervo" | "revisar" | "quase" | "regua";

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: "panorama", rotulo: "Panorama" },
  { id: "categorias", rotulo: "Categorias" },
  { id: "fornecedores", rotulo: "Quem deve nota" },
  { id: "titulos", rotulo: "Títulos" },
  { id: "acervo", rotulo: "Acervo de notas" },
  { id: "revisar", rotulo: "Anexo a conferir" },
  { id: "quase", rotulo: "Falta um passo" },
  { id: "regua", rotulo: "Régua" },
];

const TOM: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  falta: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
  atencao: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
  neutro: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400",
  fora: "bg-muted text-muted-foreground border-border",
};

/**
 * OS QUATRO CARTÕES DE AÇÃO — e a linha que separa máquina de gente.
 *
 * Cada um leva a uma lista JÁ FILTRADA pelo que ele conta. Parece óbvio e não
 * era: até 26/08/2026 o clique só trocava de aba, e a lista abria no recorte
 * padrão — o cartão dizia "16 títulos, R$ 21.054" e a tela respondia com 1.395
 * linhas de "Sem nota". Um painel cujo número não sobrevive ao próprio clique
 * ensina a não clicar.
 *
 * O primeiro cartão é o único que soma dois estados, porque os dois são a mesma
 * frase: "não é com você". O arquivo já está na mão do Hub, a varredura de envio
 * o leva de 15 em 15 minutos e a de leitura confirma logo depois. Quando uma
 * linha emperra de verdade, ela não fica aqui — vai para "Falta um passo", com
 * o motivo escrito.
 */
const CARTOES: Array<{
  id: string; rotulo: string; tom: string; icone: ReactNode;
  situacoes: SituacaoTitulo[]; aba: Aba; ajuda: string; rodape?: string;
}> = [
  {
    id: "nossa_fila", rotulo: "O Hub leva sozinho", tom: "atencao",
    icone: <Send className="h-3.5 w-3.5" />,
    situacoes: [...SITUACOES_NOSSAS], aba: "titulos",
    rodape: "sem ação",
    ajuda: "O Hub tem o arquivo e a varredura de envio o leva ao Omie de 15 em 15 minutos; " +
      "o que já subiu espera só a releitura do ERP. Ninguém precisa fazer nada — e se uma " +
      "linha travar, ela aparece em \"Falta um passo\" com o motivo.",
  },
  {
    id: "anexo_suspeito", rotulo: SITUACAO.anexo_suspeito.rotulo, tom: "atencao",
    icone: <ShieldQuestion className="h-3.5 w-3.5" />,
    situacoes: ["anexo_suspeito"], aba: "revisar",
    rodape: "precisa de você",
    ajuda: SITUACAO.anexo_suspeito.ajuda,
  },
  {
    id: "nao_verificado", rotulo: SITUACAO.nao_verificado.rotulo, tom: "neutro",
    icone: <ShieldQuestion className="h-3.5 w-3.5" />,
    situacoes: ["nao_verificado"], aba: "titulos",
    ajuda: SITUACAO.nao_verificado.ajuda,
  },
  {
    id: "erro_leitura", rotulo: SITUACAO.erro_leitura.rotulo, tom: "atencao",
    icone: <AlertTriangle className="h-3.5 w-3.5" />,
    situacoes: ["erro_leitura"], aba: "titulos",
    ajuda: SITUACAO.erro_leitura.ajuda,
  },
];

/** As cores da barra empilhada — as mesmas em todos os lugares da tela. */
const BARRA: Record<string, string> = {
  com_nota: "bg-emerald-500",
  pronta: "bg-amber-500",
  sem_nota: "bg-red-500",
  nao_verificado: "bg-violet-400/70",
};

/**
 * A faixa em dinheiro de cada gravidade, escrita como a pessoa lê.
 *
 * Os cortes vêm do banco (`cap_notas_config`), não daqui: quem muda o limiar
 * muda numa linha do Postgres e a tela acompanha — inclusive esta legenda.
 */
function faixaDe(g: Gravidade, lim?: { medio: number; grave: number; urgente: number }): string {
  if (!lim) return "";
  const n = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  if (g === "urgente") return `acima de ${n(lim.urgente)}`;
  if (g === "grave") return `${n(lim.grave)} a ${n(lim.urgente)}`;
  if (g === "medio") return `${n(lim.medio)} a ${n(lim.grave)}`;
  return `abaixo de ${n(lim.medio)}`;
}

function BarraCobertura({ v, total }: {
  v: { com_nota: number; pronta: number; sem_nota: number; nao_verificado: number };
  total: number;
}) {
  const f = fatias({ ...v, total });
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      {(["com_nota", "pronta", "sem_nota", "nao_verificado"] as const).map((k) =>
        f[k] > 0 ? <div key={k} className={BARRA[k]} style={{ width: `${f[k]}%` }} /> : null,
      )}
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
      {([
        ["com_nota", "com nota no ERP"],
        ["pronta", "o Hub leva sozinho"],
        ["sem_nota", "sem nota"],
        ["nao_verificado", "não verificado"],
      ] as const).map(([k, t]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <i className={cn("inline-block h-2.5 w-2.5 rounded-sm", BARRA[k])} /> {t}
        </span>
      ))}
    </div>
  );
}

export default function NotasERP() {
  const [{ de, ate }, setPeriodo] = useState(() => periodoPadrao());
  const [resumo, setResumo] = useState<ResumoNotas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>("panorama");
  const [trabalhando, setTrabalhando] = useState<"varrer" | "subir" | null>(null);
  /* Qual faixa de gravidade a aba Títulos abre. Vem de um clique no painel — é
     o que transforma "R$ 1,21 mi urgentes" na LISTA daqueles 180 títulos. */
  const [gravidadeFoco, setGravidadeFoco] = useState<Gravidade[]>([]);
  /* E qual SITUAÇÃO ela abre.
   *
   * Faltava, e o buraco aparecia no clique mais óbvio da tela: o cartão "Pronta
   * para subir" trocava de aba sem trocar o filtro, então a lista abria no
   * recorte padrão e vinha cheia de "Sem nota" — o cartão dizia 16 títulos e a
   * tela mostrava centenas de outra coisa. Vazio = o recorte de abertura. */
  const [situacaoFoco, setSituacaoFoco] = useState<SituacaoTitulo[]>([]);

  /* ------------------------------- resumo ------------------------------- */
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.rpc("cap_notas_resumo", { p_de: de, p_ate: ate });
    if (error) toast.error(`Não deu para ler a cobertura: ${error.message}`);
    setResumo((data as ResumoNotas) ?? null);
    setCarregando(false);
  }, [de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  /* ------------------------- ações contra o Omie ------------------------ */

  /**
   * A varredura NÃO lê o Omie inteiro a cada clique — lê o lote que a fila do
   * Postgres apontar, e a fila já exclui quem tem anexo confirmado, quem foi
   * recusado por regra de negócio e quem foi lido há pouco. Fila vazia = zero
   * chamadas ao ERP, e é o caso normal depois que o acervo é varrido.
   */
  const varrer = async () => {
    setTrabalhando("varrer");
    try {
      const d = await invocar<{
        fila?: number; lidos?: number; com_anexo?: number; falhas?: number; restantes?: number | null;
      }>(sb.functions.invoke("omie-anexos-varredura", { body: { action: "varrer", limite: 150 } }));

      const { fila = 0, lidos = 0, com_anexo = 0, falhas = 0, restantes = null } = d ?? {};
      if (!fila) {
        toast.info("Nada a perguntar ao Omie: todo título que exige nota já foi verificado.");
      } else {
        toast.success(
          `${lidos} título(s) lidos no Omie · ${com_anexo} com anexo` +
          (falhas ? ` · ${falhas} não deram para ler` : "") +
          (restantes ? ` · restam ${restantes.toLocaleString("pt-BR")} para as próximas rodadas` : ""),
        );
      }
      await carregar();
    } catch (e: any) {
      toast.error(`A varredura falhou: ${e?.message ?? e}`);
    } finally { setTrabalhando(null); }
  };

  const subir = async () => {
    setTrabalhando("subir");
    try {
      const d = await invocar<{ enviados?: number; falhas?: number; fila?: number }>(
        sb.functions.invoke("omie-anexar-comprovante", { body: { action: "varredura", limite: 40 } }),
      );
      const { enviados = 0, falhas = 0, fila = 0 } = d ?? {};
      if (!fila) toast.info("Nada pronto para subir: toda nota que o Hub tem já está no ERP.");
      else toast.success(`${enviados} nota(s) anexadas no Omie` + (falhas ? ` · ${falhas} falharam` : ""));
      await carregar();
    } catch (e: any) {
      toast.error(`O envio falhou: ${e?.message ?? e}`);
    } finally { setTrabalhando(null); }
  };

  /* -------------------------------- derivados ---------------------------- */

  const m = resumo?.meta;
  const porSituacao = useMemo(() => {
    const mapa = new Map<SituacaoTitulo, { titulos: number; valor: number }>();
    for (const s of resumo?.situacoes ?? []) mapa.set(s.situacao, { titulos: s.titulos, valor: s.valor });
    return mapa;
  }, [resumo]);

  const val = (s: SituacaoTitulo) => porSituacao.get(s)?.valor ?? 0;
  const qtd = (s: SituacaoTitulo) => porSituacao.get(s)?.titulos ?? 0;

  const anos = useMemo(() => {
    const atual = new Date().getUTCFullYear();
    return [atual - 1, atual];
  }, []);

  if (carregando && !resumo) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo a cobertura de notas…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---------------------- barra de comando ---------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {anos.map((a) => (
            <button
              key={a}
              className={cn("chip", de.startsWith(String(a)) && ate.startsWith(String(a)) && "border-primary text-primary")}
              onClick={() => setPeriodo({ de: `${a}-01-01`, ate: `${a}-12-31` })}
            >
              {a}
            </button>
          ))}
          <button className="chip" onClick={() => setPeriodo(periodoPadrao())}>Últimos 6 meses</button>
          <span className="ml-1 flex items-center gap-1 text-[12px] text-muted-foreground">
            <Input
              type="date" value={de} onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))}
              className="h-7 w-[132px] text-[12px]"
            />
            até
            <Input
              type="date" value={ate} onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))}
              className="h-7 w-[132px] text-[12px]"
            />
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {m?.atualizado_em && (
            <span className="text-[11.5px] text-muted-foreground" title={m.atualizado_em}>
              ERP lido até {dataStr(m.atualizado_em)}
            </span>
          )}
          <button className="chip" onClick={varrer} disabled={!!trabalhando} title="Pergunta ao Omie, título a título, quais têm anexo. Só leitura — não escreve nada no ERP.">
            {trabalhando === "varrer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Varrer o ERP
          </button>
          <button className="chip" onClick={subir} disabled={!!trabalhando} title="Sobe ao Omie toda nota que o Hub já tem e o ERP ainda não.">
            {trabalhando === "subir" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Subir o que está pronto
          </button>
        </div>
      </div>

      {/* ------------------------- o número ------------------------- */}
      <div className="card-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Despesa que exige nota</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{brl(m?.exigivel_valor ?? 0)}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {(m?.exigivel_titulos ?? 0).toLocaleString("pt-BR")} títulos de{" "}
              {(m?.titulos ?? 0).toLocaleString("pt-BR")} no período
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Com nota confirmada no Omie</p>
            <p className={cn(
              "mt-1 text-3xl font-semibold tabular-nums",
              (m?.cobertura_valor ?? 0) >= 90 ? "text-emerald-600 dark:text-emerald-400"
                : (m?.cobertura_valor ?? 0) >= 60 ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400",
            )}>
              {pctStr(m?.cobertura_valor ?? null)}
            </p>
            <p className="text-[12.5px] text-muted-foreground">{brlStr(val("com_nota"))}</p>
          </div>
        </div>

        <div className="mt-4">
          <BarraCobertura
            v={{
              com_nota: val("com_nota"),
              // A fatia amarela é "nossa": o que vai subir e o que já subiu e
              // espera confirmação. Sem os dois, a barra não fecha os 100%.
              pronta: val("pronta_para_enviar") + val("enviado_aguardando"),
              sem_nota: val("sem_nota") + val("erro_leitura"), nao_verificado: val("nao_verificado"),
            }}
            total={m?.exigivel_valor ?? 0}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Legenda />
            <p className="text-[12.5px] text-muted-foreground">{frasePanorama(resumo)}</p>
          </div>
        </div>

        {/* POR ONDE COMEÇAR A COBRAR. Tudo exige nota; a gravidade só ordena —
            e o número diz por que ela importa: em agosto/26, 180 títulos
            urgentes concentravam R$ 1,21 mi dos R$ 1,30 mi que faltavam. */}
        <div className="mt-5">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            Por onde começar — nota que falta, por gravidade
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {GRAVIDADES.map((g) => {
              const f = resumo?.gravidade?.find((x) => x.gravidade === g);
              return (
                <button
                  key={g}
                  className={cn("rounded-md border p-3 text-left transition hover:brightness-105", TOM[GRAVIDADE[g].tom])}
                  onClick={() => { setGravidadeFoco([g]); setSituacaoFoco([]); setAba("titulos"); }}
                  title={faixaDe(g, m?.limiares)}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                    {g === "urgente" ? <Flame className="h-3.5 w-3.5" /> : <FileWarning className="h-3.5 w-3.5" />}
                    {GRAVIDADE[g].rotulo}
                  </span>
                  <span className="mt-1 block text-lg font-semibold tabular-nums">{brlStr(f?.valor ?? 0)}</span>
                  <span className="text-[11.5px] opacity-80">
                    {(f?.titulos ?? 0).toLocaleString("pt-BR")} títulos · {faixaDe(g, m?.limiares)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* O QUE É NOSSO — e, dentro disso, o que é de máquina e o que é de gente.
            O primeiro cartão junta os dois estados que andam sozinhos ("o Hub tem
            e vai subir" + "subiu, o ERP ainda não confirmou"): separá-los pedia
            atenção para a diferença entre dois trabalhos que ninguém faz. Os
            outros três são de gente, ou de ninguém. */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CARTOES.map((c) => (
            <button
              key={c.id}
              className={cn("rounded-md border p-3 text-left transition hover:brightness-105", TOM[c.tom])}
              onClick={() => { setGravidadeFoco([]); setSituacaoFoco([...c.situacoes]); setAba(c.aba); }}
              title={c.ajuda}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                {c.icone} {c.rotulo}
              </span>
              <span className="mt-1 block text-lg font-semibold tabular-nums">
                {brlStr(c.situacoes.reduce((s, x) => s + val(x), 0))}
              </span>
              <span className="text-[11.5px] opacity-80">
                {c.situacoes.reduce((s, x) => s + qtd(x), 0).toLocaleString("pt-BR")} títulos
                {c.rodape ? ` · ${c.rodape}` : ""}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------------------------- abas ---------------------------- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ABAS.map((a) => (
          <button
            key={a.id}
            className={cn("chip", aba === a.id && "border-primary text-primary")}
            /* Trocar de aba PELO NOME devolve o recorte de abertura: o foco só
               existe quando se chega por um cartão, e carregá-lo adiante faria a
               aba Títulos abrir filtrada por algo que ninguém pediu. */
            onClick={() => { if (a.id !== aba) { setGravidadeFoco([]); setSituacaoFoco([]); } setAba(a.id); }}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "panorama" && <Panorama resumo={resumo} />}
      {aba === "categorias" && <Categorias resumo={resumo} />}
      {aba === "fornecedores" && <Fornecedores resumo={resumo} />}
      {aba === "titulos" && (
        <Titulos de={de} ate={ate} gravidadeInicial={gravidadeFoco} situacaoInicial={situacaoFoco} />
      )}
      {aba === "acervo" && <Acervo aoMudar={carregar} />}
      {aba === "revisar" && <Revisar de={de} ate={ate} aoRevisar={carregar} />}
      {aba === "quase" && <QuaseLa />}
      {aba === "regua" && <Regua aoMudar={carregar} />}
    </div>
  );
}

/* ============================== Panorama ============================== */

function Panorama({ resumo }: { resumo: ResumoNotas | null }) {
  if (!resumo) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card-surface p-4">
        <h3 className="mb-3 text-sm font-semibold">Mês a mês</h3>
        {!resumo.meses.length && <p className="text-[13px] text-muted-foreground">Nada no período.</p>}
        <div className="space-y-2.5">
          {resumo.meses.map((mm) => (
            <div key={mm.mes} className="grid grid-cols-[52px_1fr_112px] items-center gap-3">
              <span className="text-[12px] tabular-nums text-muted-foreground">{mesCurto(mm.mes)}</span>
              <BarraCobertura
                v={{
                  com_nota: mm.valor_com_nota, pronta: 0,
                  sem_nota: mm.valor_sem_nota,
                  nao_verificado: Math.max(0, mm.valor - mm.valor_com_nota - mm.valor_sem_nota),
                }}
                total={mm.valor}
              />
              <span className="text-right text-[12px] tabular-nums text-muted-foreground" title={`${mm.titulos} títulos`}>
                {brlStr(mm.valor)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <h3 className="border-b border-border p-4 pb-3 text-sm font-semibold">Por conta de pagamento</h3>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 text-right font-medium">Títulos</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-4 py-2 text-right font-medium">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {resumo.contas.map((c) => (
              <tr key={c.conta} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2">
                  {c.conta}
                  {c.nao_verificado > 0 && (
                    <span className="ml-1.5 text-[11px] text-violet-600 dark:text-violet-400">
                      {c.nao_verificado} não verificado(s)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.titulos.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(c.valor)}</td>
                <td className={cn(
                  "px-4 py-2 text-right font-medium tabular-nums",
                  (c.cobertura ?? 0) >= 90 ? "text-emerald-600 dark:text-emerald-400"
                    : (c.cobertura ?? 0) >= 60 ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400",
                )}>
                  {pctStr(c.cobertura)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================= Categorias ============================= */

function Categorias({ resumo }: { resumo: ResumoNotas | null }) {
  const linhas = categoriasCriticas(resumo);
  return (
    <div className="card-surface overflow-x-auto p-0">
      <div className="border-b border-border p-4 pb-3">
        <h3 className="text-sm font-semibold">Onde a nota mais falta</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Ordenado por <b>valor faltante</b>, não por percentual: uma categoria de R$ 12 com 0% de
          cobertura lideraria a lista sem ser problema de ninguém.
        </p>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Categoria</th>
            <th className="px-3 py-2 text-right font-medium">Títulos</th>
            <th className="px-3 py-2 text-right font-medium">Falta</th>
            <th className="px-3 py-2 text-right font-medium">Sem nota</th>
            <th className="px-3 py-2 text-right font-medium">Pronta</th>
            <th className="px-3 py-2 text-right font-medium">Não verificado</th>
            <th className="px-4 py-2 text-right font-medium">Cobertura</th>
          </tr>
        </thead>
        <tbody>
          {!linhas.length && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
              Nenhuma categoria com nota faltando no período.
            </td></tr>
          )}
          {linhas.map((c) => (
            <tr key={c.codigo ?? c.categoria} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2">
                {c.categoria}
                {c.codigo && <span className="ml-1.5 text-[11px] text-muted-foreground">{c.codigo}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{c.titulos}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-red-600 dark:text-red-400">{brl(c.valor_faltante)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{c.sem_nota || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{c.pronta || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-violet-600 dark:text-violet-400">{c.nao_verificado || "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{pctStr(c.cobertura)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ Fornecedores ============================ */

function Fornecedores({ resumo }: { resumo: ResumoNotas | null }) {
  const linhas = resumo?.fornecedores ?? [];
  const cartaoTitulos = resumo?.meta?.cartao_titulos ?? 0;
  return (
    <div className="card-surface overflow-x-auto p-0">
      <div className="border-b border-border p-4 pb-3">
        <h3 className="text-sm font-semibold">Quem deve nota</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          A cobrança é por CNPJ, não por título: um fornecedor com oito títulos em aberto é um
          e-mail, não oito.
        </p>
        {cartaoTitulos > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[12.5px] text-amber-700 dark:text-amber-400">
            <CreditCard className="h-3.5 w-3.5" />
            Fora desta lista: <b>{cartaoTitulos.toLocaleString("pt-BR")} gastos de cartão</b>
            {" "}({brlStr(resumo?.meta?.cartao_valor ?? 0)}). A nota deles se cobra de quem gastou,
            na Auditoria do cartão — não de um CNPJ. Continuam contando na cobertura.
          </p>
        )}
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Favorecido</th>
            <th className="px-3 py-2 font-medium">CNPJ/CPF</th>
            <th className="px-3 py-2 text-right font-medium">Títulos</th>
            <th className="px-4 py-2 text-right font-medium">Valor sem nota</th>
          </tr>
        </thead>
        <tbody>
          {!linhas.length && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
              Ninguém devendo nota no período.
            </td></tr>
          )}
          {linhas.map((f, i) => (
            <tr key={`${f.doc}-${i}`} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2">{f.favorecido || "—"}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{formatarDoc(f.doc)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.titulos}</td>
              <td className="px-4 py-2 text-right font-medium tabular-nums">{brl(f.valor_faltante)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== Títulos ===============================
 *
 * TODA COLUNA CORTA. O filtro mora no cabeçalho da coluna que ele corta — a
 * alternativa era uma fileira de controles acima da tabela, e com sete filtros
 * ninguém lembra qual mexe em qual coluna. Ver o cabeçalho de FiltroCabecalho.tsx.
 *
 * Duas exceções ficam TAMBÉM na barra, e por um motivo só: elas nascem ligadas.
 * Situação abre marcando as três que faltam, e gravidade abre marcada quando se
 * chega aqui por um clique em "Urgente" lá em cima. Filtro ligado que só se vê
 * num funil de 10px em opacidade 30% é uma lista que mente — quem chega conta as
 * linhas e acha que o número encolheu sozinho.
 *
 * O CORTE É PELO CÓDIGO, o rótulo é o nome. `conta_codigo` e `categoria_codigo`
 * são estáveis; o nome da conta vem do cadastro do Omie e muda quando alguém a
 * renomeia lá.
 */

const PAGINA = 60;

/** Marca/desmarca um item de uma lista de filtro. */
const alternarNaLista = <T,>(lista: T[], v: T): T[] =>
  lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];

function Titulos({ de, ate, gravidadeInicial, situacaoInicial }: {
  de: string; ate: string; gravidadeInicial: Gravidade[]; situacaoInicial: SituacaoTitulo[];
}) {
  const [situacoes, setSituacoes] = useState<SituacaoTitulo[]>(
    situacaoInicial.length ? situacaoInicial : [...SITUACOES_FALTANDO],
  );
  const [aberto, setAberto] = useState<{ linha: LinhaTitulo; onde: Exclude<OndeAbrir, null> } | null>(null);
  const [gravidades, setGravidades] = useState<Gravidade[]>(gravidadeInicial);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [contas, setContas] = useState<string[]>([]);
  const [valorMin, setValorMin] = useState<number | null>(null);
  const [valorMax, setValorMax] = useState<number | null>(null);
  const [mesDe, setMesDe] = useState<string | null>(null);
  const [mesAte, setMesAte] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [linhas, setLinhas] = useState<LinhaTitulo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [facetas, setFacetas] = useState<FacetasNotas | null>(null);
  /* Releitura sob demanda. Depois de anexar, a linha PRECISA voltar do banco —
     a situação dela muda ("Sem nota" → "Pronta para enviar") e adivinhar isso no
     cliente é escrever a mesma regra duas vezes, em dois lugares que divergem. */
  const [releitura, setReleitura] = useState(0);
  const nomear = useNomeDaLinha();

  // O que a pessoa digitou fica no input; o que vai ao banco espera ela parar.
  const buscaFirme = useComAtraso(busca);
  /* A faixa vai memoizada para o atraso não se reiniciar a cada render — e
     digitar "1200" dispararia quatro consultas de 880 ms sem isto. */
  const faixa = useMemo(() => ({ min: valorMin, max: valorMax }), [valorMin, valorMax]);
  const faixaFirme = useComAtraso(faixa);

  // O clique no painel troca o foco com a aba já aberta — nas duas dimensões.
  useEffect(() => { setGravidades(gravidadeInicial); }, [gravidadeInicial]);
  useEffect(() => {
    setSituacoes(situacaoInicial.length ? situacaoInicial : [...SITUACOES_FALTANDO]);
  }, [situacaoInicial]);
  /* Mês é valor DO período: trocar o período deixaria um corte apontando para um
     mês que não existe mais, e a lista voltaria vazia sem motivo visível. */
  useEffect(() => { setMesDe(null); setMesAte(null); }, [de, ate]);

  /* As opções de cada coluna, do período inteiro. Uma consulta por período, não
     por filtro: elas não podem encolher conforme se filtra, senão o filtro se
     fecha sozinho. */
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await sb.rpc("cap_notas_facetas", { p_de: de, p_ate: ate });
      if (!vivo) return;
      if (error) { toast.error(`Não deu para ler as opções de filtro: ${error.message}`); return; }
      setFacetas(data as FacetasNotas);
    })();
    return () => { vivo = false; };
  }, [de, ate]);

  useEffect(() => { setPagina(0); }, [
    situacoes, gravidades, categorias, contas, faixaFirme, mesDe, mesAte, buscaFirme, de, ate,
  ]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      const { data, error } = await sb.rpc("cap_notas_titulos", {
        p_de: de, p_ate: ate,
        p_situacoes: situacoes.length ? situacoes : null,
        p_gravidades: gravidades.length ? gravidades : null,
        p_categorias: categorias.length ? categorias : null,
        p_contas: contas.length ? contas : null,
        p_valor_min: faixaFirme.min,
        p_valor_max: faixaFirme.max,
        p_mes_de: mesDe, p_mes_ate: mesAte,
        p_busca: buscaFirme.trim() || null,
        p_limite: PAGINA, p_offset: pagina * PAGINA,
      });
      if (!vivo) return;
      if (error) toast.error(`Não deu para listar: ${error.message}`);
      setLinhas((data as LinhaTitulo[]) ?? []);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [de, ate, situacoes, gravidades, categorias, contas, faixaFirme, mesDe, mesAte, buscaFirme, pagina, releitura]);

  const total = linhas[0]?.total_geral ?? 0;
  const paginas = Math.max(1, Math.ceil(total / PAGINA));

  const rotuloDe = (opcoes: FacetasNotas["categorias"] | undefined, v: string) =>
    opcoes?.find((o) => o.valor === v)?.rotulo ?? v;

  /* "Está tudo aí?" — a pergunta que a barra responde. Situação nasce cortada,
     então o padrão NÃO conta como filtro; o resto conta. */
  const situacaoNoPadrao =
    situacoes.length === SITUACOES_FALTANDO.length &&
    SITUACOES_FALTANDO.every((s) => situacoes.includes(s));
  const cortando =
    !situacaoNoPadrao || gravidades.length > 0 || categorias.length > 0 || contas.length > 0 ||
    valorMin !== null || valorMax !== null || !!mesDe || !!mesAte || busca.trim() !== "";

  const limparTudo = () => {
    setSituacoes([...SITUACOES_FALTANDO]);
    setGravidades([]); setCategorias([]); setContas([]);
    setValorMin(null); setValorMax(null);
    setMesDe(null); setMesAte(null); setBusca("");
  };

  /* Os dois miolos que aparecem em dois lugares (barra e `<th>`) — mesmo estado,
     escrito uma vez só. */
  const listaSituacao = (
    <ListaMarcavel
      opcoes={SITUACOES_EXIGIVEIS.map((s) => ({ valor: s, rotulo: SITUACAO[s].rotulo }))}
      marcadas={new Set<string>(situacoes)}
      onAlternar={(v) => setSituacoes((a) => alternarNaLista(a, v as SituacaoTitulo))}
    />
  );
  const listaGravidade = (
    <ListaMarcavel
      opcoes={GRAVIDADES.map((g) => ({ valor: g, rotulo: GRAVIDADE[g].rotulo }))}
      marcadas={new Set<string>(gravidades)}
      onAlternar={(v) => setGravidades((a) => alternarNaLista(a, v as Gravidade))}
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <BotaoFiltravel
          rotulo="Situação"
          resumo={resumoDoCorte(situacoes, (v) => SITUACAO[v as SituacaoTitulo].rotulo, "todas", "situações")}
          ativo={!situacaoNoPadrao}
          Icone={FileWarning}
          titulo="A tela abre pelas três que faltam. Marque outras para ver o que já está coberto."
          onLimpar={() => setSituacoes([...SITUACOES_FALTANDO])}
        >
          {listaSituacao}
        </BotaoFiltravel>

        <BotaoFiltravel
          rotulo="Gravidade"
          resumo={resumoDoCorte(gravidades, (v) => GRAVIDADE[v as Gravidade].rotulo, "todas", "faixas")}
          ativo={gravidades.length > 0}
          Icone={Flame}
          titulo="A faixa em dinheiro da nota que falta. Vem marcada quando se chega aqui por um clique no painel."
          onLimpar={() => setGravidades([])}
        >
          {listaGravidade}
        </BotaoFiltravel>

        {cortando && (
          <button className="chip" onClick={limparTudo} title="Volta a lista ao recorte de abertura.">
            <FilterX className="h-3.5 w-3.5" /> Limpar filtros
          </button>
        )}

        <span className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="fornecedor, CNPJ ou nº do título"
            className="h-8 w-[260px] pl-7 text-[12.5px]"
          />
        </span>
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">
                <CabecalhoFiltravel
                  rotulo="Favorecido" ativo={!!busca.trim()} largura="w-72"
                  titulo="Nome, apelido, CNPJ, nº do título — e o lojista escrito na observação"
                  onLimpar={() => setBusca("")}
                >
                  <div className="p-2.5">
                    <Input
                      value={busca} onChange={(e) => setBusca(e.target.value)}
                      placeholder="fornecedor, CNPJ ou nº do título"
                      className="h-7 text-[12px]"
                    />
                    <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
                      Varre o apelido, a razão social e a <strong className="font-medium">observação</strong> do
                      título — é lá que mora o lojista do gasto de cartão.
                    </p>
                  </div>
                </CabecalhoFiltravel>
              </th>

              <th className="px-3 py-2 font-medium">
                <CabecalhoFiltravel
                  rotulo="Categoria" ativo={categorias.length > 0} largura="w-80"
                  titulo="A rubrica do plano de contas do Omie"
                  onLimpar={() => setCategorias([])}
                >
                  <ListaMarcavel
                    opcoes={(facetas?.categorias ?? []).map((c) => ({
                      valor: c.valor, rotulo: c.rotulo, apoio: c.titulos,
                    }))}
                    marcadas={new Set(categorias)}
                    onAlternar={(v) => setCategorias((a) => alternarNaLista(a, v))}
                    buscar="categoria"
                    vazio="Nenhuma categoria com esse termo no período."
                  />
                </CabecalhoFiltravel>
              </th>

              <th className="px-3 py-2 font-medium">
                <CabecalhoFiltravel
                  rotulo="Conta" ativo={contas.length > 0} largura="w-72"
                  titulo="De qual conta o título foi pago"
                  onLimpar={() => setContas([])}
                >
                  <ListaMarcavel
                    opcoes={(facetas?.contas ?? []).map((c) => ({
                      valor: c.valor, rotulo: c.rotulo, apoio: c.titulos,
                    }))}
                    marcadas={new Set(contas)}
                    onAlternar={(v) => setContas((a) => alternarNaLista(a, v))}
                    vazio="Nenhuma conta com esse termo no período."
                  />
                </CabecalhoFiltravel>
              </th>

              <th className="px-3 py-2 text-right font-medium">
                <CabecalhoFiltravel
                  rotulo="Valor" ativo={valorMin !== null || valorMax !== null}
                  alinhar="end" largura="w-72"
                  titulo="O valor do título"
                  onLimpar={() => { setValorMin(null); setValorMax(null); }}
                >
                  <FaixaNumero
                    min={valorMin} max={valorMax}
                    onMin={setValorMin} onMax={setValorMax}
                    prefixo="R$"
                    dica={facetas
                      ? `No período, de ${brlStr(facetas.valor.min)} a ${brlStr(facetas.valor.max)}.`
                      : undefined}
                  />
                </CabecalhoFiltravel>
              </th>

              <th className="px-3 py-2 font-medium">
                <CabecalhoFiltravel
                  rotulo="Gravidade" ativo={gravidades.length > 0} largura="w-56"
                  titulo="A faixa em dinheiro — ordena a cobrança, não dispensa ninguém"
                  onLimpar={() => setGravidades([])}
                >
                  {listaGravidade}
                </CabecalhoFiltravel>
              </th>

              <th className="px-3 py-2 font-medium">
                <CabecalhoFiltravel
                  rotulo="Competência" ativo={!!mesDe || !!mesAte} largura="w-72"
                  titulo="Recorte de mês dentro do período do cabeçalho"
                  onLimpar={() => { setMesDe(null); setMesAte(null); }}
                >
                  <FaixaMeses
                    meses={facetas?.meses ?? []}
                    de={mesDe} ate={mesAte} onDe={setMesDe} onAte={setMesAte}
                    dica={
                      <>
                        Aperta o recorte <strong className="font-medium">dentro</strong> do período do
                        cabeçalho; para ir além dele, mude as datas lá em cima.
                      </>
                    }
                  />
                </CabecalhoFiltravel>
              </th>

              <th className="px-4 py-2 font-medium">
                <CabecalhoFiltravel
                  rotulo="Situação" ativo={!situacaoNoPadrao} alinhar="end" largura="w-64"
                  titulo="A tela abre pelas três que faltam"
                  onLimpar={() => setSituacoes([...SITUACOES_FALTANDO])}
                >
                  {listaSituacao}
                </CabecalhoFiltravel>
              </th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            )}
            {!carregando && !linhas.length && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                Nenhum título com estes filtros.
                {cortando && (
                  <button className="ml-2 underline underline-offset-2 hover:text-foreground" onClick={limparTudo}>
                    limpar os filtros
                  </button>
                )}
              </td></tr>
            )}
            {!carregando && linhas.map((l) => (
              <tr key={l.cod_titulo} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-2"><Favorecido l={l} nomear={nomear} /></td>
                <td className="px-3 py-2 text-[12.5px]">{l.categoria}</td>
                <td className="px-3 py-2 text-[12.5px] text-muted-foreground">{l.conta}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(l.valor)}</td>
                <td className="px-3 py-2">
                  <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px]", TOM[GRAVIDADE[l.gravidade].tom])}>
                    {GRAVIDADE[l.gravidade].rotulo}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataStr(l.competencia)}</td>
                <td className="px-4 py-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px]", TOM[SITUACAO[l.situacao].tom])}
                      title={l.erro_leitura ?? SITUACAO[l.situacao].ajuda}
                    >
                      {SITUACAO[l.situacao].rotulo}
                    </span>
                    {l.nota_no_hub && l.situacao !== "com_nota" && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                        <Paperclip className="h-3 w-3" /> {l.nota_no_hub}
                      </span>
                    )}
                    {l.nf_no_campo && (
                      <span className="text-[11px] text-muted-foreground">NF {l.nf_no_campo}</span>
                    )}
                    {/* O olho fica na coluna da situação porque é ela que ele
                        responde: "com nota" e "pronta para subir" viram uma
                        afirmação conferível, e não um rótulo em que se acredita. */}
                    <BotaoAbrir l={l} onAbrir={(onde) => setAberto({ linha: l, onde })} />
                    {/* E o clipe ao lado do olho, pela mesma razão: a coluna que
                        AFIRMA que falta nota é a que tem de oferecer o remédio. */}
                    <BotaoAnexar l={l} onPronto={() => setReleitura((n) => n + 1)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGINA && (
        <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
          <span>{total.toLocaleString("pt-BR")} títulos</span>
          <span className="flex items-center gap-1.5">
            <button className="ghost-icone" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            página {pagina + 1} de {paginas}
            <button className="ghost-icone" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}

      {aberto && (
        <VisorAnexo
          linha={aberto.linha} onde={aberto.onde} nomear={nomear}
          aoFechar={() => setAberto(null)}
        />
      )}
    </div>
  );
}

/* ========================== Anexo a conferir ========================== */

/**
 * O ERP tem arquivo — mas é a nota?
 *
 * A primeira heurística presumia culpa e mandou 89 de 356 anexos para cá. A
 * lista era quase toda legítima (chave de NF-e de 44 dígitos, "cesan jun.pdf",
 * "Alude_Cobrança-De-Aluguel…"), e fila cheia de falso positivo é fila que
 * ninguém abre duas vezes — aí o `nf_undefined_correta.pdf` de verdade se
 * esconde no meio dos 89. A regra virou a inversa: só chega aqui quem tem sinal
 * NEGATIVO no nome e nenhum positivo. Sobraram 18.
 */
function Revisar({ de, ate, aoRevisar }: { de: string; ate: string; aoRevisar: () => void }) {
  const [linhas, setLinhas] = useState<LinhaTitulo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<number | null>(null);
  /* Qual da fila está aberto no visor. Índice, e não `cod_titulo`, porque a fila
     ANDA: decidir tira a linha e o próximo assume o mesmo índice — é o que faz
     30 anexos serem 30 cliques, e não 30 idas ao Omie. */
  const [indice, setIndice] = useState<number | null>(null);
  const nomear = useNomeDaLinha();

  const ler = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.rpc("cap_notas_titulos", {
      p_de: de, p_ate: ate, p_situacoes: ["anexo_suspeito"], p_limite: 300,
    });
    if (error) toast.error(`Não deu para ler: ${error.message}`);
    setLinhas((data as LinhaTitulo[]) ?? []);
    setCarregando(false);
  }, [de, ate]);

  useEffect(() => { void ler(); }, [ler]);

  /* O QUE A IA JÁ LEU NESTES ARQUIVOS.
   *
   * Consulta à parte, e não uma coluna nova em `cap_notas_titulos`: aquela RPC
   * serve quatro abas e abre o `omie_cache` inteiro (880 ms). Esta é um `in`
   * sobre a chave primária de `omie_titulo_anexo`, custa nada e só carrega os
   * títulos que estão na tela.
   *
   * Só chega aqui quem a triagem NÃO decidiu — o que ela decidiu saiu da fila.
   * Então o que se lê abaixo é sempre "por que ela não quis decidir sozinha",
   * que é justamente o atalho de quem vai decidir. */
  const [leituraIa, setLeituraIa] = useState<Record<number, { veredito: string; motivo: string }>>({});
  useEffect(() => {
    if (!linhas.length) return;
    let vivo = true;
    (async () => {
      const { data } = await sb.from("omie_titulo_anexo")
        .select("cod_titulo, ia_veredito, ia_motivo")
        .in("cod_titulo", linhas.map((l) => l.cod_titulo))
        .not("ia_veredito", "is", null);
      if (!vivo) return;
      const mapa: Record<number, { veredito: string; motivo: string }> = {};
      for (const r of (data ?? []) as any[]) {
        mapa[Number(r.cod_titulo)] = { veredito: String(r.ia_veredito), motivo: String(r.ia_motivo ?? "") };
      }
      setLeituraIa(mapa);
    })();
    return () => { vivo = false; };
  }, [linhas]);

  /* Aquecer a fila ao abrir a aba.
   *
   * O cron já mantém o cache cheio, mas ele roda de 10 em 10 minutos e um anexo
   * que a varredura acabou de descobrir chega frio. Isto é disparo e esquece —
   * não bloqueia a tela, não mostra erro: se falhar, o clique volta a pagar o
   * Omie uma vez, que é exatamente como era antes. */
  useEffect(() => {
    void sb.functions.invoke("omie-anexo-abrir", { body: { action: "aquecer", limite: 8 } })
      .catch(() => {});
  }, []);

  const decidir = async (cod: number, veredito: "nota" | "nao_e_nota") => {
    setSalvando(cod);
    const { error } = await sb.rpc("cap_anexo_revisar", { p_cod_titulo: cod, p_veredito: veredito });
    setSalvando(null);
    if (error) { toast.error(`Não deu para salvar: ${error.message}`); return; }

    const restantes = linhas.filter((x) => x.cod_titulo !== cod);
    setLinhas(restantes);
    // O visor não fecha ao decidir: ele avança. Fecha só quando a fila acaba.
    setIndice((i) => (i === null ? null : restantes.length ? Math.min(i, restantes.length - 1) : null));
    toast.success(veredito === "nota"
      ? "Marcado como nota — o título passa a contar como coberto."
      : "Marcado como \"não é a nota\" — o título volta para a lista do que falta.");
    aoRevisar();
  };

  return (
    <div className="space-y-3">
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold">O ERP tem arquivo — mas é a nota?</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          Chegam aqui só os anexos cujo nome não identifica documento nenhum: o que o sistema
          nomeou sozinho (<code>nf_undefined_correta.pdf</code>, UUID, <code>.tmp</code>) e foto sem
          renomear. Nome de fornecedor comum — <i>“cesan jun.pdf”</i>, <i>“4407 - TAKEAT.pdf”</i> —
          e chave de NF-e de 44 dígitos <b>não</b> entram: presumir culpa lotaria a fila e
          esconderia o problema de verdade no meio dela.
        </p>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Enquanto não decidido, o título <b>não conta</b> como coberto.
        </p>
        {!!linhas.length && (
          <button className="chip mt-3" onClick={() => setIndice(0)}>
            <Eye className="h-3.5 w-3.5" /> Conferir os {linhas.length} em sequência
          </button>
        )}
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Favorecido</th>
              <th className="px-3 py-2 font-medium">Arquivo no Omie</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-4 py-2 font-medium">É a nota?</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            )}
            {!carregando && !linhas.length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                Nenhum anexo em dúvida no período.
              </td></tr>
            )}
            {!carregando && linhas.map((l, i) => (
              <tr key={l.cod_titulo} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-2"><Favorecido l={l} nomear={nomear} /></td>
                <td className="px-3 py-2">
                  {/* O nome do arquivo continua aqui, e ele até resolve alguns
                      casos. Mas é o botão ao lado que responde à pergunta da aba:
                      estes nomes são justamente os que não dizem nada. */}
                  <button
                    className="block text-left hover:underline"
                    onClick={() => setIndice(i)}
                    title="Abrir o arquivo do Omie aqui dentro"
                  >
                    {(l.anexos ?? []).map((a, k) => (
                      <span key={k} className="block break-all font-mono text-[11.5px]">{a.nome ?? "(sem nome)"}</span>
                    ))}
                    {!l.anexos?.length && <span className="text-muted-foreground">—</span>}
                  </button>
                  {/* O QUE A IA LEU. Quem chega aqui é o que ela NÃO quis decidir
                      sozinha — então esta linha é sempre o porquê, e é ela que
                      transforma "abrir e adivinhar" em "confirmar ou recusar". */}
                  {leituraIa[l.cod_titulo] && (
                    <span className="mt-1 block text-[11.5px] text-amber-700 dark:text-amber-400">
                      a IA leu: {leituraIa[l.cod_titulo].motivo}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(l.valor)}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataStr(l.competencia)}</td>
                <td className="px-4 py-2">
                  <span className="flex flex-wrap gap-1.5">
                    <button
                      className="chip" onClick={() => setIndice(i)}
                      title="Abre o arquivo aqui dentro, com os dois botões ao lado."
                    >
                      <Eye className="h-3.5 w-3.5" /> Abrir
                    </button>
                    <button
                      className={cn("chip", TOM.ok)} disabled={salvando === l.cod_titulo}
                      onClick={() => decidir(l.cod_titulo, "nota")}
                      title="Já sei que é a nota deste título."
                    >
                      <ThumbsUp className="h-3.5 w-3.5" /> É a nota
                    </button>
                    <button
                      className={cn("chip", TOM.falta)} disabled={salvando === l.cod_titulo}
                      onClick={() => decidir(l.cod_titulo, "nao_e_nota")}
                      title="Não é a nota — o título volta para a lista do que falta cobrar."
                    >
                      <ThumbsDown className="h-3.5 w-3.5" /> Não é
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {indice !== null && linhas[indice] && (
        <VisorAnexo
          linha={linhas[indice]}
          onde="erp"
          nomear={nomear}
          aoFechar={() => setIndice(null)}
          aoDecidir={(v) => decidir(linhas[indice].cod_titulo, v)}
          salvando={salvando === linhas[indice].cod_titulo}
          /* A fila é circular, então o "próximo" do último é o primeiro — e é
             ele que vale buscar, não `indice + 1` fora do array. */
          proximoCod={linhas[(indice + 1) % linhas.length]?.cod_titulo ?? null}
          fila={{
            indice, total: linhas.length,
            ir: (passo) => setIndice((i) => {
              const n = (i ?? 0) + passo;
              return n < 0 ? linhas.length - 1 : n >= linhas.length ? 0 : n;
            }),
          }}
        />
      )}
    </div>
  );
}

/* ============================== Falta um passo ============================== */

type QuaseLinha = {
  origem: string; ref_id: string; rotulo: string; competencia: string | null;
  valor: number; tem_comprovante: boolean; tem_titulo: boolean; falta: string;
};

function QuaseLa() {
  const [linhas, setLinhas] = useState<QuaseLinha[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await sb.rpc("auditoria_envio_quase_la", { p_limite: 400 });
      if (error) toast.error(`Não deu para ler: ${error.message}`);
      setLinhas((data as QuaseLinha[]) ?? []);
      setCarregando(false);
    })();
  }, []);

  const prontas = linhas.filter((l) => l.falta === "pronta para subir");
  const resto = linhas.filter((l) => l.falta !== "pronta para subir");

  return (
    <div className="space-y-3">
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold">Por que esta nota não subiu</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          A fila de envio exige três coisas ao mesmo tempo: a nota anexada, o título do Omie casado
          e nenhum carimbo de envio. Faltando uma, a linha some da fila <b>sem erro e sem aviso</b> —
          foi assim que os 79 achados de junho ficaram inteiros de fora por dois meses. Esta lista é
          o oposto disso: o que está a um passo, e qual é o passo.
        </p>
        {!!prontas.length && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[12.5px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {prontas.length} pronta(s) para subir — use “Subir o que está pronto” lá em cima.
          </p>
        )}
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Origem</th>
              <th className="px-3 py-2 font-medium">Lançamento</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-4 py-2 font-medium">O que falta</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            )}
            {!carregando && ![...prontas, ...resto].length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                Nada pendente: tudo que tinha nota já está no ERP.
              </td></tr>
            )}
            {[...prontas, ...resto].map((l) => (
              <tr key={`${l.origem}-${l.ref_id}`} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2 text-[12px] capitalize text-muted-foreground">{l.origem}</td>
                <td className="px-3 py-2">{l.rotulo}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(l.valor)}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataStr(l.competencia)}</td>
                <td className={cn(
                  "px-4 py-2 text-[12.5px]",
                  l.falta === "pronta para subir" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                )}>
                  {l.falta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================ Acervo ================================ */
/**
 * O LUGAR ONDE AS QUATRO PARTES SE ENCONTRAM.
 *
 * As abas de cima perguntam "cadê a nota?" olhando o ERP. Esta responde olhando
 * o OUTRO lado: os 3.789 arquivos que o Hub já tem guardados — as cinco planilhas
 * de formulário, as três pastas do Drive e a caixa do `financeiro@` — e a que
 * lançamento cada um pertence.
 *
 * Antes de 26/08/2026 esse acervo era medição pura. O casamento só mirava PIX e
 * cartão, então tudo o que a empresa paga por boleto ou transferência não tinha
 * contra o que casar; e `fila_erp` estava em `false` nas 4.183 linhas, porque a
 * única porta para a fila era um botão na aba PIX da Auditoria, mês a mês — e o
 * lado do cartão não tinha tela nenhuma.
 *
 * A LINHA QUE SEPARA MÁQUINA DE GENTE É A CONFIANÇA, e ela está escrita nos dois
 * primeiros recortes. `exata`/`alta` casaram por CNPJ — isso é identidade, e sobe
 * no cron das :30 sem perguntar. `media` casou por valor+data ou nome parecido:
 * numa fatura de 3.768 linhas, coincidência de valor é rotina, então essa espera
 * alguém olhar o lado de lá e dizer que sim.
 */

type LinhaAcervo = {
  id: number;
  fonte: string; linha: number | null; nome: string | null; o_que_e: string | null;
  detalhe: string | null; valor: number | null; enviado_em: string | null;
  competencia: string | null; link: string; tem_arquivo: boolean; parece_nota: boolean;
  tipo_documento: string | null; cnpj: string | null; chave_fiscal: string | null;
  diz_anexado: boolean; status_planilha: string | null;
  alvo_tipo: "pix" | "cartao" | "erp" | null;
  alvo_id_unico: string | null; alvo_manual: boolean;
  casamento: string | null; confianca: "exata" | "alta" | "media" | null;
  conferencia: string | null; candidatos: any;
  fila_erp: boolean; enviado_erp_em: string | null; erro_erp: string | null;
  alvo_nome: string | null; alvo_valor: number | null; alvo_data: string | null;
  alvo_categoria: string | null; alvo_situacao: string | null; alvo_cod_titulo: string | null;
  /** Caminho da cópia no bucket do projeto. NULL = só existe no Drive de quem subiu. */
  arquivo_bucket: string | null;
  total: number;
};

/* Os cinco primeiros são a PARTIÇÃO (somam `arquivos`); o resto é recorte de
   dentro dela ou dimensão à parte. Ver o comentário do RECORTES. */
type ResumoAcervo = {
  sem_alvo: number; ambiguas: number; falta_anexar: number;
  promessa_falsa: number; confere: number;
  so_no_drive: number; com_copia: number;
  tudo: number; arquivos: number; notas: number; sem_arquivo: number;
  falta_no_erp: number; sobe_sozinha: number;
  espera_gente: number; na_fila: number; no_erp: number; com_erro: number;
  por_alvo: Record<string, number>; por_fonte: Record<string, number>;
};

/* NÍVEL 1 — ONDE ESTÁ CADA ARQUIVO. É uma PARTIÇÃO: os cinco somam 3.794, que é
   o total de arquivos guardados. Nenhum documento aparece em dois.

   Antes eram oito cartões, e três deles eram cópias: "Hub tem, ERP não" (246)
   era exatamente "Sobe sozinha" (96) + "Espera você" (150); "Diz que anexou"
   (57) estava inteiro dentro dele; e "Na fila" (96) era o MESMO conjunto de
   "Sobe sozinha", linha por linha. Pior: "Sem alvo" contava só quem tem arquivo
   e "Empate" contava todo mundo — dois números lado a lado que não se
   comparavam. Quem olhava não sabia somar nada, e com razão. */
const RECORTES: Array<{ id: string; rotulo: string; chave: keyof ResumoAcervo; tom: string; ajuda: string }> = [
  { id: "sem_alvo", rotulo: "Sem alvo", chave: "sem_alvo", tom: "fora",
    ajuda: "Nenhum lançamento bate com este documento. Quase sempre é nota de um mês que a auditoria ainda não cobre, ou documento que não é despesa nossa. Não há o que fazer aqui até a janela abrir." },
  { id: "ambiguas", rotulo: "Empate", chave: "ambiguas", tom: "fora",
    ajuda: "Mais de um lançamento cabe, ou mais de uma linha disputa o mesmo lançamento. Empate não casa de propósito: chutar gruda a nota no lançamento errado, que é pior do que não ter nota." },
  { id: "falta_anexar", rotulo: "Falta anexar", chave: "falta_anexar", tom: "falta",
    ajuda: "Sabemos a que lançamento pertence e o título do Omie está sem anexo. É o trabalho de verdade desta aba — e o que o segundo nível, abaixo, detalha." },
  { id: "promessa_falsa", rotulo: "Diz que anexou", chave: "promessa_falsa", tom: "falta",
    ajuda: "A planilha registra \"Anexado!\" e o título do Omie está vazio. Promessa não é prova — por isso fica separado do \"Falta anexar\": aqui alguém já acha que resolveu." },
  { id: "confere", rotulo: "O ERP tem", chave: "confere", tom: "ok",
    ajuda: "O anexo está no título do Omie, conferido pelo próprio ERP. Fim da linha — venha de onde vier o arquivo." },
];

/* NÍVEL 2 — O CAMINHO ATÉ O ERP. Não compete com o nível 1: é um recorte de
   DENTRO de "Falta anexar" + "Diz que anexou", mostrando quem decide e onde a
   nota está no percurso. Por isso são chips e não cartões. */
const RECORTES_FILA: Array<{ id: string; rotulo: string; chave: keyof ResumoAcervo; ajuda: string }> = [
  { id: "falta_no_erp", rotulo: "Tudo que falta", chave: "falta_no_erp",
    ajuda: "A soma dos dois vermelhos acima. É o guarda-chuva dos dois próximos chips." },
  { id: "sobe_sozinha", rotulo: "Sobe sozinha", chave: "sobe_sozinha",
    ajuda: "Casou por CNPJ — isso é identidade, não coincidência — ou alguém escolheu o alvo à mão. O cron das :30 põe na fila sem perguntar." },
  { id: "espera_gente", rotulo: "Espera você", chave: "espera_gente",
    ajuda: "Casou por valor+data ou nome parecido. Numa fatura de milhares de linhas, coincidir valor é rotina: confira o lado de lá e confirme antes de mandar." },
  { id: "na_fila", rotulo: "Na fila", chave: "na_fila",
    ajuda: "Já marcada para subir; a varredura leva ao Omie de 15 em 15 minutos. Hoje é o mesmo conjunto de \"Sobe sozinha\" — só difere quando alguém enfileira à mão uma de confiança média." },
  { id: "no_erp", rotulo: "Mandadas pelo Hub", chave: "no_erp",
    ajuda: "Destas o Hub tem o carimbo de envio. Estão dentro de \"O ERP tem\", que conta também as que alguém anexou direto no Omie." },
];

/* OS RECORTES DE CONSULTA, que respondem a OUTRA pergunta.
   Os oito de cima olham para o que falta fazer. Estes dois olham para o que
   existe — é a aba virando biblioteca, para quando alguém pede "a nota da
   FRACALOSSI de junho". Ficam separados de propósito: misturar "o que devo
   fazer" com "o que eu tenho" é o jeito mais rápido de ninguém confiar em
   nenhum dos dois números. */
const RECORTES_CONSULTA: Array<{ id: string; rotulo: string; chave: keyof ResumoAcervo; ajuda: string }> = [
  { id: "biblioteca", rotulo: "Notas fiscais", chave: "notas",
    ajuda: "Só o que é nota fiscal e tem arquivo para abrir. É o que se entrega a quem pediu — boleto e recibo ficam de fora." },
  { id: "com_arquivo", rotulo: "Todo arquivo guardado", chave: "arquivos",
    ajuda: "Tudo que dá para abrir, boleto e recibo incluídos. É a soma exata dos cinco cartões acima." },
  { id: "sem_arquivo", rotulo: "Só registro, sem arquivo", chave: "sem_arquivo",
    ajuda: "O e-mail avisou que a nota existe (CNPJ, valor, às vezes a chave) mas não mandou o arquivo — o Bling é o caso típico, manda só um link. Existe a linha, não existe o documento." },
  { id: "tudo", rotulo: "Tudo que o Hub sabe", chave: "tudo",
    ajuda: "Os arquivos guardados mais os registros sem arquivo. É o acervo inteiro." },
  { id: "so_no_drive", rotulo: "Sem cópia da empresa", chave: "so_no_drive",
    ajuda: "O arquivo existe só no Drive de quem preencheu o formulário — um caso real da fila tem dono num Gmail pessoal, compartilhado com o financeiro@ desde 2024. Se a pessoa sair, mover ou apagar, a nota some e a empresa nunca a teve. A notas-arquivar copia para o bucket do projeto e esta fila encolhe." },
];

const EH_CONSULTA = (id: string) => RECORTES_CONSULTA.some((r) => r.id === id);

/** O balão do Hub, com o texto de cada recorte. */
function ComBalao({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[22rem] text-[12px] leading-relaxed">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

const ALVO_ROTULO: Record<string, string> = { pix: "PIX", cartao: "Cartão", erp: "Contas a pagar" };

const CONFIANCA_TOM: Record<string, string> = {
  exata: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  alta: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  media: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
};

function Acervo({ aoMudar }: { aoMudar: () => void }) {
  const [resumo, setResumo] = useState<ResumoAcervo | null>(null);
  const [linhas, setLinhas] = useState<LinhaAcervo[]>([]);
  const [recorte, setRecorte] = useState("falta_no_erp");
  const [alvo, setAlvo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  /* Período e faixa de valor. Só aparecem nos recortes de consulta: na fila de
     trabalho eles não ajudam (o que falta anexar, falta em qualquer mês) e
     cada campo a mais na tela é um a mais para ninguém usar. */
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [pag, setPag] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [trabalhando, setTrabalhando] = useState<"casar" | "enfileirar" | null>(null);
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const buscaLenta = useComAtraso(busca, 350);
  const POR_PAGINA = 60;

  const lerResumo = useCallback(async () => {
    const { data, error } = await sb.rpc("notas_externas_acervo_resumo");
    if (error) { toast.error(`Não deu para ler o acervo: ${error.message}`); return; }
    setResumo(data as ResumoAcervo);
  }, []);

  const consulta = EH_CONSULTA(recorte);

  const lerLista = useCallback(async () => {
    setCarregando(true);
    /* A ORDEM VEM DO RECORTE, e não de um seletor à parte. Quem está na fila
       quer a pior notícia primeiro; quem está procurando um documento quer o
       mais recente. São duas perguntas, não uma preferência. */
    const { data, error } = await sb.rpc("notas_externas_acervo", {
      p_situacao: recorte, p_alvo: alvo, p_fonte: null,
      p_busca: buscaLenta || null, p_limite: POR_PAGINA, p_offset: (pag - 1) * POR_PAGINA,
      p_de: consulta && de ? de : null,
      p_ate: consulta && ate ? ate : null,
      p_ordem: consulta ? "recente" : "trabalho",
      p_valor_min: consulta && valorMin !== "" ? Number(valorMin) : null,
      p_valor_max: consulta && valorMax !== "" ? Number(valorMax) : null,
    });
    if (error) toast.error(`Não deu para ler a lista: ${error.message}`);
    setLinhas((data as LinhaAcervo[]) ?? []);
    setCarregando(false);
  }, [recorte, alvo, buscaLenta, pag, consulta, de, ate, valorMin, valorMax]);

  useEffect(() => { void lerResumo(); }, [lerResumo]);
  useEffect(() => { void lerLista(); }, [lerLista]);
  useEffect(() => {
    setPag(1); setMarcadas(new Set());
  }, [recorte, alvo, buscaLenta, de, ate, valorMin, valorMax]);

  /* Recasar é caro (~3 s: abre o contas a pagar inteiro) e o cron já faz de hora
     em hora. O botão existe para quem acabou de subir planilha e não quer esperar. */
  const recasar = async () => {
    setTrabalhando("casar");
    try {
      const { data, error } = await sb.rpc("notas_externas_casar");
      if (error) throw error;
      const r = (data ?? {}) as any;
      toast.success(
        `Acervo recasado · ${r.em_erp ?? 0} no contas a pagar · ${r.em_pix ?? 0} no PIX · ${r.em_cartao ?? 0} no cartão`,
      );
      await Promise.all([lerResumo(), lerLista()]);
      aoMudar();
    } catch (e: any) {
      toast.error(`Não deu para recasar: ${e?.message ?? e}`);
    } finally { setTrabalhando(null); }
  };

  /* Mandar as marcadas. `notas_externas_enfileirar` é a MESMA porta do cron —
     ela é que sabe as travas (tem arquivo, tem alvo, o ERP ainda não tem), e
     duas portas para a mesma fila é como não ter trava nenhuma. */
  const mandar = async (ids: number[]) => {
    if (!ids.length) return;
    setTrabalhando("enfileirar");
    try {
      const { data: n, error } = await sb.rpc("notas_externas_enfileirar", { p_ids: ids });
      if (error) throw error;
      if (!n) { toast.message("Nada a enviar: o ERP já tem essas notas."); return; }
      toast.message(`${n} nota(s) na fila. Subindo ao Omie…`);
      // Lote pequeno: o teto do worker é de CPU (zip + base64 do arquivo).
      const d = await invocar<{ enviados?: number; falhas?: number }>(
        sb.functions.invoke("omie-anexar-comprovante", { body: { action: "varredura", limite: 6 } }),
      );
      const { enviados = 0, falhas = 0 } = d ?? {};
      toast.success(
        `${enviados} anexada(s) no Omie` + (falhas ? ` · ${falhas} falharam` : "") +
        (n > enviados ? ` · ${n - enviados} seguem na fila, o cron leva de 15 em 15 min` : ""),
      );
      setMarcadas(new Set());
      await Promise.all([lerResumo(), lerLista()]);
      aoMudar();
    } catch (e: any) {
      toast.error(`O envio falhou: ${e?.message ?? e}`);
    } finally { setTrabalhando(null); }
  };

  /* "Sim, é este." Carimba `alvo_manual` sem mexer no alvo nem na confiança — a
     origem do casamento continua legível depois. O carimbo já vale como
     identidade na fila automática, então confirmar é, na prática, soltar. */
  const confirmar = async (ids: number[]) => {
    if (!ids.length) return;
    setTrabalhando("enfileirar");
    try {
      const { data: n, error } = await sb.rpc("notas_externas_confirmar", { p_ids: ids });
      if (error) throw error;
      toast.success(
        `${n ?? 0} casamento(s) confirmado(s). O cron das :30 leva ao ERP — ou use "Mandar ao ERP" para não esperar.`,
      );
      setMarcadas(new Set());
      await Promise.all([lerResumo(), lerLista()]);
    } catch (e: any) {
      toast.error(`Não deu para confirmar: ${e?.message ?? e}`);
    } finally { setTrabalhando(null); }
  };

  const total = linhas[0]?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const marcaveis = linhas.filter((l) => l.tem_arquivo && !l.enviado_erp_em && l.alvo_tipo && !l.fila_erp);
  const ajudaDoRecorte = [...RECORTES, ...RECORTES_FILA, ...RECORTES_CONSULTA]
    .find((r) => r.id === recorte)?.ajuda ?? "";
  /* Confirmar só faz sentido no que ainda não foi olhado por gente. */
  const confirmaveis = linhas.filter((l) => l.alvo_tipo && !l.alvo_manual && !l.enviado_erp_em && marcadas.has(l.id));

  return (
    <div className="space-y-3">
      {/* ---------------------- o que o Hub tem na mão ---------------------- */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">O acervo de notas do Hub</h3>
            <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
              {resumo
                ? <>
                    <b>{resumo.arquivos.toLocaleString("pt-BR")}</b> arquivos guardados de nove origens —
                    as cinco planilhas, as três pastas do Drive e a caixa do <code>financeiro@</code>.
                    Esta aba diz a que lançamento cada um pertence e leva ao ERP o que falta lá dentro.
                  </>
                : "Lendo o acervo…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="chip" onClick={recasar} disabled={!!trabalhando} title="Refaz o casamento contra PIX, cartão e o contas a pagar inteiro. O cron já faz isso de hora em hora, aos :30.">
              {trabalhando === "casar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recasar agora
            </button>
            <button
              className="chip disabled:opacity-50"
              disabled={!!trabalhando || !confirmaveis.length}
              onClick={() => confirmar(confirmaveis.map((l) => l.id))}
              title="Carimba que uma pessoa olhou e concordou. O casamento confirmado passa a subir sozinho, como se fosse por CNPJ."
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              Confirmar {confirmaveis.length ? `${confirmaveis.length}` : ""}
            </button>
            <button
              className="chip border-primary text-primary disabled:opacity-50"
              disabled={!!trabalhando || !marcadas.size}
              onClick={() => mandar([...marcadas])}
              title="Põe as marcadas na fila e roda uma leva de envio."
            >
              {trabalhando === "enfileirar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Mandar {marcadas.size ? `${marcadas.size} ao ERP` : "ao ERP"}
            </button>
          </div>
        </div>

        {/* ---- nível 1: onde está cada arquivo (soma o total guardado) ---- */}
        <p className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Onde está cada arquivo
          {resumo && <span className="ml-1.5 normal-case opacity-70">
            — os cinco somam {resumo.arquivos.toLocaleString("pt-BR")}, nenhum aparece em dois
          </span>}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {RECORTES.map((r) => (
            <ComBalao key={r.id} texto={r.ajuda}>
              <button
                className={cn(
                  "rounded-md border p-3 text-left transition hover:brightness-105",
                  TOM[r.tom], recorte === r.id && "ring-1 ring-primary",
                )}
                onClick={() => setRecorte(r.id)}
              >
                <span className="block text-[11px] font-medium uppercase tracking-wide">{r.rotulo}</span>
                <span className="mt-1 block text-lg font-semibold tabular-nums">
                  {(resumo?.[r.chave] as number ?? 0).toLocaleString("pt-BR")}
                </span>
              </button>
            </ComBalao>
          ))}
        </div>

        {/* ---- nível 2: o caminho até o ERP (recorte de dentro do vermelho) ---- */}
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            O caminho até o ERP
            <span className="ml-1.5 normal-case opacity-70">— quem decide, e onde a nota está no percurso</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {RECORTES_FILA.map((r) => (
              <ComBalao key={r.id} texto={r.ajuda}>
                <button
                  className={cn("chip", recorte === r.id && "border-primary text-primary")}
                  onClick={() => setRecorte(r.id)}
                >
                  {r.rotulo}
                  <span className="ml-1 opacity-60 tabular-nums">
                    {(resumo?.[r.chave] as number ?? 0).toLocaleString("pt-BR")}
                  </span>
                </button>
              </ComBalao>
            ))}
          </div>
        </div>

        {/* ---- nível 3: procurar, que é outra pergunta ---- */}
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Procurar um documento
            <span className="ml-1.5 normal-case opacity-70">— busca por fornecedor, CNPJ, período e valor</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {RECORTES_CONSULTA.map((r) => (
              <ComBalao key={r.id} texto={r.ajuda}>
                <button
                  className={cn("chip", recorte === r.id && "border-primary text-primary")}
                  onClick={() => setRecorte(r.id)}
                >
                  {r.rotulo}
                  <span className="ml-1 opacity-60 tabular-nums">
                    {(resumo?.[r.chave] as number ?? 0).toLocaleString("pt-BR")}
                  </span>
                </button>
              </ComBalao>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------ filtros ------------------------------ */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={cn("chip", !alvo && "border-primary text-primary")} onClick={() => setAlvo(null)}>
          Todos os lados
        </button>
        {(["erp", "pix", "cartao"] as const).map((t) => (
          <button key={t} className={cn("chip", alvo === t && "border-primary text-primary")} onClick={() => setAlvo(t)}>
            {ALVO_ROTULO[t]}
            {resumo?.por_alvo?.[t] ? <span className="ml-1 opacity-60">{resumo.por_alvo[t]}</span> : null}
          </button>
        ))}
        <label className="ml-auto inline-flex h-9 min-w-[260px] flex-1 max-w-[380px] items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            className="w-full bg-transparent text-[13px] outline-none"
            placeholder="fornecedor, CNPJ, chave de acesso, código do título…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            title="Aceita nome do fornecedor, o que é, detalhe e código do título. Com 6 dígitos ou mais, procura também no CNPJ e na chave de acesso — com ou sem pontuação."
          />
          {!!busca && <button onClick={() => setBusca("")} title="limpar"><FilterX className="h-3.5 w-3.5 text-muted-foreground" /></button>}
        </label>
      </div>

      {/* Período e valor: só na consulta — ver o comentário do estado. */}
      {consulta && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="text-muted-foreground">De</span>
          <input type="date" className="h-8 rounded-lg border border-border bg-card px-2 outline-none"
                 value={de} onChange={(e) => setDe(e.target.value)} />
          <span className="text-muted-foreground">até</span>
          <input type="date" className="h-8 rounded-lg border border-border bg-card px-2 outline-none"
                 value={ate} onChange={(e) => setAte(e.target.value)} />
          <span className="ml-2 text-muted-foreground">Valor de</span>
          <input type="number" inputMode="decimal" placeholder="—"
                 className="h-8 w-24 rounded-lg border border-border bg-card px-2 tabular-nums outline-none"
                 value={valorMin} onChange={(e) => setValorMin(e.target.value)} />
          <span className="text-muted-foreground">a</span>
          <input type="number" inputMode="decimal" placeholder="—"
                 className="h-8 w-24 rounded-lg border border-border bg-card px-2 tabular-nums outline-none"
                 value={valorMax} onChange={(e) => setValorMax(e.target.value)} />
          {(de || ate || valorMin || valorMax) && (
            <button className="chip" onClick={() => { setDe(""); setAte(""); setValorMin(""); setValorMax(""); }}>
              <FilterX className="h-3.5 w-3.5" /> Limpar
            </button>
          )}
          {(valorMin || valorMax) && (
            /* Honestidade sobre o recorte: filtrar por faixa exclui o que não tem
               valor lido, e sem dizer isso a lista parece menor do que o acervo é. */
            <span className="text-muted-foreground">· nota sem valor lido fica de fora</span>
          )}
        </div>
      )}

      {!!ajudaDoRecorte && (
        <p className="text-[12.5px] text-muted-foreground">{ajudaDoRecorte}</p>
      )}

      {/* ------------------------------- lista ------------------------------- */}
      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">
                {!!marcaveis.length && (
                  <input
                    type="checkbox"
                    checked={marcaveis.length > 0 && marcaveis.every((l) => marcadas.has(l.id))}
                    onChange={(e) => setMarcadas(e.target.checked ? new Set(marcaveis.map((l) => l.id)) : new Set())}
                    title="marcar os desta página que podem subir"
                  />
                )}
              </th>
              <th className="px-3 py-2 font-medium">A nota</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Casou com</th>
              <th className="px-3 py-2 font-medium">Como</th>
              <th className="px-3 py-2 font-medium">No ERP</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            )}
            {!carregando && !linhas.length && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                Nada neste recorte.
              </td></tr>
            )}
            {!carregando && linhas.map((l) => (
              <LinhaDoAcervo
                key={l.id} l={l}
                marcada={marcadas.has(l.id)}
                aoMarcar={(v) => setMarcadas((s) => {
                  const n = new Set(s); if (v) n.add(l.id); else n.delete(l.id); return n;
                })}
                aoMandar={() => mandar([l.id])}
                ocupado={!!trabalhando}
              />
            ))}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
          <span>{total.toLocaleString("pt-BR")} nota(s) · página {pag} de {paginas}</span>
          <span className="flex items-center gap-1">
            <button className="chip" disabled={pag <= 1} onClick={() => setPag((p) => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button className="chip" disabled={pag >= paginas} onClick={() => setPag((p) => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function LinhaDoAcervo({
  l, marcada, aoMarcar, aoMandar, ocupado,
}: {
  l: LinhaAcervo; marcada: boolean; aoMarcar: (v: boolean) => void;
  aoMandar: () => void; ocupado: boolean;
}) {
  const podeSubir = l.tem_arquivo && !l.enviado_erp_em && !!l.alvo_tipo && !l.fila_erp;
  /* O valor do lançamento só aparece quando DISCORDA do da nota. Repetir o mesmo
     número duas vezes na mesma linha é ruído; a diferença é a informação — nota
     cheia contra parcela, retenção, desconto. */
  const valorDiverge = l.valor != null && l.alvo_valor != null
    && Math.abs(Number(l.valor) - Number(l.alvo_valor)) > 0.02;

  return (
    <tr className="border-b border-border/60 last:border-0 align-top">
      <td className="px-3 py-2">
        {podeSubir && (
          <input type="checkbox" checked={marcada} onChange={(e) => aoMarcar(e.target.checked)} />
        )}
      </td>

      <td className="px-3 py-2">
        <span className="block font-medium">{l.nome || l.o_que_e || "(sem nome)"}</span>
        <span className="block text-[11.5px] text-muted-foreground">
          {l.fonte}{l.linha ? ` · linha ${l.linha}` : ""}
          {l.enviado_em ? ` · ${dataStr(l.enviado_em)}` : ""}
          {l.tipo_documento && l.tipo_documento !== "nota" ? ` · ${l.tipo_documento}` : ""}
          {!l.tem_arquivo && " · só link, sem arquivo"}
        </span>
        {/* O CNPJ na linha é o que prova que duas grafias são a mesma empresa:
            27.250.919/0001-90 aparece como "FRACALOSSI MATERIAL ELETRICO LTDA"
            em 11 documentos e como "FRAVEN" em 7. Quem procurou pelo CNPJ
            precisa ver, na linha, por que aquele nome estranho veio junto. */}
        {!!l.cnpj && (
          <span className="block text-[11px] tabular-nums text-muted-foreground/80" title="CNPJ lido no documento">
            {cnpjBonito(l.cnpj)}
            {l.chave_fiscal ? " · tem chave de acesso" : ""}
          </span>
        )}
      </td>

      <td className="px-3 py-2 text-right tabular-nums">{l.valor != null ? brl(Number(l.valor)) : "—"}</td>

      <td className="px-3 py-2">
        {l.alvo_tipo ? (
          <>
            <span className="block">{l.alvo_nome || "(lançamento sem nome)"}</span>
            <span className="block text-[11.5px] text-muted-foreground">
              {ALVO_ROTULO[l.alvo_tipo]}
              {l.alvo_cod_titulo ? ` · título ${l.alvo_cod_titulo}` : ""}
              {l.alvo_data ? ` · ${dataStr(l.alvo_data)}` : ""}
              {valorDiverge ? <> · lançamento {brlStr(Number(l.alvo_valor))}</> : ""}
            </span>
          </>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">
            {l.candidatos?.motivo === "varios_alvos"
              ? `${l.candidatos.quantos} lançamentos cabem — empate não casa`
              : l.candidatos?.motivo === "alvo_disputado"
                ? `${l.candidatos.linhas_disputando} linhas disputam o mesmo lançamento`
                : "nenhum lançamento bate"}
          </span>
        )}
      </td>

      <td className="px-3 py-2">
        {l.confianca && (
          <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px]", CONFIANCA_TOM[l.confianca])}
                title={l.casamento === "cnpj_valor" ? "CNPJ do documento + valor ao centavo. É identidade."
                     : l.casamento === "cnpj_data" ? "Mesmo CNPJ dentro da janela de datas."
                     : l.casamento === "valor_data" ? "Valor e data próximos — pode ser coincidência."
                     : "Nome parecido + valor."}>
            {l.confianca}
          </span>
        )}
        {l.alvo_manual && <span className="ml-1 text-[11px] text-muted-foreground">à mão</span>}
      </td>

      <td className="px-3 py-2 text-[12.5px]">
        {l.enviado_erp_em ? (
          <span className="text-emerald-600 dark:text-emerald-400">anexada · {dataStr(l.enviado_erp_em)}</span>
        ) : l.fila_erp ? (
          <span className="text-amber-700 dark:text-amber-400">na fila</span>
        ) : l.conferencia === "promessa_falsa" ? (
          <span className="text-red-600 dark:text-red-400" title={`A planilha registra "${l.status_planilha ?? "anexado"}" e o título não tem anexo.`}>
            diz que anexou
          </span>
        ) : l.conferencia === "confere" ? (
          <span className="text-emerald-600 dark:text-emerald-400">o ERP tem</span>
        ) : l.conferencia === "falta_anexar" ? (
          <span className="text-muted-foreground">falta anexar</span>
        ) : <span className="text-muted-foreground">—</span>}
        {l.erro_erp && <span className="block text-[11px] text-red-600 dark:text-red-400">{l.erro_erp}</span>}
      </td>

      <td className="px-3 py-2 text-right">
        <span className="inline-flex items-center gap-1">
          {/* A CÓPIA DA EMPRESA VEM PRIMEIRO, quando existe: é a que não depende
              da conta de ninguém. O link da origem continua ao lado, porque é
              por ele que quem subiu reencontra o arquivo. */}
          {!!l.arquivo_bucket && (
            <ComBalao texto="Abrir a cópia guardada pelo Hub. Esta não depende do Drive de ninguém.">
              <button className="ghost-icone" onClick={() => void abrirCopia(l.arquivo_bucket!)}>
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              </button>
            </ComBalao>
          )}
          {!l.arquivo_bucket && l.tem_arquivo && (
            <ComBalao texto="Sem cópia da empresa: este arquivo só existe no Drive de quem o subiu. Se a conta sumir, a nota some junto.">
              <span className="ghost-icone cursor-default">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              </span>
            </ComBalao>
          )}
          {!!l.link && (
            <a className="ghost-icone" href={l.link.startsWith("http") ? l.link : undefined}
               target="_blank" rel="noreferrer" title="abrir o documento na origem">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {podeSubir && (
            <button className="ghost-icone" onClick={aoMandar} disabled={ocupado} title="mandar esta ao Omie agora">
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

/* ================================= Régua ================================= */

type LinhaRegua = {
  codigo: string; descricao: string | null; regra: Regra;
  motivo: string | null; origem: string;
};

function Regua({ aoMudar }: { aoMudar: () => void }) {
  const [linhas, setLinhas] = useState<LinhaRegua[]>([]);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  const ler = useCallback(async () => {
    const { data, error } = await sb.from("omie_categoria_regra")
      .select("codigo, descricao, regra, motivo, origem").order("codigo");
    if (error) toast.error(`Não deu para ler a régua: ${error.message}`);
    setLinhas((data as LinhaRegua[]) ?? []);
  }, []);

  useEffect(() => { void ler(); }, [ler]);

  const trocar = async (codigo: string, regra: Regra) => {
    setSalvando(codigo);
    const { error } = await sb.from("omie_categoria_regra")
      .update({ regra, origem: "humano", atualizado_em: new Date().toISOString() })
      .eq("codigo", codigo);
    setSalvando(null);
    if (error) { toast.error(`Não deu para salvar: ${error.message}`); return; }
    setLinhas((l) => l.map((x) => (x.codigo === codigo ? { ...x, regra, origem: "humano" } : x)));
    toast.success("Régua atualizada — a cobertura já reflete isso.");
    aoMudar();
  };

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return linhas;
    return linhas.filter((l) =>
      l.codigo.toLowerCase().includes(q) || (l.descricao ?? "").toLowerCase().includes(q));
  }, [linhas, busca]);

  return (
    <div className="space-y-3">
      <div className="card-surface p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Scale className="h-4 w-4" /> O que exige nota</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          É o <b>denominador</b> de toda a medição. A classificação inicial saiu do nome da categoria;
          onde ela erra, a decisão de quem está aqui vence e passa a valer para sempre — a semente
          nunca sobrescreve o que uma pessoa marcou.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
          {(Object.keys(REGRA) as Regra[]).map((r) => (
            <span key={r}>
              <b className="text-foreground">{REGRA[r].rotulo}:</b> {REGRA[r].ajuda}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="categoria ou código" className="h-8 w-[280px] pl-7 text-[12.5px]" />
        </span>
        <span className="text-[12px] text-muted-foreground">{filtradas.length} categorias</span>
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Regra</th>
              <th className="px-4 py-2 font-medium">Por quê</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr key={l.codigo} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2">
                  <span className="block">{l.descricao ?? "(sem cadastro)"}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">{l.codigo}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex gap-1">
                    {(Object.keys(REGRA) as Regra[]).map((r) => (
                      <button
                        key={r}
                        disabled={salvando === l.codigo}
                        onClick={() => trocar(l.codigo, r)}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[11px] transition",
                          l.regra === r
                            ? r === "exige" ? TOM.falta : r === "dispensa" ? TOM.fora : TOM.atencao
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                        title={REGRA[r].ajuda}
                      >
                        {REGRA[r].rotulo}
                      </button>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-2 text-[12px] text-muted-foreground">
                  {l.motivo ?? "—"}
                  {l.origem === "humano" && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-foreground">
                      <ArrowUpRight className="h-3 w-3" /> decidido aqui
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
