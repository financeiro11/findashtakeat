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
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // Supabase (REST, Auth, Realtime, Edge Functions) SEMPRE pela rede.
            // NetworkOnly não guarda nem a resposta nem a requisição.
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
