// O cálculo das métricas que o Takeat OS deixa vazias mora em
// `supabase/functions/_shared/indicadores-os-calculo.ts`: a mesma conta roda na tela e na
// Edge Function que alimenta o Assistente e a Revisão do Mês.
export {
  avaliar, completarMensal, ehSomaPura, parseFormula, refsDe, CUSTO_POR_REF, FORA_DO_CAC,
  type AssinaturaOS, type CustoOS, type No,
} from "../../supabase/functions/_shared/indicadores-os-calculo.ts";
