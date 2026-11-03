/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse des Cloudflare-Workers (setzt die GitHub Action). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-Kennung, von Vite eingesetzt. */
declare const __BUILD_ID__: string;
