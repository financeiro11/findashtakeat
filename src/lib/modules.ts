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
  | "facilities"     // o módulo Facilities inteiro
  | "assistente";    // a bolinha da IA — não é tela, é a conversa

/**
 * O texto de cada capacidade na tela de Perfis de acesso.
 *
 * As TELAS de cada uma não estão aqui de propósito: saem do `PORTAO`, cruzado
 * com o catálogo de navegação (ver `telasDaCapacidade`). Escrever a lista à mão
 * seria um terceiro lugar para a mesma verdade, e o terceiro sempre é o que
 * envelhece.
 */
export const CAPACIDADES: Record<Capacidade, { label: string; descricao: string }> = {
  metricas:      { label: "Métricas de cliente", descricao: "Dashboard, MRR, churn, estornos e aquisição." },
  tesouraria:    { label: "Tesouraria",          descricao: "Saldo em banco, cobranças e o briefing do dia." },
  conciliacao:   { label: "Conciliação",         descricao: "O que se confere lançamento a lançamento: auditoria, cartão, notas." },
  demonstracoes: { label: "Demonstrações",       descricao: "DRE, DFC, balancete e balanço." },
  planejamento:  { label: "Plano e projeções",   descricao: "BP, cenários e histórico multianual." },
  orcamento:     { label: "Orçamento",           descricao: "Orçado × realizado. Sem recorte por centro de custo." },
  societario:    { label: "Societário",          descricao: "Captable, o flip e as empresas no exterior. O dado mais sensível." },
  apresentacoes: { label: "Apresentações",       descricao: "Revisão mensal e o material de conselho e investidores." },
  editais:       { label: "Editais",             descricao: "Radar de fomento e projetos aprovados." },
  remuneracao:   { label: "Pessoas e folha",     descricao: "Salário por pessoa, rescisões, comissões e reembolsos." },
  time:          { label: "Time e tarefas",      descricao: "Kanban, projetos e anotações." },
  biblioteca:    { label: "Biblioteca",          descricao: "Estrutura do time, cargos, políticas e fornecedores." },
  maquinario:    { label: "Maquinário",          descricao: "Crons, integrações, credenciais, recargas e vigilância." },
  usuarios:      { label: "Administração",       descricao: "Esta tela: quem entra no Hub e o que cada perfil vê." },
  parceiros:     { label: "Parceiros",           descricao: "Embaixadores e bonificação." },
  facilities:    { label: "Facilities",          descricao: "O módulo de compras inteiro." },
  assistente:    { label: "Assistente (IA)",     descricao: "A bolinha que responde sobre o negócio inteiro. Não é tela: é conversa, e ela sabe o que a tela não mostra." },
};

/** A ordem em que as capacidades aparecem na tela de Perfis de acesso. */
export const CAPACIDADES_ORDEM: readonly Capacidade[] = [
  "metricas", "tesouraria", "conciliacao", "demonstracoes", "planejamento",
  "orcamento", "societario", "apresentacoes", "editais", "remuneracao",
  "time", "biblioteca", "maquinario", "parceiros", "facilities",
  "usuarios", "assistente",
];

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
   * O PADRÃO deste perfil.
   *
   * Desde 10/09/2026 quem manda em produção é a tabela `acesso_perfil`, editada
   * em Configurações › Usuários › Perfis de acesso. Isto aqui continua sendo a
   * matriz de referência: é o que vale para perfil sem linha na tabela, e é o
   * que o Hub usa se a leitura falhar. Um default que se audita lendo um
   * arquivo é melhor do que um default vazio (que trancaria tudo) ou cheio (que
   * abriria tudo).
   */
  capacidades: readonly Capacidade[];
}

/**
 * A matriz de referência, em oito linhas.
 *
 * A ORDEM é da maior para a menor amplitude — é como a tela de Usuários mostra o
 * seletor, e ler de cima para baixo deve ser ler "do mais para o menos".
 */
export const PERFIS: Record<PerfilId, DefPerfil> = {
  admin: {
    id: "admin", label: "Admin", home: "/",
    resumo: "Tudo, sem exceção. Opera, aprova e configura.",
    capacidades: [
      "metricas", "tesouraria", "conciliacao", "demonstracoes", "planejamento",
      "orcamento", "societario", "apresentacoes", "editais", "remuneracao",
      "time", "biblioteca", "maquinario", "usuarios", "parceiros", "facilities",
      "assistente",
    ],
  },
  diretoria: {
    id: "diretoria", label: "Diretoria", home: "/",
    resumo: "Todo o número consolidado e o societário. Não opera a rotina do financeiro.",
    capacidades: [
      "metricas", "tesouraria", "demonstracoes", "planejamento", "orcamento",
      "societario", "apresentacoes", "editais", "remuneracao", "time",
      "biblioteca", "parceiros", "assistente",
    ],
  },
  lideranca: {
    id: "lideranca", label: "Liderança", home: "/",
    resumo: "Resultado e métricas de cliente. Sem societário, sem banco, sem folha.",
    capacidades: ["metricas", "demonstracoes", "planejamento", "orcamento", "assistente"],
  },
  rh: {
    id: "rh", label: "RH", home: "/operacional/remuneracao",
    resumo: "Pessoas e o que se paga a elas. Sem DRE, sem BP, sem captable.",
    capacidades: ["remuneracao", "biblioteca", "assistente"],
  },
  automacao: {
    id: "automacao", label: "Automação", home: "/monitoramento",
    resumo: "O maquinário: crons, integrações, projetos, recargas. Sem os números do negócio.",
    capacidades: ["time", "maquinario", "biblioteca", "assistente"],
  },
  facilities: {
    id: "facilities", label: "Facilities", home: "/facilities",
    resumo: "Só o módulo Facilities.",
    capacidades: ["facilities"],
  },
  parcerias: {
    id: "parcerias", label: "Parcerias", home: "/operacional/parceiros",
    resumo: "Só a tela de Parceiros.",
    capacidades: ["parceiros"],
  },
  externo: {
    id: "externo", label: "Externo (consultoria)", home: "/demonstracoes/dre",
    resumo: "Convidado de fora: demonstrações e plano, nada mais.",
    capacidades: ["demonstracoes", "planejamento"],
  },
  restrito: {
    id: "restrito", label: "Sem acesso", home: "/",
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
 * Perfis que enxergam remuneração individual, POR PADRÃO.
 *
 * Não é mais a palavra final: quem manda é a linha de `acesso_perfil`, e a
 * policy `pode_ver_remuneracao()` lê essa mesma linha — as duas metades da trava
 * andam juntas porque leem a mesma fonte, e não porque duas listas foram
 * mantidas em sincronia à mão.
 */
export const PERFIS_REMUNERACAO: readonly PerfilId[] =
  (Object.values(PERFIS) as DefPerfil[])
    .filter((p) => p.capacidades.includes("remuneracao"))
    .map((p) => p.id);

/**
 * A matriz vinda do banco (tabela `acesso_perfil`).
 *
 * Parcial de propósito: perfil ausente usa o padrão de `PERFIS`. `null`/undefined
 * na matriz inteira significa "ainda não carregou, ou a leitura falhou" — e aí
 * vale o código, que é a matriz revisada e auditável do repositório.
 */
export type MatrizAcesso = Partial<Record<PerfilId, readonly Capacidade[]>>;

/** As capacidades válidas, para filtrar o que vier do banco. */
const CAPACIDADE_VALIDA = new Set<string>(CAPACIDADES_ORDEM);

/** Converte as linhas de `acesso_perfil` na matriz, descartando o que não reconhece. */
export function matrizDeLinhas(
  linhas: ReadonlyArray<{ perfil: string; capacidades: string[] | null }> | null | undefined,
): MatrizAcesso {
  const m: MatrizAcesso = {};
  for (const l of linhas ?? []) {
    if (!ehPerfil(l.perfil) || l.perfil === "restrito") continue;
    m[l.perfil] = (l.capacidades ?? []).filter((c): c is Capacidade => CAPACIDADE_VALIDA.has(c));
  }
  return m;
}

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
  /** Fala com a IA. Não é tela — ela responde o que a tela não mostra. */
  assistente: boolean;
  /** Atalho preservado — a pergunta "vê quanto fulano ganha?" aparece em várias telas. */
  remuneracao: boolean;
}

export function acessoDe(p: PerfilPortador, matriz?: MatrizAcesso | null): Acesso {
  const perfil = perfilDe(p);
  const def = PERFIS[perfil];

  /* O ADMIN NÃO SE EDITA. A tela esconde os checkboxes dele e o trigger
     `acesso_perfil_guarda` devolve a linha cheia — mas a garantia mora aqui
     também, porque é aqui que o Hub decide. Sem isso, uma linha estragada no
     banco trancaria quem precisa consertá-la. */
  const doBanco = perfil === "admin" || perfil === "restrito" ? undefined : matriz?.[perfil];
  const capacidades = new Set<Capacidade>(doBanco ?? def.capacidades);

  const modules: ModuleId[] = [];
  if (capacidades.has("facilities")) modules.push("facilities");
  // Quem tem qualquer capacidade que não seja Facilities está no Hub Financeiro.
  const temFinanceiro = [...capacidades].some((c) => c !== "facilities" && c !== "assistente");
  if (temFinanceiro) modules.unshift("financeiro");

  return {
    perfil, def, capacidades, modules,
    canSwitch: modules.length > 1,
    isAdmin: perfil === "admin",
    facilitiesOnly: perfil === "facilities",
    parceriasOnly: perfil === "parcerias",
    /* `home` cai para a primeira rota que este perfil ALCANÇA quando a home do
       padrão foi fechada pela matriz do banco — tirar "Pessoas e folha" do RH
       deixaria a home dele em /operacional/remuneracao, e o AppLayout
       redirecionaria para uma rota vedada, em laço. */
    home: capacidades.size === 0 ? def.home : homeAlcancavel(def.home, capacidades),
    semAcesso: capacidades.size === 0,
    assistente: capacidades.has("assistente"),
    remuneracao: capacidades.has("remuneracao"),
  };
}

/** A home do perfil, se ele ainda a alcança; senão, a primeira rota que alcança. */
function homeAlcancavel(home: string, capacidades: ReadonlySet<Capacidade>): string {
  const capHome = capacidadeDaRota(home);
  if (capHome === null || capacidades.has(capHome)) return home;
  for (const [prefixo, cap] of PORTAO) {
    if (cap !== null && capacidades.has(cap)) return prefixo;
  }
  return home;
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
