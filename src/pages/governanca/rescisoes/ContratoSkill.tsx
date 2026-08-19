/* O contrato do payload — para colar nas instruções da skill "Rescisão PJ".
 *
 * Existe porque a divisão de trabalho só funciona se o outro lado souber o
 * formato. No cartão, o contrato ficou só no comentário da migration e a skill
 * gravou oito cabeçalhos de fatura sem um único lançamento (ver
 * 20260805140000_cartao_importar_nao_silencia.sql): ninguém percebeu porque nada
 * na tela dizia o que era esperado. Aqui o contrato está a um clique da tela que
 * o consome, com botão de copiar.
 *
 * O payload foi desenhado em cima do que a skill JÁ calcula — as seis parcelas
 * que ela imprime na resposta. Nada de pedir que ela monte um array de verbas: o
 * banco faz isso a partir das parcelas (`rescisao_verbas_pj`).
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const PAYLOAD = `{
  "rescisoes": [
    {
      "colaborador": "João Silva",
      "desligamento": "2026-05-15",
      "tipo_desligamento": "involuntario",
      "motivo_texto": "performance abaixo da meta",

      "vinculo": "pj",
      "admissao": "2024-03-10",
      "remuneracao": 8000.00,
      "fonte_remuneracao": "planilha",

      "meses_trabalhados": 26,
      "dias_ferias_tirados": 30,
      "dias_trabalhados_mes": 15,

      "componentes": {
        "ferias_proporcionais": 17333.33,
        "desconto_ferias_tiradas": 8000.00,
        "proporcional_mes": 3870.97,
        "variavel": 1500.00,
        "multa_rescisao": 8000.00,
        "desconto_flash": 258.06
      },
      "total_a_receber": 22446.24,

      "fontes": [
        { "texto": "Planilha RH (aba PJs)", "url": "https://docs.google.com/spreadsheets/d/1W6a3nik…" },
        { "texto": "E-mail \\"Desligamento João Silva\\" lido em 16/05/2026" },
        { "texto": "Política de multa: diretriz RH de 01/07/2026 (Henrique/Miguel)" }
      ],
      "alertas": [
        "Variável não informado no e-mail — considerado R$ 0,00"
      ],
      "texto_resposta": "📋 Rescisão — João Silva\\n…",

      "fonte": "Rescisão PJ",
      "calculado_em": "2026-05-16T12:00:00Z"
    }
  ]
}`;

const CHAMADA = `select public.rescisao_registrar('<payload jsonb>'::jsonb);`;

/** O bloco pronto para colar no fim das instruções da skill. */
const INSTRUCAO = `## Registrar no Hub (obrigatório ao final)

Depois de apresentar o resultado ao usuário, grave o cálculo no Hub — projeto
Supabase lgcxyxyidoirqmbdlldh, via MCP do Supabase:

  select public.rescisao_registrar('<payload>'::jsonb);

Payload:
${PAYLOAD}

De→para com o que você já calculou:
  ferias_proporcionais     = Férias proporcionais (BRUTAS, antes do desconto)
  desconto_ferias_tiradas  = (remuneração / 30) × dias de férias tirados; 0 se não houve
  proporcional_mes         = Proporcional do mês de saída
  variavel                 = Variável/Comissão (mande 0 explícito se não veio no e-mail)
  multa_rescisao           = 1× remuneração se involuntário; 0 (ou omita) se voluntário
  desconto_flash           = 500 × (dias não trabalhados / dias do mês)
  total_a_receber          = o TOTAL A RECEBER da sua resposta

Regras:
- Obrigatórios: colaborador, desligamento (último dia trabalhado) e
  tipo_desligamento ("voluntario" ou "involuntario").
- Mande todos os valores POSITIVOS, inclusive os descontos: quem é desconto está
  dito pelo nome do campo. O Hub monta as verbas, as referências ("26 meses",
  "16 dias") e as fórmulas a partir dessas parcelas.
- meses_trabalhados, dias_ferias_tirados e dias_trabalhados_mes não são enfeite:
  são o que vira a referência de cada verba na tela. Sem eles a verba aparece sem
  explicação. (dias_trabalhados_mes e dias do mês, se omitidos, saem do calendário
  da data de desligamento.)
- fontes: a mesma lista que você imprime no bloco "Fontes" — com url quando houver.
- alertas: toda ressalva que você deu em voz alta (variável não informado, férias
  além do direito acumulado, remuneração do e-mail sobrepondo a planilha).
- texto_resposta: a resposta formatada inteira, como você a imprimiu.
- Idempotente por pessoa + data de desligamento: rodar de novo CORRIGE o cálculo
  (troca cabeçalho e parcelas) em vez de duplicar.
- NÃO mande "situacao" nem "data_pagamento": o controle do pagamento é do Hub e
  regravar o cálculo não pode apagar o "paga em 20/08" marcado na tela.
- O retorno traz "divergencia" por rescisão: a diferença entre o total_a_receber
  que você declarou e o que as parcelas somam. Diferente de 0 significa que o
  cálculo saiu inconsistente — corrija antes de dar a rescisão por pronta.

Depois de gravar, diga ao usuário que a rescisão está registrada em
Governança › Rescisões (/governanca/rescisoes).`;

/** Regras que valem a pena ver sem abrir o bloco inteiro. */
const CARTOES: { titulo: string; itens: string[] }[] = [
  {
    titulo: "obrigatórios",
    itens: [
      "colaborador — nome como está na planilha de RH",
      "desligamento — último dia trabalhado (AAAA-MM-DD)",
      "tipo_desligamento — voluntario | involuntario",
    ],
  },
  {
    titulo: "as seis parcelas (componentes)",
    itens: [
      "ferias_proporcionais — brutas, antes do desconto",
      "desconto_ferias_tiradas — (rem/30) × dias tirados",
      "proporcional_mes — rem × dias/dias do mês",
      "variavel — 0 explícito se não veio no e-mail",
      "multa_rescisao — 1× rem. só se involuntário",
      "desconto_flash — 500 × dias não trabalhados/dias do mês",
    ],
  },
  {
    titulo: "o que vira referência na tela",
    itens: [
      "meses_trabalhados — vira “26 meses” na verba de férias",
      "dias_ferias_tirados — vira “30 dias” no desconto",
      "dias_trabalhados_mes — vira “15 dias”; sai do calendário se omitido",
      "fontes e alertas — o bloco de auditoria da tela",
    ],
  },
  {
    titulo: "o que a skill NÃO manda",
    itens: [
      "situacao e data_pagamento — o controle do pagamento é do Hub",
      "valores negativos — todos positivos; o campo diz o sinal",
      "verbas[] — só para caso fora do padrão (ex.: CLT)",
    ],
  },
];

export function ContratoSkill({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(texto: string, qual: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      toast.success("Copiado.");
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      toast.error("Não consegui copiar.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">O que a skill precisa gravar</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            A skill <b>Rescisão PJ</b> calcula; este painel registra. Ela grava chamando{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11.5px]">rescisao_registrar</code> com as{" "}
            <b>seis parcelas que já imprime na resposta</b> — o Hub monta as verbas, as referências e as
            fórmulas a partir delas. Idempotente por pessoa + data de desligamento: rodar de novo corrige
            o cálculo em vez de duplicar.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <code className="text-[11.5px]">{CHAMADA}</code>
            <button className="chip" onClick={() => copiar(INSTRUCAO, "instrucao")}>
              {copiado === "instrucao" ? <Check className="h-3.5 w-3.5 text-pos" /> : <Copy className="h-3.5 w-3.5" />}
              Copiar instrução para a skill
            </button>
          </div>

          <div className="grid gap-2 text-[11.5px] sm:grid-cols-2">
            {CARTOES.map((c) => (
              <div key={c.titulo} className="rounded-md border border-border px-3 py-2">
                <p className="mb-1 font-semibold">{c.titulo}</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {c.itens.map((i) => <li key={i}>{i}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-[12px] font-medium">Payload</span>
              <button className="chip" onClick={() => copiar(PAYLOAD, "payload")}>
                {copiado === "payload" ? <Check className="h-3.5 w-3.5 text-pos" /> : <Copy className="h-3.5 w-3.5" />}
                Copiar
              </button>
            </div>
            <pre className="max-h-[38vh] overflow-auto px-3 py-2 text-[11px] leading-relaxed">
              {PAYLOAD}
            </pre>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Caso fora do padrão (uma rescisão CLT, por exemplo): mande{" "}
            <code className="rounded bg-muted px-1 py-0.5">verbas</code> — um array de{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {"{ tipo, rubrica, referencia, base, valor, formula }"}
            </code>{" "}
            com <code className="rounded bg-muted px-1 py-0.5">tipo</code> em provento / desconto / fgts /
            informativo — e elas são gravadas como vieram, no lugar das parcelas.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
