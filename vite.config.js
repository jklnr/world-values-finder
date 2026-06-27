import { defineConfig } from "vite";

// Compile the source down to exactly three flat files:
//   dist/values.html
//   dist/values.css
//   dist/values.js
// The compact survey/country data (src/data/wvs.json) is imported by the JS,
// so it is bundled into values.js and the three output files are standalone.
// Strip the module/crossorigin attributes Vite injects, so the built
// values.html works when opened directly from the filesystem (file://),
// where ES module scripts and crossorigin requests are blocked.
function standaloneHtml() {
  return {
    name: "standalone-html",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(/\s+type="module"/g, "")
        .replace(/\s+crossorigin/g, "")
        // Classic scripts in <head> run before the DOM is parsed; defer it.
        .replace(/<script\s+src=/g, "<script defer src=");
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [standaloneHtml()],
  build: {
    outDir: "dist",
    assetsDir: ".",
    cssCodeSplit: false,
    modulePreload: false,
    target: "es2018",
    rollupOptions: {
      input: "values.html",
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "values.js",
        chunkFileNames: "values.js",
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? asset.name ?? "";
          if (name.endsWith(".css")) return "values.css";
          return "[name][extname]";
        },
      },
    },
  },
});
