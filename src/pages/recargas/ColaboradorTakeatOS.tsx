import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Escolher a pessoa na lista do TakeatOS em vez de digitar o nome.
//
// Digitado à mão, "Guilherme Borborema" e "Guilherme B." viram duas pessoas para os
// dois sistemas, e o número nunca casa com o de lá — que é exatamente como o mesmo
// celular acaba cadastrado duas vezes. Escolhendo da lista, nome, número e setor vêm
// prontos e a linha nasce ligada dos dois lados.
//
// A lista vem do TakeatOS pela Edge Function (o segredo não pode viver no navegador).
// Quem já tem linha continua aparecendo, marcado: ver "já cadastrado" ao lado do nome
// explica por que a pessoa não deveria ser cadastrada de novo — escondê-la só faria
// alguém procurar, não achar e digitar na mão.

export type ColaboradorTakeat = {
  id: string;
  nome: string;
  numero: string;
  setor: string;
  ja_tem_linha: boolean;
};

// Cache de módulo: o diálogo abre e fecha várias vezes por sessão e a lista muda pouco.
let _cache: ColaboradorTakeat[] | null = null;

export function limparCacheColaboradores() {
  _cache = null;
}

export default function ColaboradorTakeatOS({
  onSelect,
}: {
  onSelect: (c: ColaboradorTakeat) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lista, setLista] = useState<ColaboradorTakeat[]>(_cache || []);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open || _cache) return;
    setCarregando(true);
    setErro(null);
    supabase.functions
      .invoke("recargas-takeatos-linha", { body: { acao: "colaboradores" } })
      .then(({ data, error }) => {
        if (error) throw error;
        _cache = (data?.colaboradores || []) as ColaboradorTakeat[];
        setLista(_cache);
      })
      .catch((e: Error) => setErro(e.message || "não foi possível buscar"))
      .finally(() => setCarregando(false));
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between font-normal">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Buscar colaborador do TakeatOS
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por nome…" />
          <CommandList>
            {carregando && (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando no TakeatOS…
              </div>
            )}
            {erro && (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                Não deu para buscar agora ({erro}). Dá para cadastrar digitando o nome.
              </div>
            )}
            {!carregando && !erro && <CommandEmpty>Ninguém com esse nome.</CommandEmpty>}
            {!carregando && !erro && (
              <CommandGroup>
                {lista.map((c) => (
                  <CommandItem
                    key={c.id}
                    // O valor da busca inclui o número: procurar pelo telefone é comum
                    // quando se tem o chip na mão e não se sabe de quem é.
                    value={`${c.nome} ${c.numero}`}
                    onSelect={() => {
                      onSelect(c);
                      setOpen(false);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{c.nome}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[c.numero || "sem número", c.setor].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    {c.ja_tem_linha && (
                      <span className="ml-2 flex shrink-0 items-center gap-1 text-[11px] text-emerald-600">
                        <Check className="h-3 w-3" /> já cadastrado
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Empurra a linha para o TakeatOS. Devolve a mensagem pronta para o toast — ou null
// quando não há nada a dizer.
export async function espelharNoTakeatOS(linhaId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("recargas-takeatos-linha", {
    body: { acao: "enviar", linha_id: linhaId },
  });
  // O cadastro no Hub já está salvo; falhar aqui não desfaz nada. Mas o silêncio faria
  // a pessoa acreditar que a linha existe nos dois lados quando existe só num.
  if (error) return `Salvo aqui, mas o TakeatOS não recebeu (${error.message}).`;
  if (!data?.enviado) return null;
  return data?.vinculado
    ? "Salvo e criado no TakeatOS, vinculado ao colaborador."
    : "Salvo e criado no TakeatOS. Sem colaborador com esse número lá, então só o Financeiro age nessa linha.";
}

// Precisa ser chamada ANTES do delete local: depois, não há mais de onde ler o número.
export async function removerNoTakeatOS(linhaId: string) {
  await supabase.functions
    .invoke("recargas-takeatos-linha", { body: { acao: "remover", linha_id: linhaId } })
    .catch(() => undefined);
}
