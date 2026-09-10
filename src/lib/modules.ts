// Quem vê o quê no Hub.
//
// ---------------------------------------------------------------------------
// POR QUE ISTO MUDOU (10/09/2026)
//
// O acesso saía de `profiles.cargo` — um campo de TEXTO LIVRE, digitado à mão na
// tela de Usuários — comparado contra cinco nomes conhecidos. Tudo o que não
// batesse caía no caso padrão, e o caso padrão era **o Hub Financeiro inteiro**.
// Ou seja: o portão liberava o que não sabia identificar.
//
// Isso não era teoria. Em 10/09/2026 entraram quatro pessoas ("Head de RH",
// "Head de Operações", "Head de Produto") e três contas de consultoria sem cargo
// nenhum. As sete enxergavam Captable, O Flip, os reportes ao conselho, os
// extratos, a Auditoria — e a tela de Usuários, de onde se cria e se exclui
// conta de qualquer um. E, pela mesma regra, a Head de RH era a única pessoa do
// Hub que NÃO via a folha, porque "Head de RH" não estava na lista.
//
// Duas decisões saíram daí:
//
// 1. CARGO E ACESSO VIRARAM COISAS SEPARADAS. `cargo` continua texto livre e
//    continua sendo o que aparece na tela — é o que a pessoa É. `perfil` é uma
//    lista FECHADA e é o que ela VÊ. "Head de Produto" e "Head de Operações" são
//    cargos diferentes com o mesmo acesso, e nenhuma trava sobrevive a uma
//    digitação diferente da esperada.
//
// 2. O PADRÃO PASSOU A SER O MÍNIMO. Perfil ausente ou desconhecido é
//    `restrito`: nenhuma capacidade. Errar para o lado de trancar dá um pedido
//    de ajuda; errar para o lado de abrir não dá aviso nenhum.
//
// ---------------------------------------------------------------------------
// ESCONDER NÃO É PROTEGER
//
// Este arquivo tira o item do menu e barra a rota digitada. Isso resolve a
// VISTA. Quem chama o PostgREST direto continua lendo a tabela: das 222 tabelas
// do banco, 220 têm RLS ligada e a policy de 206 delas é literalmente `true`
// para qualquer autenticado.
//
// A única capacidade com trava real hoje é `remuneracao`, pela função
// `pode_ver_remuneracao()` no Postgres — e ela precisa listar exatamente os
// mesmos perfis que a constante daqui. As duas listas andam juntas.

export type ModuleId = "financeiro" | "facilities";

export const MODULES: Record<ModuleId, { id: ModuleId; label: string; home: string }> = {
  financeiro: { id: "financeiro", label: "Hub Financeiro", home: "/" },
  facilities: { id: "facilities", label: "Facilities", home: "/facilities" },
};

/**
 * As capacidades — conjuntos de telas que sempre andam juntas.
 *
 * O corte é por ASSUNTO e por sensibilidade, não por menu: `tesouraria` (saldo
 * em banco) e `conciliacao` (o que se confere lançamento a lançamento) moram no
 * mesmo grupo da barra lateral e têm públicos diferentes, então são duas.
 */
export type Capacidade =
  | "metricas"       // Dashboard, Assinaturas, Estornos, Painel CAC
  | "tesouraria"     // Briefing, Caixa, Asaas
  | "conciliacao"    // Cartão→Omie, Notas Fiscais, Auditoria, Notas no ERP, Cartão (OFX)
  | "demonstracoes"  // DRE, DFC, Balancete, Balanço
  | "planejamento"   // BP, Cenários, Histórico Multianual
  | "orcamento"      // Orçamento
  | "societario"     // Captable, O Flip, Takeat LTD/LLC
  | "apresentacoes"  // Revisão Mensal, Reportes
  | "editais"        // Radar de Editais, Projetos Aprovados
  | "remuneracao"    // Remuneração, Colaboradores (RH), Rescisões, Variável, Proporcionais, Reembolsos
  | "time"           // Tarefas, Projetos, Anotações
  | "biblioteca"     // Visão do Time, Biblioteca
  | "maquinario"     // Monitoramento, Parametrização, Uso de IA, Recargas, Vigilância
  | "usuarios"       // Usuários
  | "parceiros"      // Parceiros
  | "facilities";    // o módulo Facilities inteiro

export type PerfilId =
  | "admin" | "diretoria" | "lideranca" | "rh"
  | "automacao" | "facilities" | "parcerias" | "externo" | "restrito";

export interface DefPerfil {
  id: PerfilId;
  label: string;
  /** Uma linha, mostrada ao lado do seletor na tela de Usuários. */
  resumo: string;
  /** Onde esta pessoa cai ao entrar, e para onde volta ao pedir uma rota vedada. */
  home: string;
  /**
   * Gente da Takeat.
   *
   * O que isto guarda hoje é o ASSISTENTE — a bolinha que responde sobre
   * qualquer coisa do negócio, com o contexto organizacional inteiro no prompt.
   * Sem esta distinção, restringir as telas de um convidado não adiantaria nada:
   * ele perguntaria à IA o que a tela não mostra, e ela responderia.
   */
  deCasa: boolean;
  capacidades: readonly Capacidade[];
}

/**
 * A matriz, em oito linhas.
 *
 * A ORDEM é da maior para a menor amplitude — é como a tela de Usuários mostra o
 * seletor, e ler de cima para baixo deve ser ler "do mais para o menos".
 */
export const PERFIS: Record<PerfilId, DefPerfil> = {
  admin: {
    id: "admin", label: "Admin", home: "/", deCasa: true,
    resumo: "Tudo, sem exceção. Opera, aprova e configura.",
    capacidades: [
      "metricas", "tesouraria", "conciliacao", "demonstracoes", "planejamento",
      "orcamento", "societario", "apresentacoes", "editais", "remuneracao",
      "time", "biblioteca", "maquinario", "usuarios", "parceiros", "facilities",
    ],
  },
  diretoria: {
    id: "diretoria", label: "Diretoria", home: "/", deCasa: true,
    resumo: "Todo o número consolidado e o societário. Não opera a rotina do financeiro.",
    capacidades: [
      "metricas", "tesouraria", "demonstracoes", "planejamento", "orcamento",
      "societario", "apresentacoes", "editais", "remuneracao", "time",
      "biblioteca", "parceiros",
    ],
  },
  lideranca: {
    id: "lideranca", label: "Liderança", home: "/", deCasa: true,
    resumo: "Resultado e métricas de cliente. Sem societário, sem banco, sem folha.",
    capacidades: ["metricas", "demonstracoes", "planejamento", "orcamento"],
  },
  rh: {
    id: "rh", label: "RH", home: "/operacional/remuneracao", deCasa: true,
    resumo: "Pessoas e o que se paga a elas. Sem DRE, sem BP, sem captable.",
    capacidades: ["remuneracao", "biblioteca"],
  },
  automacao: {
    id: "automacao", label: "Automação", home: "/monitoramento", deCasa: true,
    resumo: "O maquinário: crons, integrações, projetos, recargas. Sem os números do negócio.",
    capacidades: ["time", "maquinario", "biblioteca"],
  },
  facilities: {
    id: "facilities", label: "Facilities", home: "/facilities", deCasa: true,
    resumo: "Só o módulo Facilities.",
    capacidades: ["facilities"],
  },
  parcerias: {
    id: "parcerias", label: "Parcerias", home: "/operacional/parceiros", deCasa: true,
    resumo: "Só a tela de Parceiros.",
    capacidades: ["parceiros"],
  },
  externo: {
    id: "externo", label: "Externo (consultoria)", home: "/demonstracoes/dre", deCasa: false,
    resumo: "Convidado de fora: demonstrações e plano, nada mais.",
    capacidades: ["demonstracoes", "planejamento"],
  },
  restrito: {
    id: "restrito", label: "Sem acesso", home: "/", deCasa: false,
    resumo: "Conta criada, acesso ainda não definido. Não abre nenhuma tela.",
    capacidades: [],
  },
};

/** Os perfis que a tela de Usuários oferece — `restrito` não se escolhe, se cai nele. */
export const PERFIS_ESCOLHIVEIS: readonly DefPerfil[] = [
  PERFIS.admin, PERFIS.diretoria, PERFIS.lideranca, PERFIS.rh,
  PERFIS.automacao, PERFIS.facilities, PERFIS.parcerias, PERFIS.externo,
];

/**
 * Perfis que enxergam remuneração individual.
 *
 * Metade de cima da trava — esconde. A metade que PROTEGE é a policy
 * `pode_ver_remuneracao()` no Postgres, que precisa listar exatamente estes
 * mesmos nomes.
 */
export const PERFIS_REMUNERACAO: readonly PerfilId[] =
  (Object.values(PERFIS) as DefPerfil[])
    .filter((p) => p.capacidades.includes("remuneracao"))
    .map((p) => p.id);

export function normCargo(cargo?: string | null): string {
  return (cargo ?? "").trim().toLowerCase();
}

function ehPerfil(v: unknown): v is PerfilId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PERFIS, v);
}

/**
 * O de-para do cargo antigo — usado só em dois momentos: o backfill da migration
 * e a janela em que o front já subiu e a coluna `perfil` ainda não existe.
 *
 * Repare que ele NÃO reproduz o padrão antigo: cargo fora da lista vira
 * `restrito`, não "Hub inteiro". É de propósito — se o banco estiver atrasado, o
 * Hub tranca e alguém avisa, em vez de continuar aberto em silêncio.
 */
export function perfilPorCargo(cargo?: string | null): PerfilId {
  switch (normCargo(cargo)) {
    case "ceo":
    case "financeiro":   return "admin";
    case "diretoria":    return "diretoria";
    case "facilities":   return "facilities";
    case "parcerias":    return "parcerias";
    default:             return "restrito";
  }
}

export type PerfilPortador = { cargo?: string | null; perfil?: PerfilId | string | null } | null | undefined;

/**
 * O perfil desta pessoa.
 *
 * `perfil === undefined` significa que a COLUNA não veio no `select *` — o banco
 * ainda não tem a migration. Só nesse caso vale o cargo. `perfil === null` é
 * coluna existente e vazia: conta sem acesso definido, e isso é `restrito`.
 */
export function perfilDe(p: PerfilPortador): PerfilId {
  if (!p) return "restrito";
  if (p.perfil === undefined) return perfilPorCargo(p.cargo);
  return ehPerfil(p.perfil) ? p.perfil : "restrito";
}

export interface Acesso {
  perfil: PerfilId;
  def: DefPerfil;
  capacidades: ReadonlySet<Capacidade>;
  modules: ModuleId[];
  canSwitch: boolean;
  isAdmin: boolean;
  facilitiesOnly: boolean;
  parceriasOnly: boolean;
  /** Onde esta pessoa cai ao entrar, e para onde volta ao pedir uma rota vedada. */
  home: string;
  /** Nenhuma capacidade: a conta existe e ainda não foi liberada para nada. */
  semAcesso: boolean;
  /** Gente da Takeat — hoje é o que decide quem tem o Assistente. */
  deCasa: boolean;
  /** Atalho preservado — a pergunta "vê quanto fulano ganha?" aparece em várias telas. */
  remuneracao: boolean;
}

export function acessoDe(p: PerfilPortador): Acesso {
  const perfil = perfilDe(p);
  const def = PERFIS[perfil];
  const capacidades = new Set(def.capacidades);

  const modules: ModuleId[] = [];
  if (capacidades.has("facilities")) modules.push("facilities");
  // Quem tem qualquer capacidade que não seja Facilities está no Hub Financeiro.
  const temFinanceiro = def.capacidades.some((c) => c !== "facilities");
  if (temFinanceiro) modules.unshift("financeiro");

  return {
    perfil, def, capacidades, modules,
    canSwitch: modules.length > 1,
    isAdmin: perfil === "admin",
    facilitiesOnly: perfil === "facilities",
    parceriasOnly: perfil === "parcerias",
    home: def.home,
    semAcesso: capacidades.size === 0,
    deCasa: def.deCasa,
    remuneracao: capacidades.has("remuneracao"),
  };
}

export function podeVer(acesso: Acesso, c: Capacidade): boolean {
  return acesso.capacidades.has(c);
}

/**
 * O PORTÃO — de que capacidade cada rota depende.
 *
 * É UMA lista só, e é dela que sai TANTO o filtro do menu quanto a trava da rota
 * digitada (ver `podeVerRota`). Quando eram duas listas, a tela sumia do menu e
 * continuava respondendo pela URL — que é o pior dos dois mundos, porque parece
 * protegida.
 *
 * A primeira entrada que casa decide, então **o mais específico vem primeiro**:
 * `/briefing/novidades` está acima de `/briefing` justamente para escapar dele.
 *
 * `null` = livre para qualquer pessoa com conta. Rota que não aparece aqui
 * também é livre — vale para as telas de diagnóstico (`/design-system`,
 * `/assistente/*`), que não mostram dado do negócio. Ao criar uma rota que
 * mostre dado, ACRESCENTE A ENTRADA AQUI; o teste `modules.test.ts` cobre todos
 * os itens de menu, mas não adivinha uma tela fora do menu.
 */
const PORTAO: ReadonlyArray<readonly [string, Capacidade | null]> = [
  // Início
  ["/briefing/novidades", null],
  ["/briefing", "tesouraria"],
  ["/caixa", "tesouraria"],
  ["/asaas", "tesouraria"],
  ["/assinaturas", "metricas"],
  ["/dashboard-legacy", "metricas"],
  ["/operacional/parceiros", "parceiros"],

  // Time
  ["/tarefas", "time"],
  ["/automacoes/projetos", "time"],
  ["/playbook", "time"],
  ["/notas", "time"],
  ["/time/visao", "biblioteca"],
  ["/analise/conhecimento", "biblioteca"],
  ["/automacoes/catalogo", "biblioteca"],

  // Apresentações
  ["/apresentacoes", "apresentacoes"],

  // Operacional — folha e pessoas
  ["/operacional/remuneracao", "remuneracao"],
  ["/operacional/colaboradores", "remuneracao"],
  ["/operacional/variavel", "remuneracao"],
  ["/operacional/reembolsos", "remuneracao"],
  ["/automacoes/proporcionais", "remuneracao"],
  ["/governanca/rescisoes", "remuneracao"],

  // Operacional — conciliação
  ["/operacional/cartao", "conciliacao"],
  ["/operacional/notas-fiscais", "conciliacao"],
  ["/governanca/auditoria", "conciliacao"],
  ["/governanca/notas-erp", "conciliacao"],
  ["/governanca/cartao", "conciliacao"],
  ["/extratos", "conciliacao"],

  // Métricas de cliente
  ["/operacional/estornos", "metricas"],
  ["/governanca/cac", "metricas"],

  // Números
  ["/demonstracoes", "demonstracoes"],
  ["/bp", "planejamento"],
  ["/analise/cenarios", "planejamento"],
  ["/analise/historico", "planejamento"],
  ["/analise/bp", "planejamento"],
  ["/orcamento", "orcamento"],
  ["/captable", "societario"],
  ["/investimentos", "societario"],
  ["/editais", "editais"],

  // Maquinário
  ["/monitoramento", "maquinario"],
  ["/automacoes/painel", "maquinario"],
  ["/configuracoes/parametrizacao", "maquinario"],
  ["/configuracoes/integracoes", "maquinario"],
  ["/configuracoes/uso-ia", "maquinario"],
  ["/recargas", "maquinario"],
  ["/governanca/vigilancia", "maquinario"],
  /* A memória do Assistente guarda o que a IA aprendeu nas conversas — número,
     nome de fornecedor, o que se decidiu. É conteúdo do negócio, não tela de
     diagnóstico, e ficava livre para todo mundo. */
  ["/assistente/memoria", "maquinario"],

  // Administração
  ["/usuarios", "usuarios"],

  // Módulo Facilities
  ["/facilities", "facilities"],
];

/** De que capacidade esta rota depende — `null` quando é livre. */
export function capacidadeDaRota(pathname: string): Capacidade | null {
  if (pathname === "/") return "metricas";
  for (const [prefixo, cap] of PORTAO) {
    if (pathname === prefixo || pathname.startsWith(prefixo + "/")) return cap;
  }
  return null;
}

/** Esta pessoa pode abrir esta rota? */
export function podeVerRota(acesso: Acesso, pathname: string): boolean {
  // Sem capacidade nenhuma, nada abre — nem o que é livre. A conta existe, o
  // acesso não; o AppLayout mostra o aviso em vez de rodar a página.
  if (acesso.semAcesso) return false;
  const cap = capacidadeDaRota(pathname);
  return cap === null || acesso.capacidades.has(cap);
}

// Módulo atual inferido pela rota.
export function currentModule(pathname: string): ModuleId {
  return pathname.startsWith("/facilities") ? "facilities" : "financeiro";
}
