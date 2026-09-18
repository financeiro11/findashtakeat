// O cálculo das métricas que o Takeat OS deixa vazias mora em
// `supabase/functions/_shared/indicadores-os-calculo.ts`: a mesma conta roda na tela e na
// Edge Function que alimenta o Assistente e a Revisão do Mês.
export {
  avaliar, completarMensal, ehSomaPura, escrever, explicar, idsSensiveis, inconsistenciasDoMes, parseFormula, refsDe,
  textoParaEnviar, CUSTO_POR_REF, FORA_DO_CAC, TITULO_INCONSISTENCIA,
  type AssinaturaOS, type CustoOS, type No, type Explicacao, type EntradaExplicada, type CustoExplicado,
  type Inconsistencia, type TipoInconsistencia,
} from "../../supabase/functions/_shared/indicadores-os-calculo.ts";
