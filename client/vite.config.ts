import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Build-Konfiguration.
 *
 * Umgebungsvariablen (setzt die GitHub Action, lokal optional):
 *  VITE_BASE        Unterpfad auf GitHub Pages, z. B. "/runners-vs-snipers/"
 *  VITE_SERVER_URL  Adresse des Cloudflare-Workers
 *  VITE_BUILD_ID    Kennung des Builds (Commit-ID) für den Update-Check
 */
const base = process.env.VITE_BASE ?? '/';
const buildId = process.env.VITE_BUILD_ID ?? `dev-${Date.now().toString(36)}`;

/** Erzeugt version.json und den Service Worker (mit eingesetzter Build-ID). */
function pwaFiles(): Plugin {
  return {
    name: 'scope-rush-pwa-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: buildId, builtAt: new Date().toISOString() }),
      });
      const swPath = fileURLToPath(new URL('./src/platform/sw.js', import.meta.url));
      const sw = readFileSync(swPath, 'utf8').replaceAll('__BUILD_ID__', buildId);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
  plugins: [pwaFiles()],
});
