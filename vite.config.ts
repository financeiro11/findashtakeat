import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // Os PNG já entram pelo globPatterns; aqui só o que ele não pega.
      includeAssets: ["robots.txt"],
      manifest: {
        name: "Hub Financeiro Takeat",
        short_name: "Hub",
        description: "Central do Financeiro da Takeat — briefing, tarefas, notas e assistente.",
        lang: "pt-BR",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        /* Link compartilhado abre NO APP, não numa aba do navegador ao lado dele.
         *
         * `handle_links: "preferred"` pede ao sistema que endereços dentro do `scope`
         * (é o caso de /notas/<id>) sejam entregues ao app instalado, e
         * `navigate-existing` os abre na janela que já está aberta em vez de empilhar
         * outra. Vale no Android/Chromium; o iOS ignora os dois e sempre abre o Safari —
         * lá o link funciona igual, só não entra no ícone da tela inicial, e não há API
         * que mude isso. */
        handle_links: "preferred",
        launch_handler: { client_mode: "navigate-existing" },
        background_color: "#D51A1A",
        theme_color: "#D51A1A",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // REGRA INEGOCIÁVEL: só entra no precache o que é código/imagem da aplicação.
        // Nenhum `.json`, nenhuma resposta de API — dado financeiro não pode ficar
        // gravado no aparelho (confidencialidade + LGPD). O `.jpg` de fundo fica de
        // fora de propósito: é 858 kB que ninguém precisa ter offline.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // O bundle principal passa de 4 MB; sem isto o Workbox o descartaria em
        // silêncio e o app abriria sempre pela rede.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        /* `undefined` EXPLÍCITO, e não a ausência da chave: o vite-plugin-pwa
         * tem `navigateFallback: "index.html"` no seu `defaultWorkbox` e faz
         * `Object.assign({}, default, seu)` — omitir a chave herda o padrão, e a
         * rota voltava. Passando a chave com `undefined`, o assign sobrescreve. */
        navigateFallback: undefined,
        /* SEM `navigateFallback` DE PROPÓSITO. Ele registra uma NavigationRoute
         * servida pelo index.html do PRECACHE — e o Workbox a registra ANTES de
         * qualquer `runtimeCaching`, então ela vencia sempre e não havia regra
         * que a contornasse. Quem cuida da navegação agora é a regra "casca" lá
         * embaixo, que busca na rede e cai no cache quando não há rede.
         *
         * O que se perde: link direto para uma tela funda (/demonstracoes/dre)
         * aberto OFFLINE deixa de resolver — só a raiz fica guardada. É um preço
         * pequeno num app em que toda tela lê o Supabase, que é NetworkOnly:
         * offline ele não mostraria número nenhum de qualquer jeito. */
        runtimeCaching: [
          {
            // Supabase (REST, Auth, Realtime, Edge Functions) SEMPRE pela rede.
            // NetworkOnly não guarda nem a resposta nem a requisição.
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "NetworkOnly",
          },
          {
            /* A CASCA VEM DA REDE PRIMEIRO — e é isto que faz um deploy aparecer.
             *
             * Só o `navigateFallback` acima, a navegação era servida SEMPRE pelo
             * index.html do precache, que aponta para os bundles com o hash
             * ANTIGO. Na prática: a primeira visita depois de cada deploy abria
             * garantidamente o código velho, e a nova só entrava na visita
             * seguinte — se o precache (6 MB) tivesse terminado antes de a aba
             * fechar. Quem recarregava e fechava rápido ficava preso na versão
             * de semanas atrás sem nada acusar.
             *
             * O index.html tem 1 kB e o servidor já o manda com `no-cache`:
             * buscá-lo na rede não custa nada e devolve sempre os hashes certos.
             * O cache continua atrás, para o app abrir offline — e é por isso
             * que é NetworkFirst e não NetworkOnly. */
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "casca",
              // Rede lenta não pode virar tela branca: passou disso, abre pelo
              // cache e o service worker atualiza por baixo.
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  /* AS LIBS PESADAS SÃO PRÉ-EMPACOTADAS NA LARGADA, mesmo só entrando por
   * `import()` dinâmico.
   *
   * O Vite varre os imports ESTÁTICOS ao subir o servidor e pré-empacota o que
   * achou. `jspdf` e `pptxgenjs` não aparecem em varredura nenhuma — só existem
   * dentro de `await import(...)` em `lib/folhaRevisao.ts` e `lib/thetysExport.ts`.
   * Resultado: o Vite só os descobre no PRIMEIRO clique em "PDF", e aí reotimiza as
   * dependências com a página já aberta. Enquanto a pasta `deps/` é trocada pela
   * `deps_temp_*`, o import em voo pede o hash velho e morre com "Failed to fetch
   * dynamically imported module: .../deps/jspdf.js?v=<hash>" — que parece um bug do
   * botão e não é: o build de produção sempre gerou o chunk certo.
   *
   * Foi exatamente o que aconteceu em 02/09/2026 com o relatório da Thétys. E é por
   * isso que o Excel da mesma tela funcionava: `xlsx` é importado estaticamente em
   * meia dúzia de páginas, então já nasce pré-empacotado.
   *
   * `html-to-image` fica de fora porque o FlowEditor já o importa estaticamente — a
   * varredura o encontra sozinha. */
  optimizeDeps: {
    include: ["jspdf", "pptxgenjs"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
