// Gerado pelo Lovable — mas EDITADO À MÃO em 30/08/2026, de propósito.
//
// A única alteração é o `storage` do bloco `auth`: ele deixou de ser
// `localStorage` fixo e passou a ser o adaptador de `@/lib/authStorage`, que
// respeita a caixa "Lembrar de mim neste dispositivo" da tela de login. Antes
// dela a caixa não fazia nada e a sessão sobrevivia a fechar o navegador mesmo
// quando a pessoa pedia o contrário — ver o cabeçalho de `lib/authStorage.ts`.
//
// Se um dia este arquivo for regerado, o `storage` volta para `localStorage` e a
// caixa volta a mentir calada. É a única linha que precisa ser reposta.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { armazenamentoDaSessao } from '@/lib/authStorage';

const SUPABASE_URL = "https://lgcxyxyidoirqmbdlldh.supabase.co";
// Chave PÚBLICA (anon). Ela está no bundle e não é segredo — quem abre a página
// tem acesso a ela. Quem protege os dados é a RLS do banco e a checagem de
// usuário dentro de cada Edge Function (`_shared/auth.ts`), nunca esta chave.
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: armazenamentoDaSessao,
    persistSession: true,
    autoRefreshToken: true,
  }
});
