import { defineConfig } from "vite";
import { resolve } from "node:path";
import sitePlugin from "./build/site-plugin.js";

const page = p => resolve(import.meta.dirname, p);

// Relative base so the static build works from any sub-path (GitHub Pages, a town-hall server, a USB key…).
export default defineConfig({
  base: "./",
  plugins: [sitePlugin()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        home: page("index.html"),
        app: page("app/index.html"),
        cgu: page("cgu/index.html"),
        mentions: page("mentions-legales/index.html"),
        confidentialite: page("confidentialite/index.html"),
        accessibilite: page("accessibilite/index.html"),
        notfound: page("404.html"),
      },
    },
  },
});
