/** Registriert den Service Worker (nur im fertigen Build, nicht beim Entwickeln). */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      // Ohne Service Worker läuft das Spiel trotzdem – nur nicht offline.
    });
  });
}
