/** Links zur App bauen und über das iOS-Teilen-Menü verschicken. */

export function appLink(params: Record<string, string>): string {
  const url = new URL(import.meta.env.BASE_URL || '/', location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** iOS-Teilen-Menü (WhatsApp, iMessage …), sonst in die Zwischenablage. */
export async function shareLink(url: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Scope Rush', text, url });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    prompt('Link:', url);
    return 'failed';
  }
}

/** Liest einmalig Parameter aus der Adresse und entfernt sie danach. */
export function takeUrlParam(name: string): string | null {
  const url = new URL(location.href);
  const v = url.searchParams.get(name);
  if (v !== null) {
    url.searchParams.delete(name);
    history.replaceState(null, '', url.toString());
  }
  return v;
}
