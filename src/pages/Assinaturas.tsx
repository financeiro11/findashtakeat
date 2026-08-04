// /assinaturas — duas visões da mesma carteira, em abas:
//   • Recorrência: a base ativa do Asaas (MRR, mix, top contratos) — `assinaturas_snapshot`
//   • Churn: o que saiu da base no mês, pela planilha da diretoria — `churn_snapshot`
// As duas se encontram no MRR: a base de um mês de churn é o snapshot de recorrência do
// mês anterior (a aba Churn mostra essa amarração no card "Da carteira ao churn").

import { useState } from "react";
import type { Aba } from "./assinaturas/fmt";
import Recorrencia from "./assinaturas/Recorrencia";
import Churn from "./assinaturas/Churn";

export default function Assinaturas() {
  const [aba, setAba] = useState<Aba>("recorrencia");

  return aba === "churn"
    ? <Churn aba={aba} setAba={setAba} />
    : <Recorrencia aba={aba} setAba={setAba} />;
}
