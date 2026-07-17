// Controle de módulos do Hub (Financeiro × Facilities), baseado em profiles.cargo.
// Não há tabela de roles — o acesso é 100% por cargo (texto).

export type ModuleId = "financeiro" | "facilities";

export const MODULES: Record<ModuleId, { id: ModuleId; label: string; home: string }> = {
  financeiro: { id: "financeiro", label: "Hub Financeiro", home: "/" },
  facilities: { id: "facilities", label: "Facilities", home: "/facilities" },
};

// Cargos que enxergam os dois módulos e podem alternar entre eles.
const ADMIN_CARGOS = new Set(["ceo", "financeiro"]);
// Cargo travado exclusivamente no módulo Facilities (espelha "parcerias").
const FACILITIES_CARGO = "facilities";
const PARCERIAS_CARGO = "parcerias";

export function normCargo(cargo?: string | null): string {
  return (cargo ?? "").trim().toLowerCase();
}

export interface ModuleAccess {
  modules: ModuleId[];
  canSwitch: boolean;
  isAdmin: boolean;
  facilitiesOnly: boolean;
  parceriasOnly: boolean;
}

export function moduleAccess(cargo?: string | null): ModuleAccess {
  const c = normCargo(cargo);
  if (c === PARCERIAS_CARGO) {
    return { modules: [], canSwitch: false, isAdmin: false, facilitiesOnly: false, parceriasOnly: true };
  }
  if (c === FACILITIES_CARGO) {
    return { modules: ["facilities"], canSwitch: false, isAdmin: false, facilitiesOnly: true, parceriasOnly: false };
  }
  if (ADMIN_CARGOS.has(c)) {
    return { modules: ["financeiro", "facilities"], canSwitch: true, isAdmin: true, facilitiesOnly: false, parceriasOnly: false };
  }
  // Demais cargos (ex.: RPA): só o Hub Financeiro.
  return { modules: ["financeiro"], canSwitch: false, isAdmin: false, facilitiesOnly: false, parceriasOnly: false };
}

// Módulo atual inferido pela rota.
export function currentModule(pathname: string): ModuleId {
  return pathname.startsWith("/facilities") ? "facilities" : "financeiro";
}
