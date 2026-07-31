import {
  Zap, Brain, Bot, Sparkles, Banknote, FileText, FileSearch, BarChart3, ArrowRightLeft,
  MessageSquare, MessageCircle, CalendarCheck, Radar, LayoutDashboard, Receipt, Mail, AtSign,
  Calculator, Users, Paperclip, Share2, Archive, Send, Percent, Bell, ClipboardList,
  RotateCcw, AlertTriangle, Landmark, Filter, ListChecks, Database, Wallet, StickyNote,
  Table, Compass, Navigation, TrendingUp, GitBranch, Crown, Coins, PiggyBank, ScanLine,
  FileSpreadsheet, ShieldCheck, Repeat, Bookmark, Rocket, Target, Lock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ============================================================================
 * Ícones dos nós da árvore.
 *
 * A automação guarda o nome do ícone na coluna `icone` (escolhido no editor).
 * Quando está vazio, `iconeDe` deduz pelo nome da automação — assim um nó novo
 * nunca nasce com o ícone genérico de categoria.
 * ========================================================================== */

export const ICONES: Record<string, LucideIcon> = {
  Zap, Brain, Bot, Sparkles, Banknote, FileText, FileSearch, BarChart3, ArrowRightLeft,
  MessageSquare, MessageCircle, CalendarCheck, Radar, LayoutDashboard, Receipt, Mail, AtSign,
  Calculator, Users, Paperclip, Share2, Archive, Send, Percent, Bell, ClipboardList,
  RotateCcw, AlertTriangle, Landmark, Filter, ListChecks, Database, Wallet, StickyNote,
  Table, Compass, Navigation, TrendingUp, GitBranch, Crown, Coins, PiggyBank, ScanLine,
  FileSpreadsheet, ShieldCheck, Repeat, Bookmark, Rocket, Target, Lock,
};

/** nome do ícone → rótulo curto no seletor do editor */
export const NOMES_ICONES = Object.keys(ICONES);

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/* Palavra encontrada no nome da automação → ícone. Ordem importa: o primeiro
   que casar vence, então os termos mais específicos vêm antes. */
const PALAVRAS: [RegExp, LucideIcon][] = [
  [/autonom|copiloto/, Crown],
  [/forecast|proje[cç]|previs/, TrendingUp],
  [/cenario/, GitBranch],
  [/categoriza/, Sparkles],
  [/agente|copilot|\bia\b|intelig/, Bot],
  [/dre|dfc|balanc/, BarChart3],
  [/tracker|planilh|cac\b/, Table],
  [/dashboard|finhub|receita/, LayoutDashboard],
  [/edital/, Radar],
  [/anexo/, Paperclip],
  [/backup|drive|arquiv/, Archive],
  // "erro" vem antes de "emissão": em "Relatório de Erros de Emissão" o que
  // importa é o alerta, não o envio.
  [/erro|falha|alerta/, AlertTriangle],
  [/emiss[aã]o|envio|enviar|dispar/, Send],
  [/nota|nf\b|nfs/, FileText],
  [/comiss/, Users],
  [/proporcion|percentu/, Percent],
  [/rescis|calcul/, Calculator],
  [/reembolso|recibo/, Receipt],
  [/estorno/, RotateCcw],
  [/limite|sicoob|banco|banc[aá]ri/, Landmark],
  [/extrato|caixa|saldo/, Wallet],
  [/filtr/, Filter],
  [/revis|confer|audit/, ShieldCheck],
  [/coment[aá]ri|observa/, StickyNote],
  [/calend[aá]ri|evento|agenda/, CalendarCheck],
  [/lembrete|aviso|notifica/, Bell],
  [/forms|formul[aá]ri|solicita/, ClipboardList],
  [/e-?mail|gmail/, Mail],
  [/whats|wpp|grupo|mensagem/, MessageCircle],
  [/relat[oó]ri/, FileSpreadsheet],
  [/pagamento|cobran[cç]|boleto|pix/, Banknote],
  [/concilia|de-?para|cruzamento/, ArrowRightLeft],
  [/rob[oô]|fluxo|pipeline/, Share2],
  [/consolida|agrupa/, ListChecks],
  [/omie|base|banco de dados/, Database],
];

/** Ícone do nó: o escolhido no editor, senão deduzido do nome, senão o raio. */
export function iconeDe(r: { icone?: string | null; automacao?: string | null }): LucideIcon {
  if (r.icone && ICONES[r.icone]) return ICONES[r.icone];
  const nome = semAcento(r.automacao || "");
  for (const [re, ic] of PALAVRAS) if (re.test(nome)) return ic;
  return Zap;
}

/** Nome do ícone que `iconeDe` escolheria — usado para pré-marcar o seletor. */
export function nomeIconeDe(r: { icone?: string | null; automacao?: string | null }): string {
  if (r.icone && ICONES[r.icone]) return r.icone;
  const escolhido = iconeDe(r);
  return NOMES_ICONES.find((n) => ICONES[n] === escolhido) ?? "Zap";
}
