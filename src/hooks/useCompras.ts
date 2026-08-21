import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MapaCompras } from "@/lib/lojistaCartao";

/* ---------------------------------------------------------------------------
 * O que foi comprado em cada linha da fatura, carregado uma vez e compartilhado.
 *
 * Mesmo desenho de cache do `useApelidos`, e pelo mesmo motivo: a tabela do
 * Cartão tem centenas de linhas na tela e cada uma precisa consultar o mapa.
 * Uma busca por linha seria uma rajada de requisições idênticas.
 *
 * A frase vem da nota que alguém anexou na Auditoria e a IA leu — ver a RPC
 * `auditoria_compras` (migration 20260821090000), que é quem aplica as guardas:
 * só leitura do arquivo que está anexado agora, e chave ambígua fica de fora.
 *
 * ACESSÓRIO POR CONSTRUÇÃO: se a RPC falhar, o mapa fica vazio e as telas
 * mostram o que sempre mostraram. Nada aqui pode derrubar a fatura.
 * ------------------------------------------------------------------------- */

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a RPC nova — mesmo
   atalho do `useApelidos`, some quando os tipos forem regerados. */
const lerCompras = (): PromiseLike<{ data: MapaCompras | null; error: { message?: string } | null }> =>
  (supabase as unknown as { rpc: (nome: string) => PromiseLike<{ data: MapaCompras | null; error: { message?: string } | null }> })
    .rpc("auditoria_compras");

const VAZIO: MapaCompras = {};

let _mapa: MapaCompras | null = null;
let _carregando: Promise<void> | null = null;
const _inscritos = new Set<() => void>();

async function buscar(): Promise<void> {
  const { data, error } = await lerCompras();
  if (error) {
    console.warn("[compras] sem o mapa do que foi comprado:", error);
    _mapa = VAZIO;
    return;
  }
  _mapa = data ?? VAZIO;
}

function garantirCarga(): Promise<void> {
  if (_mapa) return Promise.resolve();
  if (!_carregando) {
    _carregando = buscar().finally(() => {
      _carregando = null;
      for (const fn of _inscritos) fn();
    });
  }
  return _carregando;
}

/** Relê o mapa — depois de anexar um comprovante, por exemplo. */
export async function recarregarCompras(): Promise<void> {
  _mapa = null;
  await garantirCarga();
}

/** O mapa "data|centavos" -> o que foi comprado. Vazio até a carga voltar. */
export function useCompras(): MapaCompras {
  const [, forcar] = useState(0);
  useEffect(() => {
    const fn = () => forcar((n) => n + 1);
    _inscritos.add(fn);
    garantirCarga();
    return () => { _inscritos.delete(fn); };
  }, []);
  return _mapa ?? VAZIO;
}
