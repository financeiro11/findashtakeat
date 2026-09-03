// Controle de módulos do Hub (Financeiro × Facilities), baseado em profiles.cargo.
// Não há tabela de roles — o acesso é 100% por cargo (texto).

export type ModuleId = "financeiro" | "facilities";

export const MODULES: Record<ModuleId, { id: ModuleId; label: string; home: string }> = {
  financeiro: { id: "financeiro", label: "Hub Financeiro", home: "/" },
  facilities: { id: "facilities", label: "Facilities", home: "/facilities" },
};

// Cargos que enxergam os dois módulos e podem alternar entre eles.
const ADMIN_CARGOS = new Set(["ceo", "financeiro", "diretoria"]);
// Cargo travado exclusivamente no módulo Facilities (espelha "parcerias").
const FACILITIES_CARGO = "facilities";
const PARCERIAS_CARGO = "parcerias";

/**
 * Cargos que enxergam remuneração individual — o painel de Remuneração e a
 * coluna de valor da aba Colaboradores.
 *
 * Conjunto SEPARADO de `ADMIN_CARGOS` mesmo tendo os mesmos nomes hoje: um
 * responde "vê os dois módulos?", o outro responde "vê quanto fulano ganha?".
 * São perguntas diferentes e vão divergir no dia em que alguém precisar do Hub
 * inteiro sem precisar do salário de ninguém.
 *
 * Isto é a metade de cima da trava: esconde o que não pode ser visto. A metade
 * que PROTEGE é a policy `pode_ver_remuneracao()` no Postgres, que precisa
 * listar exatamente estes cargos — as duas listas andam juntas.
 */
const REMUNERACAO_CARGOS = new Set(["ceo", "financeiro", "diretoria"]);

export function normCargo(cargo?: string | null): string {
  return (cargo ?? "").trim().toLowerCase();
}

export interface ModuleAccess {
  modules: ModuleId[];
  canSwitch: boolean;
  isAdmin: boolean;
  facilitiesOnly: boolean;
  parceriasOnly: boolean;
  /** Vê remuneração individual (painel de Remuneração e aba Colaboradores). */
  remuneracao: boolean;
}

export function moduleAccess(cargo?: string | null): ModuleAccess {
  const c = normCargo(cargo);
  const remuneracao = REMUNERACAO_CARGOS.has(c);
  if (c === PARCERIAS_CARGO) {
    return { modules: [], canSwitch: false, isAdmin: false, facilitiesOnly: false, parceriasOnly: true, remuneracao };
  }
  if (c === FACILITIES_CARGO) {
    return { modules: ["facilities"], canSwitch: false, isAdmin: false, facilitiesOnly: true, parceriasOnly: false, remuneracao };
  }
  if (ADMIN_CARGOS.has(c)) {
    return { modules: ["financeiro", "facilities"], canSwitch: true, isAdmin: true, facilitiesOnly: false, parceriasOnly: false, remuneracao };
  }
  // Demais cargos (ex.: RPA): só o Hub Financeiro, e sem remuneração.
  return { modules: ["financeiro"], canSwitch: false, isAdmin: false, facilitiesOnly: false, parceriasOnly: false, remuneracao };
}

// Módulo atual inferido pela rota.
export function currentModule(pathname: string): ModuleId {
  return pathname.startsWith("/facilities") ? "facilities" : "financeiro";
}
