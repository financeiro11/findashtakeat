// O endereço oficial do CNPJ quando a BrasilAPI fecha a porta.
//
// O PROBLEMA, MEDIDO. `omie-clientes-criar` monta o cadastro do tomador a partir
// da Receita (BrasilAPI `/cnpj`), e a BrasilAPI limita por IP: na primeira
// passada, 10 de 22 clientes de um bloco voltaram com 429/403. O código faz a
// coisa certa ao apanhar — PULA o cliente em vez de gravar um endereço inventado
// —, mas o efeito é que a fila anda no ritmo da parede: cada janela de cron
// devolve algumas dezenas e o resto espera o relógio. Com 277 notas presas em
// status 003 (E0240 "CEP não pertence ao município" e E0921 "código do
// município"), esperar o relógio custa nota fiscal não emitida.
//
// A SAÍDA É A MESMA INFORMAÇÃO POR OUTRA PORTA. O cadastro do CNPJ é público e
// está publicado em páginas de consulta abertas; lê-las custa 1 crédito de
// raspagem e não passa pelo limite por IP da BrasilAPI. É estritamente um
// PLANO B: a BrasilAPI vai primeiro, sempre, porque é dado estruturado da
// fonte; a raspagem só entra quando ela recusa.
//
// E O DADO ENTRA MARCADO. `fonte: "firecrawl"` acompanha o cadastro até a tela
// de correção — quem confere precisa saber que aquele endereço veio de uma
// página de terceiro, não do JSON da Receita. Marcado, mas de posto igual ao da
// Receita na hora de decidir se pode escrever no Omie: os dois são o cadastro
// federal, e recusar este seria manter a nota presa por preciosismo de origem.
//
// O QUE NÃO VEM DAQUI: o código IBGE do município. Essas páginas não o publicam,
// e é ele que resolve o E0921. Quem o traz é o CEP (BrasilAPI ou ViaCEP), que
// não custa crédito nenhum — ver `ibgePeloCep` em `omie-clientes-criar`.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateJSON, MODELO_LITE } from "./gemini.ts";
import { podeGastar, raspar, registrarGasto } from "./firecrawl.ts";

export interface CnpjPublico {
  razao_social: string;
  nome_fantasia: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  situacao: string;
  /** De onde veio, para o rastro do cadastro. */
  origem: string;
}

/**
 * AS PÁGINAS, EM ORDEM. A primeira é HTML servido pronto (barato de renderizar);
 * a segunda é aplicação que monta no navegador e por isso pede `waitFor`.
 *
 * DUAS, E NÃO CINCO. Cada tentativa custa um crédito mesmo quando a página vem
 * vazia — encadear cinco fontes transformaria um CNPJ difícil num buraco de
 * cinco créditos, e são justamente os difíceis que se repetem na fila. Se as
 * duas falharem, o certo é devolver "não consegui" e deixar o cliente pendente,
 * que é exatamente o que já acontecia antes deste módulo existir.
 */
const PAGINAS: Array<{ url: (doc: string) => string; waitFor?: number }> = [
  { url: (d) => `https://cnpj.biz/${d}` },
  { url: (d) => `https://casadosdados.com.br/solucao/cnpj/${d}`, waitFor: 3000 },
];

const SCHEMA = {
  type: "object",
  properties: {
    razao_social: { type: "string" },
    nome_fantasia: { type: "string" },
    logradouro: { type: "string", description: "Tipo e nome da via, como 'RUA JOSE FARIAS'. Sem o número." },
    numero: { type: "string" },
    complemento: { type: "string" },
    bairro: { type: "string" },
    municipio: { type: "string", description: "Só o nome da cidade, sem a UF" },
    uf: { type: "string", description: "Sigla de 2 letras" },
    cep: { type: "string", description: "Só os 8 dígitos" },
    situacao: { type: "string", description: "Situação cadastral: ATIVA, BAIXADA, SUSPENSA..." },
  },
  required: ["razao_social", "municipio", "uf", "cep"],
};

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const limpo = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");

/**
 * A página virou endereço? Só se der para EMITIR com ele.
 *
 * A validação é dura de propósito. Página de consulta de CNPJ que não achou o
 * documento devolve um texto bonito ("nenhum resultado", "consulte outro CNPJ")
 * e a IA, obediente, extrai campos vazios — que gravados viram exatamente a nota
 * presa que este módulo existe para evitar. Sem município, sem UF de duas letras
 * e sem CEP de oito dígitos não há cadastro, e o certo é dizer que não houve.
 */
function valido(d: Partial<CnpjPublico> | null): d is CnpjPublico {
  if (!d) return false;
  return limpo(d.municipio).length > 1
    && limpo(d.uf).length === 2
    && soDigitos(d.cep).length === 8
    && limpo(d.razao_social).length > 2;
}

/** Dias que a leitura vale no cache. Cadastro de CNPJ muda de mês em mês, não de
 *  hora em hora — e reler o mesmo documento na semana seguinte é pagar duas
 *  vezes pela mesma informação, que é o desperdício mais fácil de evitar aqui. */
const VALIDADE_DIAS = 60;

export interface Consulta {
  dados: CnpjPublico | null;
  /** Em português: ou o que se achou, ou por que não se foi atrás. */
  motivo: string;
  /** Quantos créditos esta consulta pediu (0 quando veio do cache). */
  creditos: number;
  doCache: boolean;
}

export async function consultarCnpjPublico(supa: SupabaseClient, doc: string): Promise<Consulta> {
  const cnpj = soDigitos(doc);
  if (cnpj.length !== 14) return { dados: null, motivo: "não é um CNPJ de 14 dígitos", creditos: 0, doCache: false };

  /* 1. O CACHE. Antes do orçamento, porque cache não gasta e a pergunta "posso
        gastar?" custa uma consulta de saldo. */
  const { data: guardado } = await supa
    .from("cnpj_publico_cache").select("dados, lido_em").eq("doc", cnpj).maybeSingle();
  if (guardado?.dados) {
    const idade = (Date.now() - new Date(guardado.lido_em).getTime()) / 86_400_000;
    if (idade < VALIDADE_DIAS && valido(guardado.dados as any)) {
      return { dados: guardado.dados as CnpjPublico, motivo: `lido do cache (${Math.round(idade)} dias)`, creditos: 0, doCache: true };
    }
  }

  /* 2. O FREIO. Duas páginas no pior caso, então pede-se orçamento para duas —
        começar com uma e ficar sem crédito no meio gastaria a primeira à toa. */
  const v = await podeGastar(supa, "cadastro_cnpj", 2);
  if (!v.pode) return { dados: null, motivo: v.motivo, creditos: 0, doCache: false };

  let creditos = 0;
  const tropecos: string[] = [];

  for (const p of PAGINAS) {
    const url = p.url(cnpj);
    const { markdown, erro } = await raspar(url, { waitFor: p.waitFor, maxAge: 0, timeoutMs: 40_000 });
    creditos++;
    if (erro || markdown.length < 200) {
      tropecos.push(`${new URL(url).hostname}: ${erro ?? "página veio vazia"}`);
      continue;
    }
    try {
      const out = await generateJSON<Partial<CnpjPublico>>({
        /* O modelo leve: o trabalho é COPIAR campos de uma ficha para um schema
           fechado, não deliberar. Quem decide se o resultado presta é `valido`,
           em TypeScript, logo abaixo. */
        model: MODELO_LITE,
        messages: [
          {
            role: "system",
            content:
              "Você lê uma página pública de consulta de CNPJ brasileira e copia os dados cadastrais. " +
              "Copie EXATAMENTE o que está escrito; não complete, não corrija e não invente. " +
              "Se a página não trouxer o cadastro (documento não encontrado, bloqueio, captcha), " +
              "devolva todos os campos vazios.",
          },
          { role: "user", content: `CNPJ consultado: ${cnpj}\n\n${markdown.slice(0, 12_000)}` },
        ],
        responseSchema: SCHEMA,
        temperature: 0,
        thinking: "low",
      });
      const dados: CnpjPublico = {
        razao_social: limpo(out?.razao_social),
        nome_fantasia: limpo(out?.nome_fantasia),
        logradouro: limpo(out?.logradouro),
        numero: limpo(out?.numero),
        complemento: limpo(out?.complemento),
        bairro: limpo(out?.bairro),
        municipio: limpo(out?.municipio),
        uf: limpo(out?.uf).toUpperCase().slice(0, 2),
        cep: soDigitos(out?.cep),
        situacao: limpo(out?.situacao).toUpperCase(),
        origem: new URL(url).hostname,
      };
      if (!valido(dados)) {
        tropecos.push(`${dados.origem}: a página abriu mas não tinha o cadastro`);
        continue;
      }
      await supa.from("cnpj_publico_cache").upsert({
        doc: cnpj, dados, fonte: dados.origem, lido_em: new Date().toISOString(),
      }, { onConflict: "doc" });
      await registrarGasto(supa, "cadastro_cnpj", creditos, { doc: cnpj, url, achou: true });
      return { dados, motivo: `endereço lido em ${dados.origem}`, creditos, doCache: false };
    } catch (e) {
      tropecos.push(`${new URL(url).hostname}: a IA falhou (${String(e).slice(0, 80)})`);
    }
  }

  /* GASTOU E NÃO ACHOU — registra assim mesmo. O crédito saiu do plano; não
     registrar faria o razão dizer que o mês está mais folgado do que está, e o
     teto deixaria de proteger justamente no caso em que ele mais serve: o do
     consumidor que tenta e falha em série. */
  await registrarGasto(supa, "cadastro_cnpj", creditos, { doc: cnpj, achou: false, tropecos });
  return { dados: null, motivo: tropecos.join("; ") || "nenhuma página respondeu", creditos, doCache: false };
}
