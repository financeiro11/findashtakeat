/**
 * Corrigir salário e documento de uma pessoa, por cima do espelho do RH.
 *
 * A correção NÃO vai para `rh_colaboradores`: aquela tabela é espelho e o sync
 * do Portal RH reescreve as linhas a cada ciclo, então um valor corrigido lá
 * duraria até a próxima sincronização e sumiria sem avisar. Ela mora em
 * `folha_depara.valor_ajustado`, sobrevive ao sync, e a folha usa o ajuste
 * quando existe.
 *
 * Toda alteração exige MOTIVO e vai para `folha_ajustes_log`. Salário é
 * dinheiro: quem trocou 24.000 por 2.400, quando e por quê tem de continuar
 * legível depois que outra pessoa mexer de novo.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { History, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { tabelaFolha } from "@/lib/folha/db";
import { lerValor } from "@/lib/folha/valor";
import {
  cnpjValido, cpfValido, ehEstagiario, formatarCnpj, formatarCpf, soDigitos,
} from "@/lib/folha/conferencia";
import { cn } from "@/lib/utils";

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export type AlvoDoAjuste = {
  codigo: string;
  nome: string;
  cargo?: string | null;
  valorRh: number;
  valorAjustado: number | null;
  /** Documento como está no espelho do RH, só dígitos. */
  documentoRh?: string;
  documentoAjustado?: string | null;
};

type Registro = {
  campo: string | null;
  de: number | null;
  para: number | null;
  de_texto: string | null;
  para_texto: string | null;
  motivo: string | null;
  feito_em: string;
};

/** Documento formatado, para a tela não mostrar catorze dígitos colados. */
const doc = (d: string) => (d.length === 11 ? formatarCpf(d) : d.length === 14 ? formatarCnpj(d) : d || "—");

export default function AjustarSalarioDialog({
  alvo, onFechar, onSalvo,
}: {
  alvo: AlvoDoAjuste | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [docTexto, setDocTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [historico, setHistorico] = useState<Registro[]>([]);

  useEffect(() => {
    if (!alvo) return;
    setTexto(alvo.valorAjustado !== null ? String(alvo.valorAjustado).replace(".", ",") : "");
    setDocTexto(alvo.documentoAjustado ?? "");
    setMotivo("");
    setHistorico([]);
    tabelaFolha("folha_ajustes_log")
      .select("campo, de, para, de_texto, para_texto, motivo, feito_em")
      .eq("codigo_rh", alvo.codigo)
      .order("feito_em", { ascending: false })
      .limit(5)
      .then(({ data }) => setHistorico((data ?? []) as unknown as Registro[]));
  }, [alvo]);

  if (!alvo) return null;

  const novo = lerValor(texto);
  const invalido = texto.trim() !== "" && (novo === null || novo <= 0);

  const estagiario = ehEstagiario(alvo.cargo ?? "");
  const novoDoc = soDigitos(docTexto) || null;
  /* Documento é conferido com dígito verificador, não só pelo tamanho: um CNPJ
     errado que TEM 14 dígitos passaria por qualquer checagem de tamanho e só
     apareceria quando o Omie não achasse o fornecedor. */
  const docInvalido = !!novoDoc && !(cnpjValido(novoDoc) || cpfValido(novoDoc));
  const docEhCpf = !!novoDoc && novoDoc.length === 11;
  const cpfIndevido = docEhCpf && !estagiario;

  const mudouValor = novo !== alvo.valorAjustado;
  const mudouDoc = (novoDoc ?? null) !== (alvo.documentoAjustado ?? null);
  const podeSalvar = !invalido && !docInvalido && (mudouValor || mudouDoc)
    && motivo.trim().length >= 3;

  const salvar = async () => {
    setSalvando(true);
    try {
      const { data: sessao } = await supabase.auth.getUser();
      const quem = sessao?.user?.id ?? null;

      const campos: Record<string, unknown> = {};
      if (mudouValor) Object.assign(campos, {
        valor_ajustado: novo,
        valor_rh_no_ajuste: novo === null ? null : alvo.valorRh,
        ajuste_motivo: novo === null ? null : motivo.trim(),
        ajustado_por: novo === null ? null : quem,
        ajustado_em: novo === null ? null : new Date().toISOString(),
      });
      if (mudouDoc) Object.assign(campos, {
        documento_ajustado: novoDoc,
        documento_rh_no_ajuste: novoDoc === null ? null : (alvo.documentoRh ?? null),
        documento_motivo: novoDoc === null ? null : motivo.trim(),
        documento_ajustado_em: novoDoc === null ? null : new Date().toISOString(),
      });

      const { error } = await tabelaFolha("folha_depara")
        .update(campos)
        .eq("codigo_rh", alvo.codigo);
      if (error) throw new Error(error.message);

      /* O log é gravado mesmo quando a correção é REMOVIDA: voltar a usar o
         espelho também é uma decisão, e some do estado se ninguém registrar. */
      /* Uma linha de log por campo. Juntar os dois numa só faria a leitura do
         histórico ter de adivinhar o que mudou. */
      if (mudouValor) {
        await tabelaFolha("folha_ajustes_log").insert({
          codigo_rh: alvo.codigo, nome: alvo.nome, campo: "valor",
          de: alvo.valorAjustado, para: novo, valor_rh: alvo.valorRh,
          motivo: motivo.trim(), feito_por: quem,
        });
      }
      if (mudouDoc) {
        await tabelaFolha("folha_ajustes_log").insert({
          codigo_rh: alvo.codigo, nome: alvo.nome, campo: "documento",
          de_texto: alvo.documentoAjustado ?? null, para_texto: novoDoc,
          motivo: motivo.trim(), feito_por: quem,
        });
      }

      toast.success(`${alvo.nome} atualizado`, {
        description: [
          mudouValor && (novo === null ? "salário volta ao RH" : `salário ${BRL(novo)}`),
          mudouDoc && (novoDoc === null ? "documento volta ao RH" : `documento ${doc(novoDoc)}`),
        ].filter(Boolean).join(" · "),
      });
      onSalvo();
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir dados · {alvo.nome}</DialogTitle>
          <DialogDescription>
            A correção fica no Hub e sobrevive ao sync do RH — o espelho é reescrito a
            cada ciclo, então corrigir lá não duraria.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-[12.5px] text-muted-foreground">No espelho do RH</span>
          <span className="num text-sm">{BRL(alvo.valorRh)}</span>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12.5px] font-medium" htmlFor="valor-corrigido">
            Valor corrigido
          </label>
          <Input
            id="valor-corrigido"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="deixe vazio para usar o valor do RH"
            inputMode="decimal"
            className={cn("num", invalido && "border-destructive")}
          />
          <p className="text-xs text-muted-foreground">
            {invalido
              ? "Valor inválido. Use algo como 2.400,00 — zerar alguém se faz pelo desligamento, não aqui."
              : novo !== null
                ? `A folha vai usar ${BRL(novo)}.`
                : "Vazio: a folha volta a usar o valor do espelho do RH."}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-[12.5px] text-muted-foreground">Documento no espelho do RH</span>
          <span className="mono text-sm">{doc(alvo.documentoRh ?? "")}</span>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12.5px] font-medium" htmlFor="doc-corrigido">
            CNPJ ou CPF corrigido
          </label>
          <Input
            id="doc-corrigido"
            value={docTexto}
            onChange={(e) => setDocTexto(e.target.value)}
            placeholder="deixe vazio para usar o documento do RH"
            inputMode="numeric"
            className={cn("mono", docInvalido && "border-destructive")}
          />
          <p className={cn("text-xs", docInvalido ? "text-destructive" : "text-muted-foreground")}>
            {docInvalido
              ? "Dígito verificador não confere — não é um CNPJ nem um CPF válido."
              : cpfIndevido
                ? "É um CPF, e esta pessoa não é estagiária. Prestador PJ deveria ter CNPJ."
                : novoDoc
                  ? `A folha vai procurar o fornecedor por ${doc(novoDoc)}.`
                  : "Vazio: vale o documento do espelho do RH."}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12.5px] font-medium" htmlFor="motivo-ajuste">
            Motivo <span className="font-normal text-muted-foreground">(obrigatório)</span>
          </label>
          <Input
            id="motivo-ajuste"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="ex.: reajuste de agosto ainda não lançado no Portal RH"
          />
        </div>

        {historico.length > 0 && (
          <div className="rounded-lg border">
            <p className="flex items-center gap-1.5 border-b px-3 py-2 text-[12.5px] font-semibold">
              <History className="size-3.5" /> Correções anteriores
            </p>
            <ul className="divide-y">
              {historico.map((h, i) => (
                <li key={i} className="px-3 py-1.5 text-xs">
                  <span className={h.campo === "documento" ? "mono" : "num"}>
                    {h.campo === "documento"
                      ? `${h.de_texto ? doc(h.de_texto) : "RH"} → ${h.para_texto ? doc(h.para_texto) : "RH"}`
                      : `${h.de === null ? "RH" : BRL(h.de)} → ${h.para === null ? "RH" : BRL(h.para)}`}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}· {new Date(h.feito_em).toLocaleDateString("pt-BR")}
                    {h.motivo ? ` · ${h.motivo}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {alvo.valorAjustado !== null || alvo.documentoAjustado ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setTexto(""); setDocTexto(""); }}
              disabled={salvando || (texto.trim() === "" && docTexto.trim() === "")}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              Voltar ao valor do RH
            </Button>
          ) : <span />}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
            <Button
              onClick={salvar}
              disabled={!podeSalvar || salvando}
              title={
                !mudouValor && !mudouDoc ? "Nada mudou."
                  : motivo.trim().length < 3 ? "Escreva o motivo."
                    : undefined
              }
            >
              {salvando && <Loader2 className="size-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
