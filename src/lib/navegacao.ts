// O catálogo de navegação do Hub — os itens de menu, num lugar só.
//
// Viviam dentro do AppSidebar, e o CommandMenu (⌘K) mantinha uma segunda lista escrita à
// mão. A segunda lista envelheceu: Parceiros, Caixa, Briefing, Tarefas, Estornos, CAC,
// Rescisões e mais vinte telas estavam no menu e não apareciam na busca — enquanto
// "DE_PARA" continuava na busca apontando para uma rota que já não existe. Mesmo motivo
// de ./rotas.ts: dois catálogos em arquivos diferentes divergem no primeiro menu novo que
// alguém acrescentar, e aí o menu diz uma coisa e a busca outra.

import {
  Home, Sparkles, Landmark, CreditCard, Repeat, Handshake, Users, CheckSquare,
  FolderKanban, BookOpenCheck, Presentation, Building2, Percent, Receipt, Undo2,
  FileText, Smartphone, Plane, LayoutDashboard, Kanban, FileSpreadsheet, Truck,
  History, FileSignature, Gavel, CheckCircle2, PieChart, TrendingUp, FileBarChart,
  Scale, Target, Brain, Wallet2, ShieldCheck, Megaphone, UserMinus, UserCog, Tags,
  Palette, Mic, Rocket,
  type LucideIcon,
} from "lucide-react";
import type { ModuleAccess, ModuleId } from "./modules";
import { normalize } from "./normalize";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: string;
  /** Termos que a busca também aceita — sinônimo, sigla, o nome do sistema de origem. */
  busca?: string[];
  /**
   * Outras rotas que são a MESMA tela e devem acender o mesmo item de menu.
   *
   * Anotações mora em `/playbook`, mas a aba Workspace vive em `/notas` — porque uma nota
   * precisa de endereço próprio para ser compartilhada. Sem isto, abrir uma nota apagaria
   * o destaque do menu e o Hub pareceria ter saído da tela em que está.
   */
  alias?: string[];
};

export type NavGrupo = { label: string; items: NavItem[] };

/** A rota atual é este item — pela URL dele ou por um dos apelidos. */
export function itemAtivo(item: NavItem, pathname: string): boolean {
  if (pathname === item.url) return true;
  return (item.alias ?? []).some((a) => pathname === a || pathname.startsWith(a + "/"));
}

// Business Plan: o ano corrente é o plano vigente; o seguinte é o que está em
// construção. Derivado da data pra não envelhecer na virada do ano.
const ANO_BP = new Date().getFullYear();

/** Os grupos do Hub Financeiro, na ordem em que aparecem no menu. */
export const GRUPOS_FINANCEIRO: NavGrupo[] = [
  { label: "Início", items: [
    { title: "Dashboard", url: "/", icon: Home, busca: ["início", "home", "visão geral"] },
    // O Assistente não tem item de menu de propósito: ele é a bolinha flutuante presente
    // em toda página (AIAssistant, montado no AppLayout) — sempre a um clique, sem exigir
    // que a pessoa saia de onde está para perguntar.
    { title: "Briefing", url: "/briefing", icon: Sparkles, busca: ["diário", "agenda", "e-mails", "notícias"] },
    { title: "Novidades do Hub", url: "/briefing/novidades", icon: Rocket, busca: ["mudanças", "changelog", "o que mudou", "atualizações", "versão"] },
    { title: "Caixa", url: "/caixa", icon: Landmark, badge: "OMIE", busca: ["saldo", "banco", "capital de giro", "ponto de equilíbrio"] },
    { title: "Asaas", url: "/asaas", icon: CreditCard, busca: ["cobranças", "recebimentos", "estornos"] },
    { title: "Assinaturas", url: "/assinaturas", icon: Repeat, busca: ["mrr", "recorrência", "churn", "carteira"] },
    { title: "Parceiros", url: "/operacional/parceiros", icon: Handshake, busca: ["embaixadores", "bonificação", "parcerias"] },
  ]},
  { label: "Time Financeiro", items: [
    { title: "Visão do Time", url: "/time/visao", icon: Users, busca: ["estrutura", "cargos", "automações", "catálogo"] },
    { title: "Tarefas", url: "/tarefas", icon: CheckSquare, busca: ["kanban", "backlog"] },
    { title: "Projetos", url: "/automacoes/projetos", icon: FolderKanban },
    { title: "Anotações", url: "/playbook", icon: BookOpenCheck, busca: ["playbook", "notas"], alias: ["/notas"] },
  ]},
  /* Apresentações: o que sai do Hub para uma PLATEIA — a reunião de tracker com o
     CEO, e os materiais de Conselho e Investidores. Ficam juntas porque o que elas
     compartilham não é o dado (esse vem de Demonstrações, BP, Assinaturas…) e sim
     o formato: roteiro de folhas, redação por cima do número e saída em PDF/PPTX. */
  { label: "Apresentações", items: [
    { title: "Revisão Mensal", url: "/apresentacoes/revisao", icon: Presentation, busca: ["revisão do mês", "tracker", "ceo"] },
    { title: "Reportes", url: "/apresentacoes/reportes", icon: Building2, busca: ["conselho", "investidores", "board"] },
  ]},
  { label: "Operacional", items: [
    { title: "Cartão → Omie", url: "/operacional/cartao", icon: CreditCard, busca: ["fatura", "provisionar", "parcelas"] },
    { title: "Variável", url: "/operacional/variavel", icon: Percent, busca: ["comissões"] },
    { title: "Reembolsos", url: "/operacional/reembolsos", icon: Receipt },
    { title: "Estornos", url: "/operacional/estornos", icon: Undo2, busca: ["churn", "refund"] },
    { title: "Notas Fiscais", url: "/operacional/notas-fiscais", icon: FileText, busca: ["nfs-e", "nfse", "emissão"] },
    { title: "Proporcionais", url: "/automacoes/proporcionais", icon: Percent, busca: ["salário", "pró-rata"] },
  ]},
  { label: "Recargas", items: [
    { title: "Celulares", url: "/recargas/celulares", icon: Smartphone },
    { title: "Viagens", url: "/recargas/viagens", icon: Plane },
  ]},
  { label: "Editais", items: [
    { title: "Radar de Editais", url: "/editais", icon: Gavel, busca: ["fomento", "grants", "licitação"] },
    { title: "Projetos Aprovados", url: "/editais/projetos-aprovados", icon: CheckCircle2, busca: ["prestação de contas"] },
  ]},
  { label: "Investimentos", items: [
    { title: "Captable", url: "/captable", icon: PieChart, busca: ["sócios", "cap table", "equity"] },
    { title: "Takeat LTD/LLC", url: "/investimentos", icon: TrendingUp, busca: ["exterior", "financials"] },
  ]},
  { label: "Demonstrações", items: [
    { title: "DRE", url: "/demonstracoes/dre", icon: FileBarChart, busca: ["resultado", "ebitda", "análises"] },
    { title: "DFC", url: "/demonstracoes/dfc", icon: TrendingUp, busca: ["fluxo de caixa", "cashburn", "runway"] },
    // A Revisão do Mês mudou para o grupo "Apresentações" — ela é uma reunião, não
    // um demonstrativo. A rota antiga continua respondendo, redirecionando.
    { title: "Balancete", url: "/demonstracoes/balancete", icon: FileText },
    { title: "Balanço", url: "/demonstracoes/balanco", icon: Scale, busca: ["bp", "patrimonial"] },
  ]},
  { label: "BP", items: [
    { title: `BP ${ANO_BP}`, url: `/bp/${ANO_BP}`, icon: FileSpreadsheet, busca: ["business plan", "orçado", "plano"] },
    { title: `BP ${ANO_BP + 1}`, url: `/bp/${ANO_BP + 1}`, icon: Sparkles, badge: "IA", busca: ["business plan", "plano"] },
    { title: "Histórico de versões", url: "/bp/versoes", icon: History, busca: ["business plan"] },
  ]},
  { label: "Análise Preditiva", items: [
    { title: "Cenários", url: "/analise/cenarios", icon: Target, busca: ["projeção", "simulação"] },
    { title: "Histórico Multianual", url: "/analise/historico", icon: TrendingUp },
  ]},
  { label: "Governança", items: [
    { title: "Orçamento", url: "/orcamento", icon: Wallet2, busca: ["realizado", "budget"] },
    { title: "Auditoria", url: "/governanca/auditoria", icon: ShieldCheck, busca: ["pix", "achados", "conciliação"] },
    { title: "Cartão", url: "/governanca/cartao", icon: CreditCard, badge: "OFX", busca: ["fatura", "ofx", "sicoob"] },
    { title: "Painel CAC", url: "/governanca/cac", icon: Megaphone, busca: ["aquisição", "marketing", "comercial"] },
    { title: "Rescisões", url: "/governanca/rescisoes", icon: UserMinus, busca: ["desligamento", "verbas", "pj"] },
  ]},
  { label: "Configurações", items: [
    { title: "Colaboradores (RH)", url: "/operacional/colaboradores", icon: Users, busca: ["rh", "portal rh", "ficha", "funcionário", "funcionario", "equipe"] },
    { title: "Parametrização", url: "/configuracoes/parametrizacao", icon: Tags, busca: ["apelido", "contraparte", "fornecedor", "de-para", "de para"] },
    { title: "Usuários", url: "/usuarios", icon: UserCog, busca: ["acesso", "cargo", "permissão"] },
    { title: "Biblioteca", url: "/analise/conhecimento", icon: Brain, busca: ["base de conhecimento", "políticas", "colaboradores"] },
  ]},
];

/** O módulo Facilities substitui o menu inteiro — não convive com o Financeiro. */
export const GRUPO_FACILITIES: NavGrupo = {
  label: "Facilities",
  items: [
    { title: "Dashboard", url: "/facilities", icon: LayoutDashboard, busca: ["compras"] },
    { title: "Solicitações", url: "/facilities/solicitacoes", icon: Kanban, busca: ["pedido", "compra"] },
    { title: "Cotações", url: "/facilities/cotacoes", icon: FileSpreadsheet, busca: ["orçamento", "comparativo"] },
    { title: "Fornecedores", url: "/facilities/fornecedores", icon: Truck },
    { title: "Histórico", url: "/facilities/historico", icon: History, busca: ["compras realizadas"] },
    { title: "Contratos", url: "/facilities/contratos", icon: FileSignature, busca: ["recorrentes"] },
  ],
};

/** Cargo "parcerias" enxerga uma tela só (ver AppLayout, que trava a rota). */
export const GRUPO_PARCERIAS: NavGrupo = {
  label: "Operacional",
  items: [GRUPOS_FINANCEIRO[0].items.find((i) => i.url === "/operacional/parceiros")!],
};

/**
 * Telas que existem e não têm item de menu. Não entram na barra lateral — mas quem
 * sabe o nome deve conseguir chegar nelas pela busca, que é o ponto da busca.
 */
export const GRUPO_BUSCA_EXTRA: NavGrupo = {
  label: "Outras telas",
  items: [
    { title: "Extrato Sicoob", url: "/caixa/conta-corrente/sicoob", icon: Landmark, busca: ["conta corrente", "banco"] },
    { title: "Extrato Asaas", url: "/caixa/conta-corrente/asaas", icon: CreditCard, busca: ["conta corrente"] },
    { title: "Memória do Assistente", url: "/assistente/memoria", icon: Brain, busca: ["ia", "lembrou"] },
    { title: "Teste de Voz", url: "/assistente/teste-voz", icon: Mic, busca: ["ia", "vozes"] },
    { title: "Design System", url: "/design-system", icon: Palette, busca: ["cores", "tokens", "componentes"] },
  ],
};

/** Os grupos que ESTE usuário enxerga no menu, na ordem do menu. */
export function gruposVisiveis(access: ModuleAccess, mod: ModuleId): NavGrupo[] {
  if (access.parceriasOnly) return [GRUPO_PARCERIAS];
  if (mod === "facilities") return [GRUPO_FACILITIES];
  return GRUPOS_FINANCEIRO;
}

/** Todos os itens de um conjunto de grupos, achatados (pool de favoritos, busca…). */
export function itensDe(grupos: NavGrupo[]): NavItem[] {
  return grupos.flatMap((g) => g.items);
}

/**
 * O que a busca varre além do que está escrito na linha: o nome do grupo, o caminho da
 * rota (quem decora "/asaas" digita isso), os sinônimos do catálogo — e tudo de novo sem
 * acento, senão "solicitacoes" não acha "Solicitações" nem "orcamento" acha "Orçamento".
 */
export function termosDeBusca(grupo: string, item: NavItem): string[] {
  const cru = [grupo, item.title, item.url, item.badge ?? "", ...(item.busca ?? [])].filter(Boolean);
  const semAcento = cru.map((t) => normalize(t).toLowerCase()).filter(Boolean);
  return [...new Set([...cru, ...semAcento])];
}
