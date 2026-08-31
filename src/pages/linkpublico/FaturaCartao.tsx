/**
 * A fatura do cartão do líder, dentro do /l/<token>.
 *
 * A aba de pendências mostra só o que o financeiro cobrou. Isso deixava o líder vendo
 * uma fresta: a Thais tinha 26 itens no link contra 87 no cartão dela, e em ago/26
 * nenhum lançamento virou achado — a aba de pendências abria vazia. Aqui ele vê a fatura
 * inteira, com e sem comprovante, e pode agir em qualquer linha.
 *
 * O portão dos 4 dígitos: o token já diz QUEM é: os dígitos provam que o cartão está na
 * mão de quem abriu, então um link encaminhado no WhatsApp não basta sozinho. Eles não
 * são segredo (a mensagem de cobrança já cita "cartão final 3618"), e por isso ficam
 * guardados no aparelho depois do primeiro acerto — pedir de novo a cada visita seria
 * atrito sem ganho. Quem segura ataque é o freio no banco: 5 erros, 15 minutos dormindo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Paperclip, Loader2, Check, Send, X, CreditCard,
  AlertTriangle, Flag, Minus, MessageSquare, Search, ArrowUpDown, StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/pages/auditoria/utils";

const SUPABASE_URL = "https://lgcxyxyidoirqmbdlldh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U";

const chaveGuardada = (token: string) => `fatura-digitos:${token}`;

export type ItemFatura = {
  id_unico: string;
  data: string;
  /** AAAA-MM-DD — a `data` é DD/MM/AAAA e ordena errado como texto. */
  ordem_data: string | null;
  estabelecimento: string;
  categoria: string | null;
  parcela: string | null;
  valor: number;
  /** Anotação do FINANCEIRO — contexto, só leitura. Nunca vai para a caixa de texto. */
  nota_interna: string | null;
  situacao: "ok" | "dispensado" | "pendente";
  motivo: string | null;
  tem_comprovante: boolean;
  justificativa: string | null;
  achado_status: string | null;
  contestacao: string | null;
  contestacao_texto: string | null;
};

type Mes = { competencia: string; label: string; total: number; itens: ItemFatura[] };

type FaturaOk = {
  responsavel: string;
  card_final: string;
  /** Cartão encerrado que ainda está no prazo de graça. */
  encerrando?: boolean;
  acesso_ate?: string | null;
  resumo: { lancamentos: number; total: number; pendentes: number; com_comprovante: number };
  meses: Mes[];
  erro?: undefined;
  precisa_digitos?: undefined;
};

type Ordem = "data" | "maior" | "menor" | "nome";

const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "data", rotulo: "Mais recentes" },
  { valor: "maior", rotulo: "Maior valor" },
  { valor: "menor", rotulo: "Menor valor" },
  { valor: "nome", rotulo: "Nome (A–Z)" },
];

function ordenar(itens: ItemFatura[], ordem: Ordem): ItemFatura[] {
  const copia = [...itens];
  switch (ordem) {
    case "maior": return copia.sort((a, b) => Math.abs(Number(b.valor)) - Math.abs(Number(a.valor)));
    case "menor": return copia.sort((a, b) => Math.abs(Number(a.valor)) - Math.abs(Number(b.valor)));
    // localeCompare com pt-BR para "Ágil" não cair depois de "Zebra".
    case "nome":  return copia.sort((a, b) => a.estabelecimento.localeCompare(b.estabelecimento, "pt-BR"));
    default:      return copia.sort((a, b) =>
      (b.ordem_data || "").localeCompare(a.ordem_data || "") ||
      Math.abs(Number(b.valor)) - Math.abs(Number(a.valor)));
  }
}
type FaturaGate = { precisa_digitos: true; responsavel?: string; erro?: string; restam?: number; bloqueado?: boolean };
type FaturaErr = { erro: string; bloqueado?: boolean; precisa_digitos?: boolean; restam?: number };
type Fatura = FaturaOk | FaturaGate | FaturaErr;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-08-01" → "Agosto de 2026". O RPC devolve MM/YYYY; aqui vira nome. */
function nomeDoMes(competencia: string) {
  const [ano, mes] = competencia.split("-");
  const nome = MESES[Number(mes) - 1] || competencia;
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${ano}`;
}

/* ================================================================== *
 *  Portão dos 4 dígitos
 * ================================================================== */

function Portao({
  responsavel, erro, restam, bloqueado, verificando, onEnviar,
}: {
  responsavel?: string;
  erro?: string;
  restam?: number;
  bloqueado?: boolean;
  verificando: boolean;
  onEnviar: (digitos: string) => void;
}) {
  const [valor, setValor] = useState("");
  const pronto = valor.length === 4 && !verificando && !bloqueado;

  return (
    <div className="mx-auto mt-10 max-w-[380px]">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border">
        <CreditCard className="h-5 w-5 text-muted-foreground" />
      </div>
      <h2 className="mt-5 text-[22px] font-semibold leading-tight tracking-tight">
        Confirme que o cartão é seu
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        {responsavel ? <>Digite os <strong className="font-medium text-foreground">4 últimos
          dígitos</strong> do seu cartão corporativo. Pedimos uma vez só neste aparelho.</>
          : <>Digite os 4 últimos dígitos do seu cartão corporativo.</>}
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => { e.preventDefault(); if (pronto) onEnviar(valor); }}
      >
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={valor}
          disabled={verificando || bloqueado}
          onChange={(e) => setValor(e.target.value.replace(/\D/g, "").slice(0, 4))}
          aria-label="4 últimos dígitos do cartão"
          className="num w-full rounded-lg border border-border bg-card py-4 text-center text-[30px] font-semibold tracking-[0.5em] outline-none transition-colors focus:border-foreground/40 disabled:opacity-60"
          placeholder="••••"
        />

        {erro && (
          <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {erro}
              {!bloqueado && typeof restam === "number" && restam > 0 && (
                <span className="text-muted-foreground"> Restam {restam} tentativa{restam === 1 ? "" : "s"}.</span>
              )}
            </span>
          </p>
        )}

        <Button type="submit" className="mt-5 h-10 w-full" disabled={!pronto}>
          {verificando
            ? (<><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Conferindo</>)
            : "Ver minha fatura"}
        </Button>
      </form>

      <p className="mt-5 text-[12px] leading-relaxed text-muted-foreground">
        Não lembra o número? Ele está impresso no cartão e também na mensagem que o
        financeiro te mandou.
      </p>
    </div>
  );
}

/* ================================================================== *
 *  A fatura
 * ================================================================== */

export default function FaturaCartao({
  token, versao = 0, onMudou,
}: {
  token: string;
  /** Sobe quando a OUTRA aba grava alguma coisa; faz esta recarregar. */
  versao?: number;
  /** Avisa a página inteira que algo mudou, para as duas abas se acertarem. */
  onMudou?: () => void | Promise<void>;
}) {
  const [digitos, setDigitos] = useState<string>(() => {
    try { return localStorage.getItem(chaveGuardada(token)) || ""; } catch { return ""; }
  });
  const [dados, setDados] = useState<Fatura | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [verificando, setVerificando] = useState(false);

  const carregar = useCallback(async (d: string, guardar = false) => {
    const { data, error } = await supabase.rpc("resolver_fatura_via_token", {
      p_token: token, p_digitos: d, p_ip: null,
    });
    if (error) {
      setDados({ erro: "Não conseguimos abrir sua fatura agora. Tente de novo em instantes." });
      return false;
    }
    const payload = data as unknown as Fatura;
    setDados(payload);
    const ok = !("erro" in payload && payload.erro) && !("precisa_digitos" in payload && payload.precisa_digitos);
    if (ok && guardar) {
      try { localStorage.setItem(chaveGuardada(token), d); } catch { /* modo privado */ }
    }
    // Dígito guardado que parou de valer (o cartão do líder mudou) não pode ficar
    // preso no aparelho recusando para sempre.
    if (!ok && guardar === false && d) {
      try { localStorage.removeItem(chaveGuardada(token)); } catch { /* ok */ }
      setDigitos("");
    }
    return ok;
  }, [token]);

  useEffect(() => {
    (async () => { await carregar(digitos); setCarregando(false); })();
    // Só na montagem: as recargas seguintes passam por `versao` ou pelo portão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anexar na aba de PENDÊNCIAS tem de aparecer aqui na hora. A página bump a `versao`
  // depois de qualquer escrita e esta aba relê — sem isso o líder anexava de um lado e
  // continuava vendo "falta a nota fiscal" do outro até recarregar a página no braço.
  const primeiraVez = useRef(true);
  useEffect(() => {
    if (primeiraVez.current) { primeiraVez.current = false; return; }
    if (!digitos) return;
    carregar(digitos, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao]);

  /* Depois de gravar, quem manda recarregar é a página: ela relê a aba de pendências e
     sobe a `versao`, que traz esta de volta. Um caminho só, sem busca dobrada. */
  const recarregar = useCallback(async () => {
    if (onMudou) await onMudou();
    else await carregar(digitos, true);
  }, [onMudou, carregar, digitos]);

  const enviarDigitos = async (d: string) => {
    setVerificando(true);
    const ok = await carregar(d, true);
    if (ok) setDigitos(d);
    setVerificando(false);
  };

  if (carregando) {
    return (
      <div className="mt-8 space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (!dados) return null;

  const precisaDigitos = "precisa_digitos" in dados && dados.precisa_digitos;
  const temErro = "erro" in dados && dados.erro;

  if (precisaDigitos || (temErro && ("bloqueado" in dados && dados.bloqueado))) {
    return (
      <Portao
        responsavel={"responsavel" in dados ? dados.responsavel : undefined}
        erro={temErro ? (dados as FaturaErr).erro : undefined}
        restam={"restam" in dados ? dados.restam : undefined}
        bloqueado={"bloqueado" in dados ? dados.bloqueado : undefined}
        verificando={verificando}
        onEnviar={enviarDigitos}
      />
    );
  }

  if (temErro) {
    return (
      <div className="mt-10 rounded-lg border border-border bg-card p-5">
        <AlertTriangle className="h-5 w-5 text-warn" />
        <p className="mt-3 text-[14px] leading-relaxed">{(dados as FaturaErr).erro}</p>
      </div>
    );
  }

  return <Extrato dados={dados as FaturaOk} token={token} digitos={digitos} onRefresh={recarregar} />;
}

function Extrato({
  dados, token, digitos, onRefresh,
}: { dados: FaturaOk; token: string; digitos: string; onRefresh: () => Promise<void> }) {
  const { resumo, meses } = dados;
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("data");

  const termo = busca.trim().toLowerCase();
  // Busca e ordenação explícitas desligam a divisão "pendentes primeiro": quem pediu
  // ordem por valor quer a ordem por valor, não os pendentes na frente.
  const mandou = termo !== "" || ordem !== "data";

  const filtrados = useMemo(() => meses.map((m) => {
    const itens = termo
      ? m.itens.filter((i) =>
          i.estabelecimento.toLowerCase().includes(termo) ||
          (i.categoria || "").toLowerCase().includes(termo) ||
          (i.justificativa || "").toLowerCase().includes(termo) ||
          (i.nota_interna || "").toLowerCase().includes(termo))
      : m.itens;
    return { ...m, itens, total: itens.reduce((s, i) => s + Number(i.valor || 0), 0) };
  }).filter((m) => m.itens.length > 0), [meses, termo]);

  const achados = filtrados.reduce((s, m) => s + m.itens.length, 0);

  if (!meses.length) {
    return (
      <div className="mt-10 rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-[15px] font-medium">Nenhum lançamento por aqui ainda.</p>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Assim que a fatura do mês for processada, ela aparece nesta página.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {dados.encerrando && (
        <div
          className="mb-6 flex items-start gap-3 rounded-lg border p-4"
          style={{ borderColor: "hsl(var(--warn) / 0.4)", background: "hsl(var(--warn) / 0.08)" }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "hsl(var(--warn))" }} />
          <p className="text-[13px] leading-relaxed">
            <strong className="font-semibold">Este cartão foi encerrado.</strong>{" "}
            <span className="text-muted-foreground">
              Você consegue acessar esta página até {dados.acesso_ate} para terminar de enviar
              o que ficou pendente. Depois disso, fale com o financeiro.
            </span>
          </p>
        </div>
      )}

      {/* Números do cartão inteiro — sempre do total, não do que o filtro mostra */}
      <section className="grid grid-cols-3 divide-x divide-border border-y border-border">
        <Kpi rotulo="Total" valor={brl(resumo.total)} apoio={`${resumo.lancamentos} lançamentos`} />
        <Kpi rotulo="Com nota" valor={String(resumo.com_comprovante)} apoio="comprovante anexado" />
        <Kpi
          rotulo="Falta você"
          valor={String(resumo.pendentes)}
          apoio={resumo.pendentes === 0 ? "tudo em dia" : "precisam de resposta"}
          alerta={resumo.pendentes > 0}
        />
      </section>

      {/* Busca e ordenação */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar estabelecimento…"
            aria-label="Buscar na fatura"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {busca && (
            <button
              type="button" onClick={() => setBusca("")} aria-label="Limpar busca"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <label className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={ordem}
            onChange={(e) => setOrdem(e.target.value as Ordem)}
            aria-label="Ordenar a fatura"
            className="bg-transparent text-sm outline-none"
          >
            {ORDENS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </label>
      </div>

      {termo && (
        <p className="mt-2.5 text-[12px] text-muted-foreground">
          {achados === 0
            ? <>Nada encontrado para "<strong className="font-medium text-foreground">{busca}</strong>".</>
            : <>{achados} lançamento{achados === 1 ? "" : "s"} com "<strong className="font-medium text-foreground">{busca}</strong>".</>}
        </p>
      )}

      {filtrados.map((mes) => (
        <MesBloco
          key={mes.competencia} mes={mes} ordem={ordem} achatado={mandou}
          token={token} digitos={digitos} onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

function Kpi({ rotulo, valor, apoio, alerta }: {
  rotulo: string; valor: string; apoio: string; alerta?: boolean;
}) {
  return (
    <div className="px-3 py-4 first:pl-0 last:pr-0">
      <div className="eyebrow">{rotulo}</div>
      <div
        className="num mt-1.5 text-[18px] font-semibold leading-none tracking-tight sm:text-[22px]"
        style={alerta ? { color: "hsl(var(--warn))" } : undefined}
      >
        {valor}
      </div>
      <div className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{apoio}</div>
    </div>
  );
}

function MesBloco({ mes, ordem, achatado, token, digitos, onRefresh }: {
  mes: Mes; ordem: Ordem; achatado: boolean;
  token: string; digitos: string; onRefresh: () => Promise<void>;
}) {
  const pendentes = useMemo(
    () => ordenar(mes.itens.filter((i) => i.situacao === "pendente"), ordem),
    [mes.itens, ordem]);
  const resto = useMemo(
    () => ordenar(mes.itens.filter((i) => i.situacao !== "pendente"), ordem),
    [mes.itens, ordem]);
  const todos = useMemo(() => ordenar(mes.itens, ordem), [mes.itens, ordem]);

  /* Nada fica escondido atrás de clique. Na ordem padrão o que espera resposta vem
     primeiro, com uma divisória para o olho achar onde acaba a obrigação — mas o resto
     está logo abaixo, na mesma forma, sem botão para revelar. */
  const lista = achatado ? todos : [...pendentes, ...resto];

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h2 className="text-[17px] font-semibold tracking-tight">{nomeDoMes(mes.competencia)}</h2>
        <span className="num shrink-0 text-[15px] font-semibold">{brl(mes.total)}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {mes.itens.length} lançamento{mes.itens.length === 1 ? "" : "s"}
        {pendentes.length > 0 && <> · <strong className="font-medium text-foreground">{pendentes.length} esperando você</strong></>}
      </p>

      <div className="mt-4 space-y-3">
        {lista.map((it, i) => (
          <div key={it.id_unico}>
            {!achatado && pendentes.length > 0 && i === pendentes.length && (
              <div className="mb-3 flex items-center gap-3 pt-2">
                <span className="eyebrow shrink-0">Já resolvidos</span>
                <div className="h-px flex-1 bg-border" />
                <span className="num text-[12px] text-muted-foreground">{resto.length}</span>
              </div>
            )}
            <Linha item={it} token={token} digitos={digitos} onRefresh={onRefresh} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ================================================================== *
 *  Uma linha da fatura
 * ================================================================== */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const MOTIVOS: { valor: string; rotulo: string }[] = [
  { valor: "nao_e_meu", rotulo: "Esse gasto não é meu" },
  { valor: "nao_reconheco", rotulo: "Não reconheço a compra" },
  { valor: "valor_errado", rotulo: "O valor está errado" },
  { valor: "outro", rotulo: "Outro motivo" },
];

function Linha({ item, token, digitos, onRefresh }: {
  item: ItemFatura; token: string; digitos: string; onRefresh: () => Promise<void>;
}) {
  const [justificativa, setJustificativa] = useState(item.justificativa || "");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [contestando, setContestando] = useState(false);
  const [motivo, setMotivo] = useState(item.contestacao || "");
  const [motivoTexto, setMotivoTexto] = useState(item.contestacao_texto || "");
  // O campo de texto começa escondido. Um mês do Miguel tem 79 linhas: nove caixas
  // abertas já viram um paredão, e a maioria das linhas se resolve anexando a nota.
  // Quem já escreveu antes vê o próprio texto sem precisar clicar.
  const [justificando, setJustificando] = useState(!!item.justificativa);

  const pendente = item.situacao === "pendente";

  const justSalva = (item.justificativa || "").trim();
  const justNova = justificativa.trim() !== "" && justificativa.trim() !== justSalva;
  const podeEnviar = !!arquivo || justNova;

  const escolher = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { toast.error("Arquivo maior que 10 MB não é aceito"); return; }
      setArquivo(f);
    };
    input.click();
  };

  const enviar = async () => {
    if (!podeEnviar) return;
    setEnviando(true);
    try {
      if (arquivo) {
        const base64 = await fileToBase64(arquivo);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/fatura-anexar-comprovante`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({
            token, digitos, id_unico: item.id_unico,
            nome: arquivo.name, base64, mime: arquivo.type,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.ok) {
          // A justificativa não segue sozinha: o líder precisa ver o erro com o texto
          // ainda na tela para tentar de novo.
          toast.error(payload.erro || "Erro ao enviar o comprovante");
          return;
        }
      }

      if (justNova) {
        const { data, error } = await supabase.rpc("fatura_justificar_via_token", {
          p_token: token, p_digitos: digitos, p_id_unico: item.id_unico, p_texto: justificativa,
        });
        const payload = data as { ok?: boolean; erro?: string } | null;
        if (error || !payload?.ok) {
          toast.error(payload?.erro || error?.message || "Erro ao enviar a justificativa");
          return;
        }
      }

      toast.success(arquivo ? "Comprovante enviado" : "Justificativa enviada");
      setArquivo(null);
      await onRefresh();
    } catch {
      toast.error("Erro ao enviar");
    } finally {
      setEnviando(false);
    }
  };

  const contestar = async () => {
    if (!motivo) return;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc("fatura_contestar_via_token", {
        p_token: token, p_digitos: digitos, p_id_unico: item.id_unico,
        p_motivo: motivo, p_texto: motivoTexto || null,
      });
      const payload = data as { ok?: boolean; erro?: string } | null;
      if (error || !payload?.ok) {
        toast.error(payload?.erro || error?.message || "Erro ao registrar a contestação");
        return;
      }
      toast.success("Contestação registrada. O financeiro vai olhar.");
      setContestando(false);
      await onRefresh();
    } finally {
      setEnviando(false);
    }
  };

  const desfazerContestacao = async () => {
    setEnviando(true);
    try {
      await supabase.rpc("fatura_descontestar_via_token", {
        p_token: token, p_digitos: digitos, p_id_unico: item.id_unico,
      });
      setMotivo(""); setMotivoTexto(""); setContestando(false);
      await onRefresh();
    } finally {
      setEnviando(false);
    }
  };

  const meta = [item.data, item.parcela ? `parcela ${item.parcela}` : null, item.categoria]
    .filter(Boolean).join(" · ");

  /* Toda linha tem a MESMA forma, resolvida ou não — muda só o selo. A versão recolhida
     escondia atrás de uma seta justamente o que prova que está tudo certo, e obrigava a
     abrir uma por uma para conferir a fatura. */
  return (
    <article
      className="overflow-hidden rounded-lg border border-border bg-card"
      style={item.contestacao
        ? { borderColor: "hsl(var(--warn) / 0.45)" }
        : !pendente ? { borderColor: "hsl(var(--pos) / 0.35)" } : undefined}
    >
      <div className="flex items-start gap-4 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium leading-snug">{item.estabelecimento}</h3>
          <div className="mt-1 text-[12px] text-muted-foreground">{meta || "—"}</div>
        </div>
        <div className="num shrink-0 text-[17px] font-semibold tracking-tight">
          {brl(Number(item.valor || 0))}
        </div>
      </div>

      {/* O selo ocupa o MESMO lugar nas três situações — é ele que diz num relance se a
          linha espera alguma coisa. Verde: pronta. Âmbar: falta você. Cinza: não se aplica. */}
      <div className="px-4 pt-3">
        {item.situacao === "ok" ? (
          <span
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{
              borderColor: "hsl(var(--pos) / 0.35)",
              background: "hsl(var(--pos) / 0.10)",
              // Mesmo cuidado do âmbar: o --pos não tem contraste sobre o próprio fundo a 10%.
              color: "hsl(152 60% 26%)",
            }}
          >
            <Check className="h-3 w-3" />
            {item.tem_comprovante ? "Nota anexada" : "Resolvido"}
          </span>
        ) : item.situacao === "dispensado" ? (
          <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Minus className="h-3 w-3" />
            {item.motivo || "Não precisa de nota"}
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{
              borderColor: "hsl(var(--warn) / 0.35)",
              background: "hsl(var(--warn) / 0.10)",
              // O --warn (48% de luz) não tem contraste sobre o próprio fundo a 10%.
              color: "hsl(38 92% 30%)",
            }}
          >
            {item.motivo || "Falta a nota fiscal"}
          </span>
        )}
      </div>

      {/* A anotação da analista, como contexto. Ajuda o líder a lembrar do gasto ("Airbnb
          HMX4SA5JAZ - 5.300,00 em 6x; viajante Miguel"). Só leitura: é o caderno dela. */}
      {item.nota_interna && (
        <div className="mt-3 flex items-start gap-2 px-4 text-[12px] text-muted-foreground">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-snug">
            <span className="font-medium text-foreground">Do financeiro:</span> {item.nota_interna}
          </span>
        </div>
      )}

      {item.contestacao && (
        <div
          className="mt-3 flex items-start gap-2 border-y px-4 py-2.5 text-[12px]"
          style={{ borderColor: "hsl(var(--warn) / 0.3)", background: "hsl(var(--warn) / 0.07)" }}
        >
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "hsl(var(--warn))" }} />
          <span className="flex-1 leading-snug">
            <strong className="font-medium">
              {MOTIVOS.find((m) => m.valor === item.contestacao)?.rotulo || "Contestado"}
            </strong>
            {item.contestacao_texto && <span className="text-muted-foreground"> — {item.contestacao_texto}</span>}
          </span>
          <button
            type="button" onClick={desfazerContestacao} disabled={enviando}
            className="shrink-0 font-medium hover:underline disabled:opacity-50"
          >
            Desfazer
          </button>
        </div>
      )}


      {/* Ações */}
      <div className="space-y-3 px-4 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={escolher} disabled={enviando} className="h-8">
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
            {item.tem_comprovante ? "Trocar nota" : "Anexar nota"}
          </Button>
          {!justificando && !contestando && (
            <Button
              variant="ghost" size="sm" disabled={enviando}
              onClick={() => setJustificando(true)}
              className="h-8 text-muted-foreground"
            >
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Justificar
            </Button>
          )}
          {!item.contestacao && !contestando && (
            <Button
              variant="ghost" size="sm" disabled={enviando}
              onClick={() => { setContestando(true); setJustificando(false); }}
              className="h-8 text-muted-foreground"
            >
              <Flag className="mr-1.5 h-3.5 w-3.5" />
              Contestar
            </Button>
          )}
          {arquivo && (
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/50 py-1 pl-2 pr-1 text-[12px]">
              <span className="max-w-[160px] truncate font-medium" title={arquivo.name}>{arquivo.name}</span>
              <span className="shrink-0 text-muted-foreground">{kb(arquivo.size)}</span>
              <button
                type="button" onClick={() => setArquivo(null)} disabled={enviando}
                aria-label="Remover arquivo escolhido"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>

        {contestando ? (
          <div className="space-y-2.5 rounded-md border border-border bg-muted/30 p-3">
            <div className="eyebrow">O que houve com este gasto?</div>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => setMotivo(m.valor)}
                  className="rounded-full border px-2.5 py-1 text-[12px] transition-colors"
                  style={motivo === m.valor
                    ? { borderColor: "hsl(var(--warn))", background: "hsl(var(--warn) / 0.12)" }
                    : { borderColor: "hsl(var(--border))" }}
                >
                  {m.rotulo}
                </button>
              ))}
            </div>
            <Textarea
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.target.value)}
              rows={2}
              placeholder="Quer explicar? (opcional)"
              className="resize-none bg-background text-sm"
              disabled={enviando}
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setContestando(false)} disabled={enviando}>
                Cancelar
              </Button>
              <Button size="sm" className="h-8" onClick={contestar} disabled={enviando || !motivo}>
                {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Flag className="mr-1.5 h-3.5 w-3.5" />}
                Contestar
              </Button>
            </div>
          </div>
        ) : (justificando || arquivo) ? (
          <>
            {justificando && (
              <Textarea
                autoFocus={!justSalva}
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3}
                placeholder="Se não houver nota, explique aqui o que foi o gasto e por quê."
                className="resize-none text-sm"
                disabled={enviando}
              />
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] leading-tight text-muted-foreground">
                {enviando ? "Enviando…"
                  : arquivo && justNova ? "Nota e justificativa prontas"
                  : arquivo ? "Nota pronta para envio"
                  : justNova ? "Justificativa pronta para envio"
                  : "Anexe a nota ou escreva a justificativa"}
              </span>
              <Button size="sm" onClick={enviar} disabled={enviando || !podeEnviar} className="h-8 shrink-0">
                {enviando
                  ? (<><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Enviando</>)
                  : (<><Send className="mr-1.5 h-3.5 w-3.5" />Enviar</>)}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}
