# CLAUDE.md – Scope Rush

Mobile-Web-Multiplayer-Spiel im Hochformat (iPhone). Läufer vs. Sniper, 1v1-Duelle + Party-Modus „Klassik“.
Die ausführliche Planung steht in **[PLAN.md](PLAN.md)**. Diese Datei fasst zusammen, was beim Arbeiten am Code wichtig ist.

## Zusammenarbeit
- Mit dem Nutzer **Deutsch** sprechen. Er ist kein Profi-Entwickler: Alles, was er selbst tun muss (Accounts, Tokens, Einstellungen), Schritt für Schritt erklären.
- Meilenstein für Meilenstein vorgehen (M0 … M6 in PLAN.md). Nach jedem Meilenstein: Tests grün → deployen → Zusammenfassung + iPhone-Checkliste → **auf Feedback warten**.
- **0 € Kosten:** nur kostenlose Tarife ohne Kreditkarte. Was Geld kosten könnte, vorher fragen.
- Kollidiert eine Anforderung mit dem Free-Plan oder iOS, das dem Nutzer sagen und eine Alternative vorschlagen. Nichts still weglassen.
- Nichts aus Fortnite oder Snipers Duel kopieren (Namen, Figuren, Logos, Sounds, Grafiken, Karten). Assets prozedural oder CC0.

## Befehle (Stand: geplant, wird mit M0 eingerichtet)
```bash
pnpm install              # Abhängigkeiten
pnpm dev                  # Client (Vite, :5173) + Server (wrangler dev, :8787) gleichzeitig
pnpm dev:client           # nur Client
pnpm dev:server           # nur Worker lokal (inkl. Durable Objects)
pnpm test                 # alle Vitest-Tests (shared + server)
pnpm typecheck            # tsc --noEmit für alle Pakete
pnpm build                # Client-Build nach client/dist
pnpm size                 # prüft Ladegröße (< 5 MB)
```
Nützliche URL-Parameter im Client:
- `?lag=150&jitter=40`: künstliche Netzverzögerung
- `?debug=1`: Balancing-Regler und Netz-Statistik
- `?server=http://localhost:8787`: anderer Server

## Struktur
- `shared/`: Spielregeln, Bewegung, Ballistik, Streckengenerator, Bots, Nachrichtenschemas (zod), **`config.ts` mit allen Balancing-Werten**
- `client/`: Vite + Three.js (Spiel) + Preact (Menüs als HTML-Overlay), Plattformcode für iOS in `src/platform/`, Texte in `src/i18n/de.ts`
- `server/`: Cloudflare Worker; `HubDO` (Konten/Freunde/Status, SQLite, Hibernation), `RoomDO` (Lobby + Match-Simulation)

## Konventionen
- TypeScript **strict**, kein `any`. Bezeichner englisch, Kommentare/Doku deutsch, Spieltexte deutsch nur in `client/src/i18n/de.ts`.
- **Balancing-Werte nur in `shared/src/config.ts`**, keine Zahlen „hart“ im Code.
- **Determinismus in `shared/src/sim` und `shared/src/track`:**
  - kein `Math.random`, nur der Seed-Zufall aus `shared/src/math`
  - kein `Date.now`
  - keine `Math.sin/cos/pow/exp`, stattdessen eigene Hilfsfunktionen
  - Zeit nur in Ticks (60/s)
- `/shared` nutzt keine DOM- oder Worker-APIs.
- Server ist Autorität. Jede eingehende Nachricht mit zod validieren, Rate-Limit pro Verbindung.
- Durable Objects:
  - nur SQLite-backed (`new_sqlite_classes`)
  - im Hub immer `ctx.acceptWebSocket()` (Hibernation), nie `ws.accept()`
  - nie pro Tick in SQLite schreiben
  - Heartbeats über `setWebSocketAutoResponse`
- Öffentliches Repo: **keine Secrets im Code**. Cloudflare-Token/Account-ID nur als GitHub-Secrets.
- Bedienelemente nur in der unteren Bildschirmhälfte, Safe Areas über `env(safe-area-inset-*)`.
- Performance: Pixel-Ratio ≤ 2, Low-Poly, wenige Draw-Calls, Ladegröße < 5 MB.
- Git: direkt auf `main` (jeder Push deployt). Vor dem Push `pnpm typecheck && pnpm test` ausführen. Commit-Nachrichten kurz, deutsch oder englisch, im Imperativ.

## Wichtige Adressen
- Spiel (GitHub Pages): https://m4tt3s-209.github.io/Snipers-and-Runners/ (ab M0)
- Server (Cloudflare Worker): `https://scope-rush.<subdomain>.workers.dev`, wird nach dem ersten Deploy eingetragen

## Aktueller Stand
- [x] Plan erstellt (PLAN.md), **wartet auf OK des Nutzers**
- [ ] M0 Grundgerüst + Deploy-Pipeline + Testseite
- [ ] M1 Offline-Prototyp gegen Bots
- [ ] M2 Online-1v1 per Raum-Link
- [ ] M3 Konten, Freunde, Herausforderungen, Party-Lobby
- [ ] M4 Waffen/Gadgets, Streckengenerator, Klassik
- [ ] M5 Feinschliff, Trophäen, Statistiken, Tutorial
- [ ] M6 (optional) Web-Push

## Entscheidungen und Erkenntnisse (laufend ergänzen)
- iOS kopiert beim „Zum Home-Bildschirm“ (ab 17.2) nur **Cookies** aus Safari, nicht localStorage. Darum liegt das Konto-Token in beiden. Fallback ist die Netzwerk-Kopplung (gleiche IP, 10 min, Bestätigung per Tipp), danach der Übertragungscode.
- Der Haptik-„Switch-Trick“ ist laut ios-haptics seit iOS 26.5 gesperrt. Wir verlassen uns nicht darauf.
- Free-Plan DO (Recherche Nov. 2026):
  - 100k Requests/Tag (eingehende WS-Nachrichten 20:1, ausgehende gratis)
  - 13.000 GB-s/Tag
  - 100k geschriebene / 5 Mio. gelesene Zeilen pro Tag
  - 5 GB Speicher
  - Zurücksetzen um 00:00 UTC
