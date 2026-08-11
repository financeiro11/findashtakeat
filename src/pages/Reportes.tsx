/* ============================================================================
 * Reportes — materiais para Conselho e Investidores.
 *
 * AINDA NÃO EXISTE. Esta página é o lugar reservado, e é honesta sobre isso: um
 * item de menu que abre em erro (ou numa tela que finge ter dado) é pior que um
 * item que diz o que vai ser e o que já dá para usar enquanto não é.
 *
 * O que ela faz de útil hoje: aponta para a Revisão Mensal, que já tem o motor
 * inteiro (roteiro de folhas, montador, comando por escrito, exportação em
 * PDF/PPTX e publicação que congela os números). Um reporte trimestral montado
 * lá dentro já sai apresentável — o que falta é o que está listado abaixo.
 * ========================================================================== */

import { Link } from "react-router-dom";
import { ArrowRight, Building2, CalendarClock, LayoutGrid, Palette, Repeat } from "lucide-react";

/** O que separa "dá para usar" de "é o produto que a gente quer". */
const FALTA = [
  {
    Icone: LayoutGrid,
    titulo: "Catálogo de cards que atravessa o Hub",
    texto: "Hoje os cards de uma apresentação saem só da Revisão Mensal. Um material de "
      + "Conselho precisa de churn, carteira, capital de giro, ponto de equilíbrio, BP e "
      + "captable — cada tela registrando os seus cards num lugar só, em vez de cada "
      + "apresentação redesenhar o que já existe.",
  },
  {
    Icone: CalendarClock,
    titulo: "Período como parâmetro da apresentação",
    texto: "A Revisão é de um mês fechado. Conselho fala em trimestre, investidor fala em "
      + "ano e em últimos doze meses. O período tem de ser da apresentação, e cada card "
      + "tem de saber se redesenhar para o período que recebeu.",
  },
  {
    Icone: Repeat,
    titulo: "Modelo que se repete sozinho",
    texto: "O deck do Conselho é o mesmo todo trimestre, com números novos. Um MODELO "
      + "guarda o roteiro sem período; virar o trimestre gera a apresentação nova, já "
      + "com os números do período e a redação da IA por cima.",
  },
  {
    Icone: Palette,
    titulo: "Capa, marca e confidencialidade",
    texto: "Material que sai da empresa precisa de capa, contracapa, a marca certa e uma "
      + "marca d'água de confidencial — e de saber quem no Hub pode abrir cada um.",
  },
];

export default function Reportes() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6">
      <header className="flex items-start gap-3 border-b border-border pb-4">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Building2 className="h-4.5 w-4.5 text-accent-foreground" />
        </span>
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Reportes</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            O lugar dos materiais de <b>Conselho</b> e <b>Investidores</b>: o mesmo motor de
            apresentação da reunião mensal, com período mais largo, capa e um modelo que se
            repete a cada trimestre. <b>Ainda não foi construído</b> — esta tela é o espaço
            reservado, não uma versão vazia.
          </p>
        </div>
      </header>

      <section className="card-surface flex flex-col gap-3 p-4">
        <div className="eyebrow">Enquanto isso</div>
        <p className="text-[12.5px] leading-relaxed">
          O motor já existe e é o mesmo: na <b>Revisão Mensal</b> dá para criar uma
          apresentação com o nome que quiser, escolher o que entra em cada folha, escrever o
          texto de cada card, pedir mudanças por escrito e exportar em PDF paisagem ou
          PowerPoint 16:9. Publicar congela os números — serve como ata do que foi apresentado.
        </p>
        <Link
          to="/apresentacoes/revisao"
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition hover:opacity-90"
        >
          Abrir a Revisão Mensal <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="eyebrow">O que falta para virar Reportes de verdade</div>
        {FALTA.map(({ Icone, titulo, texto }) => (
          <article key={titulo} className="card-surface flex gap-3 p-4">
            <Icone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-[13px] font-semibold">{titulo}</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{texto}</p>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
