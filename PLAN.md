# Scope Rush – Projektplan

> Stand: 03.11.2026 · Status: **freigegeben**, M0 in Arbeit
> Online-Multiplayer-Spiel im Hochformat für iPhone. Läufer gegen Sniper, 1v1-Duelle und Party-Modus.
> Komplett kostenlos: GitHub Pages (Frontend) + Cloudflare Workers/Durable Objects im Free-Plan (Backend).

---

## 0. Kurzfassung

- **Eine Codebasis, drei Teile:** `/shared` (Spielregeln, Bewegung, Ballistik, Nachrichten), `/client` (Vite + Three.js, Menüs als HTML-Overlay), `/server` (Cloudflare Worker mit zwei Durable-Object-Klassen: `HubDO` und `RoomDO`).
- **Der Server entscheidet.** Die Spielsimulation in `/shared` läuft im `RoomDO` als Autorität. Der Client nutzt denselben Code zur Vorhersage. Im Offline-Modus spielt der Client gegen Bots und übernimmt dabei selbst die Server-Rolle. Dafür gibt es keinen eigenen Sonder-Code.
- **Ein gemeinsamer Zeitstrahl in Ticks (60 pro Sekunde).** Läufer-Positionen und Geschossbahnen sind reine Funktionen von „Tick + Eingaben“. Dadurch funktionieren Vorhersage, Lag-Kompensation und Bullet-Cam mit wenigen Daten.
- **Kein ständiges Code-Eintippen:** Freunde kommen per Link, QR-Code oder Name#Tag in die Liste, und zwar nur einmal. Danach reicht ein Tipp auf „Herausfordern“. Die Speichertrennung zwischen Safari und Home-Bildschirm-App lösen drei Wege nacheinander: Cookie-Übernahme, „Netzwerk-Kopplung“ und als letzter Ausweg ein Übertragungscode (Details in Abschnitt 8).
- **Budget:** Bei 20 Freunden nutzen wir voraussichtlich unter 10 % der täglichen Free-Plan-Grenzen (Rechnung in Abschnitt 3.8).

---

## 1. Annahmen (bitte kurz prüfen)

| # | Annahme | Warum |
|---|---------|-------|
| A1 | Spiel-URL: `https://m4tt3s-209.github.io/runners-vs-snipers/`, Server-URL: `https://runners-vs-snipers.<dein-subdomain>.workers.dev`. Der Spieltitel bleibt „Scope Rush“. | Entschieden (F1): Das Repo wird in `runners-vs-snipers` umbenannt. Der Build übernimmt den Unterpfad automatisch aus dem Repo-Namen. |
| A2 | Wir arbeiten direkt auf `main`. Jeder Push löst den Deploy aus. | So hast du es vorgegeben. Du arbeitest allein, deshalb gibt es keine PR-Pflicht. |
| A3 | 3 Spuren, 60 Simulations-Ticks/s, Server verschickt 20 Zustandsupdates/s | Bewährte Werte für Lane-Runner. Sie lassen sich zentral in der Config ändern. |
| A4 | Leben intern als **6 Halbherzen** (angezeigt als 3 Herzen). Präzisionsgewehr: Körper −2 (= 1 Herz), Kopf −6 (= raus). Halbautomatik: Körper −1, Kopf −3. | Damit ist „weniger Schaden“ bei der Halbautomatik möglich, ohne von den 3 Leben abzuweichen. |
| A5 | Ein Sturz in eine Lücke kostet **kein Leben**, sondern Zeit (Neustart am Segmentanfang + 2 s). Gegen eine Hürde laufen = kurzes Stolpern. | Leben gehören zum Duell mit dem Sniper, Parkour-Fehler kosten Zeit. |
| A6 | Jede Runde bekommt eine neue Strecke (neuer Seed). Innerhalb einer Runde laufen beide dieselbe Strecke. Wer in Runde 1 zuerst läuft, ist in Runde 2 zuerst Sniper, in Runde 3 entscheidet ein Münzwurf. | Wer als Zweiter läuft, kennt die Zielzeit. Durch das Abwechseln bleibt es fair. |
| A7 | Waffen und Gadgets sind **gleichwertige Alternativen**, keine Upgrades. Sie sind nach etwa 5 Matches alle freigeschaltet. Im Duell-Menü gibt es zusätzlich den Schalter „Faire Duelle: alles frei“. | Freischaltungen sollen das Spiel nur minimal beeinflussen. |
| A8 | Grafik und Sound werden **prozedural im Code erzeugt** (Low-Poly-Formen, Canvas-Texturen, WebAudio-Synth). CC0-Assets von Kenney kommen nur dazu, wenn es sich lohnt. | Kein Lizenzrisiko, winzige Ladegröße (Ziel < 2 MB). |
| A9 | Menüs werden als HTML/CSS-Overlay mit **Preact** (≈ 4 KB) gebaut, das 3D-Spiel mit Three.js. | Menüs mit Freundesliste und Lobby sind in HTML einfacher und schärfer als in WebGL. |
| A10 | Bezeichner im Code sind englisch, Kommentare und Doku deutsch, alle Spieltexte deutsch in einer Datei (`client/src/i18n/de.ts`). | Für dich lesbar, für Werkzeuge Standard. |
| A11 | **Nur iPhone** (Safari / Home-Bildschirm-App). Android wird nicht getestet. | Entschieden (F3). |
| A12 | Gespeichert werden nur Spielername, Tag, Statistiken und Freischaltungen. IP-Adressen landen nur gesalzen-gehasht und maximal 10 Minuten in der Datenbank (für die Netzwerk-Kopplung). | Datensparsam, kein Datenschutz-Ballast. |

---

## 2. Kollisionen mit Free-Plan und iOS – und die Lösungen

Diese Punkte lassen sich **nicht genau wie gewünscht** umsetzen. Hier steht jeweils der Vorschlag:

| Anforderung | Problem (Stand Nov. 2026) | Lösung |
|---|---|---|
| Hochformat sperren | Safari kann die Ausrichtung nicht sperren. Das `orientation`-Feld im Manifest ignoriert iOS. | Im Querformat erscheint ein Vollbild-Hinweis „Bitte ins Hochformat drehen“ und das Spiel pausiert. |
| Vollbild | Die Fullscreen-API gibt es auf dem iPhone nicht (nur für Videos). | Anleitung „Zum Home-Bildschirm“ einblenden. Seit iOS 26 öffnet sich jede so angelegte Seite automatisch als Web-App ohne Browserleisten. |
| Vibration | iOS kennt `navigator.vibrate()` nicht. Der bekannte „Switch-Trick“ für Haptik soll laut der Bibliothek *ios-haptics* seit iOS 26.5 gesperrt sein (nicht unabhängig bestätigt). | Feedback über Sound, Bildschirm-Wackeln, Blitz-Effekte und Zeitlupe. Den Switch-Trick testen wir in M5 als Bonus, bauen aber nicht darauf. |
| Sofort-Pop-up bei Herausforderung | iOS friert die Web-App im Hintergrund ein, die Verbindung bricht ab. Ein Pop-up kommt nur an, wenn der Freund die App **gerade offen** hat. | Ist die App nicht offen, gilt der Freund als „offline“. Die Herausforderung wartet dann 5 Minuten im Posteingang. Echte Benachrichtigungen bringt M6 (Web-Push, nur in der Home-Bildschirm-App). |
| Links und QR-Codes öffnen sich in der App | iOS öffnet sie **immer in Safari**, die Home-Bildschirm-App hat einen **eigenen Speicher**. Seit iOS 17.2 kopiert iOS beim „Zum Home-Bildschirm“ einmalig die **Cookies** (nicht localStorage). | Drei Wege nacheinander: Cookie-Übernahme, Netzwerk-Kopplung und Übertragungscode (Abschnitt 8). |
| Konto bleibt in Safari | Safari löscht per Skript gespeicherte Daten einer Seite, die man 7 Tage nicht besucht hat. Die Home-Bildschirm-App ist davon ausgenommen. | Die Home-Bildschirm-App wird klar empfohlen. Wir fragen `navigator.storage.persist()` an und zeigen den Übertragungscode in den Einstellungen gut sichtbar. |
| Ton | Der Stummschalter am iPhone schaltet WebAudio stumm. | Einstellung „Ton trotz Stummschalter“ (`navigator.audioSession.type = "playback"`). |
| Durable Objects im Free-Plan | Nur SQLite-basierte DOs. Tägliche Grenzen (Zurücksetzen um 01:00 Uhr MEZ / 00:00 UTC). Wird eine Grenze überschritten, schlagen weitere Aufrufe bis zum Reset fehl. | `new_sqlite_classes` in der Migration. Sparsames Protokoll und WebSocket-Hibernation. Ein Nutzungszähler im Admin-Bereich zeigt, wie viel vom Kontingent verbraucht ist. |
| CPU-Limit pro Aufruf | Das CPU-Limit für DOs im Free-Plan war in der offiziellen Doku nicht eindeutig nachzulesen. Bekannt ist: Jede eingehende WebSocket-Nachricht setzt das Budget zurück. | Ein Simulations-Tick kostet Mikrosekunden, außerdem senden die Clients ohnehin mehrmals pro Sekunde. In M2 messen wir die CPU-Zeit unter Last und dokumentieren sie. |

---

## 3. Architektur

### 3.1 Überblick

```
 iPhone (Safari / Home-Bildschirm-App)                      Cloudflare (Free-Plan)
┌──────────────────────────────────────┐            ┌─────────────────────────────────────┐
│ client  (GitHub Pages, statisch)      │            │ Worker  scope-rush                  │
│  ├─ Three.js-Spielansicht             │   HTTPS    │  ├─ /version, /health               │
│  ├─ Preact-Menüs (Freunde, Lobby)     │──────────▶ │  ├─ Origin-Check                    │
│  ├─ Netz: Reconnect, Uhr, Lag-Sim     │            │  └─ WebSocket-Weiterleitung ─┐      │
│  ├─ LocalHost (Offline-Bots)          │  WebSocket │                              ▼      │
│  └─ Service Worker (PWA)              │◀═════════▶ │  HubDO  (1 Instanz, „global“)       │
│                                       │            │   SQLite: Konten, Freunde,          │
│ shared (im Bundle)                    │            │   Einladungen, Statistik            │
│  ├─ config.ts  ← alle Balancing-Werte │            │   Hibernation API                   │
│  ├─ sim/  Bewegung, Ballistik, Deckung│  WebSocket │                                     │
│  ├─ track/ Streckengenerator          │◀═════════▶ │  RoomDO (1 pro Duell/Party)         │
│  ├─ bots/                             │            │   Lobby + Match-Simulation (shared) │
│  └─ protocol/ Nachrichten (zod)       │            │   Lag-Kompensation, Punkte          │
└──────────────────────────────────────┘            └─────────────────────────────────────┘
```

- **HubDO** (genau eine Instanz): Konten, Freundschaften, Anfragen, Einladungslinks, Online-Status, Herausforderungen, Posteingang, Statistiken, Freischaltungen. Jeder Client ist mit ihm verbunden, solange die App im Vordergrund ist. Dank **WebSocket Hibernation** schläft das Objekt zwischen Nachrichten und kostet dann keine Laufzeit. Heartbeats beantwortet `setWebSocketAutoResponse`, ohne das Objekt aufzuwecken.
- **RoomDO** (eins pro Duell bzw. Party): Lobby, Ausrüstungswahl, Match-Simulation, Rundenwertung, Revanche. Eine Revanche bleibt im selben Room, deshalb braucht es keinen Umweg über das Menü. Läuft gerade kein Match, schläft auch der Room per Hibernation.
- **Worker-Einstieg**: prüft Origin und Protokollversion und leitet WebSocket-Upgrades an das passende DO weiter.
- Hub und Room sprechen per **DO-RPC** miteinander (`stub.method()`): Token prüfen, Status „im Match“ melden, Ergebnis speichern. Dafür braucht es kein Shared Secret.

### 3.2 Ordnerstruktur

```
/
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts
├─ .github/workflows/deploy.yml
├─ shared/src/
│   ├─ config.ts            ← ZENTRALE Balancing-Datei (Zeiten, Schaden, Leben, Nachladen, Geschwindigkeiten …)
│   ├─ math/                Vektoren, Seed-Zufall (mulberry32), deterministische Wellen statt Math.sin
│   ├─ track/               Segment-Bibliothek, Generator (Seed → Strecke), Themen
│   ├─ sim/                 runner.ts (Bewegung), projectile.ts (Ballistik), cover.ts, gadgets.ts,
│   │                       world.ts (ein Zug), history.ts (Ringpuffer für Lag-Kompensation)
│   ├─ rules/               Zug-/Runden-/Match-Ablauf, Wertung 1v1 + Klassik, Trophäen
│   ├─ bots/                Läufer-Bot, Sniper-Bot (Schwierigkeitsstufen)
│   ├─ protocol/            Nachrichten-Schemas (zod) + Typen, PROTOCOL_VERSION
│   └─ names.ts             Namensregeln + Wortfilter
├─ client/
│   ├─ index.html, public/  (manifest.webmanifest, Icons, sw.js)
│   └─ src/
│       ├─ main.ts, app/    (Bildschirme: Start, Menü, Freunde, Lobby, Einstellungen, Statistik)
│       ├─ game/            Renderer, Szenenbau, Läufer-/Sniper-Ansicht, Effekte, Bullet-Cam
│       ├─ input/           Wischgesten, Sniper-Steuerung (2 Varianten), Gyroskop
│       ├─ net/             Socket mit Auto-Reconnect, Uhr-Sync, Lag-Simulator, Hub-/Room-Client
│       ├─ local/           LocalHost: Offline-Match gegen Bots (nutzt shared/sim)
│       ├─ audio/           prozeduraler Synth (Schüsse, Treffer, UI, Jingles)
│       ├─ platform/        iOS: Hochformat-Hinweis, Wake Lock, Home-Bildschirm-Anleitung,
│       │                   Speicher/Cookie, Kopplung, Safe Areas, Update-Check
│       └─ i18n/de.ts       alle Texte
└─ server/
    ├─ wrangler.jsonc       (Migration mit new_sqlite_classes: ["HubDO", "RoomDO"])
    └─ src/
        ├─ index.ts         Router, Origin-Check, /version
        ├─ hub/             HubDO + Tabellen, Konten, Freunde, Herausforderungen, Kopplung
        ├─ room/            RoomDO, Lobby, MatchRunner
        └─ util/            Rate-Limit (Token-Bucket), Krypto-Helfer
```

### 3.3 Simulation und Determinismus

- **Fester Zeitschritt:** 60 Ticks/s (`dt = 1/60 s`). Der Server rechnet alle 50 ms drei Ticks und verschickt danach ein Update.
- **Strecke:** Aus Seed + Thema entsteht deterministisch eine Liste von Hindernissen. Server und Client erzeugen die Strecke daraus selbst, sie wird also nie übertragen.
- **Läufer:** Der Zustand ist ein Wert pro Tick (`z` entlang der Strecke, Spur bzw. Spurwechsel-Fortschritt, Höhe `y`, Sprung/Rutschen/Ducken/Stolpern, Leben, Gadget). Er hängt nur von Strecke, eigenen Eingaben und Treffern ab.
- **Bewegliche Plattformen** haben eine Position, die nur vom Tick abhängt (Dreieckswelle).
- **Geschosse** folgen einer festen Bahn: `p(t) = Start + v·t + ½·g·t²` (Schwerkraft standardmäßig 0, per Config einschaltbar). Nach dem Abfeuern ändert sich die Bahn nicht mehr. Jeder Client kann sie deshalb für jeden Zeitpunkt exakt zeichnen.
- **Determinismus-Regeln für `/shared`:** kein `Math.random` (stattdessen Seed-Zufall), kein `Date.now`, keine `Math.sin/cos/pow` in der Simulation (eigene Funktionen), nur Grundrechenarten. Die Zielrichtung schickt der Sniper-Client als fertigen Richtungsvektor, damit der Server keine Trigonometrie braucht.
- **Test:** Dieselben Eingaben ergeben bitgenau denselben Zustands-Hash.

### 3.4 Netcode

**Uhr-Abgleich:** Der Client misst alle 2 s die Laufzeit (Ping) und schätzt daraus den aktuellen Server-Tick. Der Wert wird geglättet, Ausreißer werden verworfen.

**Läufer (eigene Figur) – Vorhersage und Abgleich:**
1. Der Läufer-Client läuft dem Server um *halbe Laufzeit + 30 ms Puffer* voraus. Ein Wisch wird sofort lokal ausgeführt und mit seinem Tick gestempelt an den Server geschickt (`input {tick, action}`). Läufer senden **nur Eingaben**, keine Positionen.
2. Der Server wendet die Eingabe genau an diesem Tick an. Kommt sie zu spät (bis 120 ms), spult er die Läufer-Simulation zurück und rechnet neu. Das ist billig, weil die Läufer-Bewegung deterministisch ist. Kommt sie noch später, gilt sie ab dem aktuellen Tick.
3. Treffer und Nicht-Treffer werden **nie rückwirkend geändert**.
4. Der Client bekommt in jedem Update den bestätigten Zustand und rechnet die noch unbestätigten Eingaben darauf (Reconciliation). Kleine Abweichungen werden über 100 ms weich ausgeglichen statt zu springen.

**Gegner und andere Läufer:** Sie werden mit ca. 100 ms Verzögerung zwischen zwei Server-Updates **interpoliert**.

**Sniper – Lag-Kompensation mit Flugzeit:**
1. Der Sniper sieht die Läufer leicht verzögert (Interpolation + Laufzeit) und schießt auf das, was er sieht. Er schickt `fire {viewTick, origin, dir}`, also den Tick, den er gerade sah, und die Richtung.
2. Der Server lässt das Geschoss **an `viewTick` starten**, also in der Vergangenheit. Er spult es durch den Positionsverlauf der Läufer (Ringpuffer, 1 s) bis zur Gegenwart vor und prüft dabei Treffer, auch an Deckung mit ihrem Zerstörungszeitpunkt. Danach fliegt es normal weiter. Das ist die Umsetzung von „Läuferposition auf den Moment zurückspulen, den der Sniper gesehen hat“.
3. Höchstens 250 ms werden zurückgespult (Config). Ab dort ist die Kompensation gedeckelt, damit Läufer nicht „um die Ecke“ getroffen werden.
4. Der Läufer-Client zeichnet die Kugel zur **eigenen** Zeit. Sie taucht dann ein Stück nach dem Abschuss auf, fliegt aber exakt auf der echten Bahn. Was er sieht, ist also auch das, was trifft. Vorwarnungen bleiben das Glitzern des Zielfernrohrs und das Nachlade-Fenster.

**Nachrichten-Format:** kompaktes JSON (Kurzschlüssel, Zahlen gerundet). Ein Update mit 8 Läufern ist etwa 400 Byte groß. Ausgehende Nachrichten sind im Free-Plan kostenlos.

**Verbindungsabbruch (App-Wechsel zu WhatsApp usw.):**
- Der Client erkennt die Rückkehr (`visibilitychange`, `pageshow`, toter Socket). Er baut Hub- und Room-Verbindung sofort neu auf und meldet sich mit seinem Token zurück. Der Room schickt dann einen kompletten Zustand.
- **1v1:** Das Match pausiert für beide. Der andere sieht „Max ist kurz weg … 0:45“. Nach der Rückkehr geht es mit Countdown 3-2-1 weiter. Läuft die Schonfrist (45 s, Config) ab, kann der Wartende **„Weiter warten“** oder **„Sieg kampflos“** wählen.
- **Klassik:** Ist ein Läufer weg, bleibt seine Figur stehen und wartet. Kommt er rechtzeitig zurück, läuft er weiter, sonst zählt die bis dahin geschaffte Strecke. Ist ein Sniper weg, pausiert das Match.

**Lokale Tests mit Verzögerung:** Mit `?lag=150&jitter=40` verzögert der Client alle Nachrichten künstlich (in beide Richtungen, inklusive Schwankung und optional Paketverlust). So lässt sich mit zwei Browserfenstern gegen `wrangler dev` testen.

### 3.5 Durable Objects im Detail

**HubDO**
- Adresse: `idFromName("global")`.
- WebSocket über `ctx.acceptWebSocket()`. Die Konto-ID steckt in `serializeAttachment`, damit sie die Hibernation übersteht.
- Online-Status: Ein verbundener Socket bedeutet „online“, der Room meldet „im Match“. Ändert sich ein Status, gehen gezielte Nachrichten nur an die Freunde.
- Abgelaufene Herausforderungen, Einladungen und Kopplungen werden per Alarm aufgeräumt (ein Alarm, der immer auf den nächsten Ablauf gestellt wird).

**RoomDO**
- Adresse: `idFromName(roomId)`, die `roomId` ist eine zufällige 10-stellige Kennung.
- Phasen: `lobby → loadout (10 s) → countdown (3 s) → running (max. 45 s) → turnResult (4 s) → … → matchResult → (Revanche → loadout)`.
- Läuft gerade ein Zug, rechnet ein `setInterval` alle 50 ms. In der Lobby oder nach dem Match gibt es keinen Timer, der Room kann schlafen.
- Spielstand wird nur im Arbeitsspeicher gehalten, am Zugende kommt ein kompakter Schnappschuss in den Speicher. Damit gibt es keine Schreibzugriffe pro Tick, und ein Neustart des Objekts ist überlebbar.
- Am Match-Ende meldet der Room das Ergebnis an den Hub (Statistik, Trophäen).

### 3.6 Client

- **Rendering:** Three.js mit `MeshToonMaterial` für den Comic-Look. Konturen gibt es nur an Figuren (Inverted Hull, billig). Wiederholte Objekte werden instanziert, Nebel verdeckt die Ferne, Schatten sind Blob-Schatten statt Shadow-Maps. Pixel-Ratio ist `min(devicePixelRatio, 2)`, bei unter 55 FPS sinkt sie automatisch auf 1,5. Ziel: unter 120 Draw-Calls.
- **Läufer-Kamera:** hinter und über der Figur, Blick die Strecke hinauf zum Turm.
- **Sniper-Kamera:** Ego-Sicht von der Turmspitze, die Strecke kommt von oben (fern) nach unten (nah). Zoomstufen: Sichtfeld 60° → 24° → 12° → 6°. Je höher die Stufe, desto stärker wackelt das Fadenkreuz (glattes Rauschen). Die Zielempfindlichkeit skaliert mit dem Zoom.
- **Steuerung Sniper:** Zwei Varianten, umschaltbar in den Einstellungen:
  - A) Ziehen = zielen, dazu ein Feuer-Button.
  - B) Halten, ziehen, loslassen = Schuss.

  Nach deinem Test in M1 legen wir eine davon als Standard fest. Optional gibt es Gyroskop-Zielen, die Berechtigung wird per Tipp angefragt.
- **Steuerung Läufer:**
  - Wischen links/rechts = Spur wechseln
  - Wischen hoch = springen
  - Wischen runter = rutschen
  - Finger halten (> 180 ms, ohne Wischen) = ducken
  - Der Gadget-Button sitzt unten.

  Gesten werden im ganzen unteren Bereich erkannt.
- **Layout:** Alle Bedienelemente liegen in der unteren Bildschirmhälfte, mit Abstand `env(safe-area-inset-*)` zu Dynamic Island und Home-Leiste.
- **iOS-Schutz:**
  - Zoomen und Gummiband verhindern: `touch-action: none`, `overscroll-behavior: none`, `position: fixed` am Body, `gesturestart` abfangen (iOS ignoriert `user-scalable=no` in Safari).
  - Text-Markieren und Lupe aus: `-webkit-user-select: none`, `-webkit-touch-callout: none`, `preventDefault` auf `touchstart` im Spielbereich.
- **Wake Lock:** `navigator.wakeLock` während des Spiels (in der Home-Bildschirm-App zuverlässig ab iOS 18.4). Weil wir nur aktuelles iOS unterstützen, braucht es keinen Ersatz (z. B. ein unsichtbares Mini-Video).
- **Audio:** Der `AudioContext` startet beim ersten Tipp. Alle Sounds werden synthetisch erzeugt, es gibt keine Audiodateien.
- **PWA:** Manifest, Icons (beim Build erzeugt) und ein handgeschriebener Service Worker (App-Shell im Cache, HTML immer frisch vom Netz). Beim App-Start und bei jeder Rückkehr prüft der Client `version.json`. Ist sie neu, erscheint ein Banner „Update verfügbar – neu laden“.
- **Versions-Check mit dem Server:** Der Hub schickt beim Verbinden die `PROTOCOL_VERSION`. Passt sie nicht, sperren Server und Client das Online-Spiel und zeigen das Update-Banner. Offline-Spiel geht weiter.

### 3.7 Sicherheit (öffentliches Repo, keine Secrets im Code)

- Das Konto-Token ist ein Zufallswert mit 256 Bit. Der Server speichert nur seinen **SHA-256-Hash**. Das Token wird als erste Nachricht nach dem Verbinden geschickt, nicht in der URL.
- Jede eingehende Nachricht wird mit **zod** geprüft. Ungültige Nachrichten werden verworfen, bei wiederholten Verstößen wird die Verbindung getrennt.
- **Rate-Limiting:** Token-Bucket pro Verbindung, z. B. 30 Nachrichten/s im Match und 5/s im Hub. Pro IP höchstens 5 neue Konten am Tag und 20 Namenssuchen pro Minute.
- **Origin-Check:** Erlaubt sind nur `https://m4tt3s-209.github.io` und, in der Entwicklungsumgebung, `http://localhost:*`.
- **Namen:** 3–14 Zeichen (Buchstaben inkl. Umlaute, Ziffern, Leerzeichen, `-`, `_`). Ein Wortfilter (deutsch/englisch) erkennt auch Varianten mit Ziffern statt Buchstaben.
- **Plausibilitätsprüfungen im Spiel:** Schussrate, Munition und Nachladezeit, Zeitstempel innerhalb gültiger Grenzen, Eingaben pro Sekunde.
- **Secrets:** Nur das Cloudflare-API-Token und die Account-ID, beides als GitHub-Secrets. Für Web-Push (M6) kommt ein VAPID-Schlüssel als Worker-Secret dazu.

### 3.8 Free-Plan-Budget (Werte pro Tag, Recherche-Stand Nov. 2026)

| Grenze (Free) | Verbrauch je 1v1-Match (≈ 5 min) | Party „Klassik“, 8 Spieler (≈ 10 min) | Hub (20 Freunde, je 2 h App offen) |
|---|---|---|---|
| 100.000 Requests (eingehende WS-Nachrichten zählen 20:1, ausgehende kosten nichts) | ≈ 4.500 Nachrichten → **≈ 230** | ≈ 30.000 → **≈ 1.500** | Pings kostenlos (Auto-Response), sonst **≈ 300** |
| 13.000 GB-s Laufzeit (128 MB je DO ⇒ ≈ 28 h aktive DO-Zeit) | ≈ 6 min aktiv → **≈ 46 GB-s** | ≈ 12 min → **≈ 92 GB-s** | Hibernation, geschätzt **< 1.000 GB-s** |
| 100.000 geschriebene SQLite-Zeilen | ≈ 10 | ≈ 30 | ≈ 500 |
| 5 Mio. gelesene Zeilen / 5 GB Speicher | vernachlässigbar | vernachlässigbar | vernachlässigbar |

**Beispieltag:** 40 Duelle + 5 Partys ≈ 17.000 Requests (17 %) und ≈ 3.300 GB-s (25 %). Damit bleibt viel Luft. Wichtig ist nur, dass wir **nie pro Tick in SQLite schreiben** und **nie `ws.accept()` statt der Hibernation-API** im Hub nutzen.

---

## 4. Spielregeln und Ablauf

### 4.1 Ein Zug
1. **Ausrüstung (10 s):** Der Sniper wählt eine Waffe, der Läufer ein Gadget. Die Wahl des Gegners bleibt bis zum Start verdeckt.
2. **Countdown (3 s).**
3. **Lauf (max. 45 s):** Der Läufer läuft automatisch Richtung Turm, der Sniper schießt. Der Zug endet, wenn der Läufer im Ziel ankommt, raus ist (0 Leben) oder die Zeit abläuft.
4. **Ergebnis (4 s):** geschaffte Strecke in Metern bzw. Zielzeit.

### 4.2 1v1-Duell (Best of 3)
- Eine Runde besteht aus zwei Zügen (Rollentausch) auf derselben Strecke.
- **Rundensieg:** Wer als Läufer weiter kam, gewinnt die Runde. Sind beide angekommen, gewinnt die schnellere Zeit. Bei exakt gleicher Strecke gewinnt, wer mehr Leben übrig hat, danach entscheidet der Zeitpunkt des Ausscheidens.
- 2 Rundensiege = Match-Sieg. Dauer: 2–3 Runden à 2 × ≈ 55 s ≈ 4–5,5 min.
- Am Ende: **Bullet-Cam** des entscheidenden Treffers in Zeitlupe (bzw. Zeitlupe des Zieleinlaufs, wenn kein Treffer entschieden hat), dann Sieger-Emote und Buttons **„Revanche“** und „Zurück“.

### 4.3 Party „Klassik“ (3–8 Spieler)
- 1 Sniper, ab 6 Spielern 2 Sniper. Alle anderen laufen gleichzeitig auf derselben Strecke (Läufer kollidieren nicht miteinander).
- Die Sniper-Rolle rotiert, bis jeder einmal dran war. Bei 2 Snipern sind es entsprechend weniger Durchgänge.
- **Punkte:** Läufer im Ziel bekommen nach Platzierung 5/4/3/2/2/… Punkte. Sniper bekommen +1 pro Treffer und +2 pro ausgeschaltetem Läufer. Alle Werte stehen in der Config.
- Wer raus ist, schaut **durchs Zielfernrohr des Snipers** zu. Die Blickrichtung des Snipers wird mit 20 Hz übertragen.

### 4.4 Läufer
- 3 Spuren. Möglich sind Spurwechsel, Springen, Rutschen und Ducken. Beim Ducken bleibt die Figur stehen. Ist eine Deckung direkt vor ihr in derselben Spur, schützt sie.
- **Glitzern:** Zoomt der Sniper (ab Stufe 2), blitzt am Turm ein Lichtreflex auf. Er wird heller, je genauer der Sniper auf den Läufer zielt.
- Hindernisse:
  - Hürden (springen oder rutschen)
  - niedrige Balken (rutschen)
  - Lücken (springen)
  - bewegliche Plattformen (Timing)
  - Sprungpads (hoher Satz, Abkürzung)
  - Deckung: Kisten, Mauern, Fässer

### 4.5 Ausrüstung (Startwerte, Feinschliff in M1/M4)

| Waffe | Geschoss | Schaden Körper/Kopf | Nachladen | Besonderheit |
|---|---|---|---|---|
| Präzisionsgewehr | 180 m/s | 2 / 6 (Kopf = raus) | 1,8 s, 1 Schuss | Standard |
| Halbautomatik | 150 m/s | 1 / 3 | 4 Schuss alle 0,35 s, dann 2,4 s | stärkeres Wackeln |
| Raketenwerfer | 45 m/s, sichtbare Rauchspur | 3 direkt, 1 Splash (3 m) | 2,5 s, 3 Raketen pro Zug | zerstört jede Deckung sofort |

| Gadget | Wirkung |
|---|---|
| Rauch | Eine Wolke folgt dem Läufer 3,5 s und blockiert die Sicht |
| Schild | Fängt den nächsten Treffer ab (bis zu 8 s) |
| Sprint | 2,5 s lang 1,5-fache Geschwindigkeit |
| Köder | Ein falscher Läufer spiegelt deine Spurwechsel 6 s lang und zerplatzt bei Treffer in Konfetti |

Deckung: Kiste 2 TP, Mauer 4 TP, Fass 1 TP. Ein Fass explodiert in Konfetti und beschädigt Deckung in der Nähe, ohne den Läufer zu verletzen. Präzisionsgewehr und Halbautomatik machen 1 Deckungsschaden pro Schuss, der Raketenwerfer zerstört Deckung sofort.

### 4.6 Bots (Übungsmodus, beide Rollen)
- **Läufer-Bot:** Er erkennt Hindernisse voraus, wechselt zufällig die Spur, duckt sich bei Glitzern bzw. direkt nach einem Schuss und nutzt sein Gadget situativ.
- **Sniper-Bot:** Er hält vor (Vorhersage aus der Läufer-Bewegung), mit Reaktionszeit, Zielfehler und Zögern je nach Stufe (Leicht / Mittel / Schwer).

### 4.7 Trophäen und Freischaltungen (M5)
- Sieg +10, Niederlage +3 (so geht es für alle voran). In der Party bringt die Platzierung 10/7/5/3/…
- Freischaltungen nach Trophäen-Stufen:
  - Strecken-Themen (Wiese, Wüste, Eis, Neon-Stadt, Süßwarenland …)
  - Waffen und Gadgets (alle früh, siehe A7)
  - Skins (Farben, Hüte, Brillen)
  - Emotes (Jubeln, Drehen, Tanzen)
- Es gibt keine Käufe und keine Werbung.

---

## 5. Zentrale Config (`shared/src/config.ts`, Auszug)

```ts
export const CONFIG = {
  sim:     { hz: 60, netSendHz: 20, interpDelayMs: 100 },
  track:   { lanes: 3, laneWidth: 2.4, targetLengthM: 210, towerHeightM: 18, towerBehindFinishM: 12 },
  runner:  { speed: 7.0, maxRunS: 45, hp: 6, jumpHeight: 1.4, jumpAirS: 0.6, slideS: 0.7,
             laneChangeS: 0.18, duckHoldMs: 180, stumbleS: 0.6, stumbleSpeedFactor: 0.4, fallPenaltyS: 2.0 },
  hitbox:  { headRadius: 0.22, headY: 1.6, body: { w: 0.6, h: 1.3, d: 0.4 }, duckH: 0.9, slideH: 0.6 },
  weapons: { precision: {...}, semi: {...}, rocket: {...} },   // Werte siehe 4.5
  gadgets: { smoke: {...}, shield: {...}, sprint: {...}, decoy: {...}, usesPerRun: 1 },
  cover:   { crate: 2, wall: 4, barrel: 1 },
  scope:   { fovs: [60, 24, 12, 6], swayDeg: [0, 0.15, 0.3, 0.5], glintFromLevel: 1 },
  net:     { maxRewindMs: 250, lateInputToleranceMs: 120, graceS: 45 },
  match:   { loadoutS: 10, countdownS: 3, turnResultS: 4, roundsToWin: 2 },
  social:  { challengeTimeoutS: 30, inboxTtlMin: 5, inviteLinkTtlDays: 7, transferCodeTtlMin: 15, pairingTtlMin: 10 },
  party:   { minPlayers: 3, maxPlayers: 8, twoSnipersFrom: 6, finishPoints: [5, 4, 3, 2], hitPoints: 1, eliminationPoints: 2 },
  trophies:{ win: 10, loss: 3 },
} as const;
```

Mit `?debug=1` öffnet sich im Spiel ein **Regler-Panel**, mit dem du diese Werte live auf dem iPhone verändern kannst. Gute Werte übernehmen wir dann in die Datei.

---

## 6. Datenmodell (SQLite im HubDO)

```sql
accounts(
  id TEXT PRIMARY KEY,            -- zufällig, 12 Zeichen
  name TEXT NOT NULL, name_lc TEXT NOT NULL, tag INTEGER NOT NULL,   -- „Max#4821“
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER, last_seen INTEGER,
  trophies INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
  cosmetics TEXT DEFAULT '{}',    -- gewählter Skin/Emote (JSON)
  UNIQUE(name_lc, tag)
)
friendships(a TEXT, b TEXT, created_at INTEGER, PRIMARY KEY(a, b))      -- a < b
friend_requests(from_id TEXT, to_id TEXT, created_at INTEGER, PRIMARY KEY(from_id, to_id))
invite_links(token TEXT PRIMARY KEY, owner_id TEXT, created_at INTEGER, expires_at INTEGER, uses INTEGER DEFAULT 0)
challenges(id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, mode TEXT, created_at INTEGER, expires_at INTEGER,
           status TEXT)            -- pending | accepted | declined | expired
transfer_codes(code_hash TEXT PRIMARY KEY, account_id TEXT, expires_at INTEGER)
pairings(ip_hash TEXT, kind TEXT, account_id TEXT, payload TEXT, expires_at INTEGER)  -- kind: account | invite
matches(id TEXT PRIMARY KEY, mode TEXT, started_at INTEGER, ended_at INTEGER, winner_id TEXT)
match_players(match_id TEXT, account_id TEXT, result TEXT, points INTEGER, trophies_delta INTEGER,
              PRIMARY KEY(match_id, account_id))   -- daraus: Bilanz gegen jeden Freund, Rangliste
unlocks(account_id TEXT, item_id TEXT, unlocked_at INTEGER, PRIMARY KEY(account_id, item_id))
push_subscriptions(account_id TEXT, endpoint TEXT PRIMARY KEY, keys TEXT, created_at INTEGER)  -- M6
meta(key TEXT PRIMARY KEY, value TEXT)   -- Schema-Version, IP-Salt
```

Das Schema wird beim Start des DO geprüft und bei Bedarf migriert (Versionsnummer in `meta`).

---

## 7. Netzwerkprotokoll

Alle Nachrichten sind JSON-Objekte mit dem Typfeld `t`. Die Schemas liegen in `shared/protocol` (zod), die Typen werden daraus abgeleitet.

### 7.1 HTTP
| Route | Zweck |
|---|---|
| `GET /version` | `{protocol, server}`: für den Update-Check und den Test in M0 |
| `GET /hub` (Upgrade) | WebSocket zum HubDO |
| `GET /room/:id` (Upgrade) | WebSocket zum RoomDO |

### 7.2 Client ↔ Hub
| Richtung | Nachricht | Inhalt |
|---|---|---|
| → | `hello` | `{v, token?}`: Version und, falls vorhanden, Token |
| ← | `welcome` | `{me, friends[{id,name,tag,status}], requests[], inbox[], protocol}` oder `needAccount` |
| → | `createAccount` | `{name}` → ← `account {id,name,tag,token}` |
| → | `pairingOffer` / `pairingCheck` | Kopplung anbieten (Safari) bzw. abfragen (App), Abschnitt 8 |
| → | `transferCreate` / `transferRedeem` | Übertragungscode erzeugen bzw. einlösen |
| → | `inviteCreate` | → ← `invite {url, expiresAt}` (Link + QR) |
| → | `inviteRedeem` | `{token}` → Freundschaft sofort (der Link gilt als Zustimmung des Einladenden) |
| → | `friendSearch` / `friendRequest` / `friendRespond` / `friendRemove` | Name#Tag-Suche, Anfrage, Annehmen/Ablehnen |
| ← | `presence` | `{id, status: online|match|offline}` (nur an Freunde) |
| ← | `friendEvent` | neue Anfrage / angenommen / entfernt |
| → | `challenge` | `{friendId, mode}` |
| ← | `challengeIncoming` | `{id, from, expiresAt}` → Pop-up mit 30-s-Balken |
| → | `challengeRespond` | `{id, accept}` |
| ← | `roomReady` | `{roomId}` an beide → Client verbindet sich mit dem Room |
| ← | `challengeClosed` | abgelehnt / verfallen / zurückgezogen |
| → | `partyCreate` / `partyInvite {friendId}` | Party-Lobby (ein Room im Lobby-Modus) |
| ← | `partyInviteIncoming` | Pop-up „Lena lädt dich in ihre Party ein“ |
| → | `stats` | → ← Statistik, Bilanz pro Freund, Rangliste |
| ↔ | `ping`/`pong` | Heartbeat (Auto-Response, weckt das DO nicht) |

### 7.3 Client ↔ Room
| Richtung | Nachricht | Inhalt |
|---|---|---|
| → | `join` | `{token}` (M2 noch `{guestName}`) |
| ← | `roomState` | Mitglieder, Modus, Phase, kompletter Match-Zustand (auch nach Reconnect) |
| → | `lobby` | `setMode`, `setSpectator`, `start` (nur Host), `rematch` |
| → | `loadout` | `{item}` |
| ↔ | `sync` | `{c}` → ← `{c, tick}` (Uhr-Abgleich) |
| → | `input` | `{tick, a}` mit `a ∈ left/right/jump/slide/duckOn/duckOff/gadget` (nur Läufer) |
| → | `aim` | `{tick, dir, zoom}` mit 10–15 Hz (für Glitzern und Zuschauer) |
| → | `fire` | `{viewTick, dir, zoom}` |
| ← | `phase` | `{phase, endsAtTick, seed?, theme?, roles, loadouts?}` |
| ← | `snap` | `{tick, r: [[id,z,lane,y,flags,hp,ackTick]], a: [[id,dir,zoom]]}` mit 20 Hz |
| ← | `ev` | `shot`, `hit`, `cover`, `gadget`, `finish`, `out`, `paused`, `resumed`, `turnEnd`, `roundEnd`, `matchEnd {decisive}` |

---

## 8. Konto-, Freundes- und Einladungs-Flows (trotz getrennter Speicher)

**Grundidee:** Das Konto-Token wird an zwei Stellen gespeichert, in `localStorage` **und** in einem Cookie. Beim „Zum Home-Bildschirm“ kopiert iOS (ab 17.2) die Cookies in die App. Falls das nicht klappt, springt die Netzwerk-Kopplung ein. Erst als letzter Ausweg kommt ein Code ins Spiel.

**Netzwerk-Kopplung:** Safari und die Home-Bildschirm-App auf demselben iPhone haben in diesem Moment dieselbe öffentliche IP. Safari legt beim Server einen kurzlebigen Eintrag an (10 min, IP nur gesalzen-gehasht, bei IPv6 das /64-Netz). Die App fragt beim Start, ob für ihre IP etwas wartet. **Es passiert nie etwas ohne Bestätigung per Tipp**, und die App zeigt dabei immer den Namen an.

### Flow A – Neuer Spieler bekommt deinen Einladungslink (WhatsApp/iMessage/QR)
1. Lena tippt auf den Link, Safari öffnet `…/?i=TOKEN`.
2. Safari zeigt: „**Max#4821 lädt dich zu Scope Rush ein!**“ Lena wählt einen Namen. Damit sind Konto **und** Freundschaft mit Max sofort erstellt, und Max bekommt ein Pop-up.
3. Anleitung „Zum Home-Bildschirm“ (mit Bildern: Teilen → Zum Home-Bildschirm → Hinzufügen). Safari legt im Hintergrund eine Konto-Kopplung an.
4. Lena startet die App vom Home-Bildschirm:
   - Der Cookie ist da → sofort eingeloggt. ✔
   - Kein Cookie → die App findet die Kopplung: „**Bist du Lena#1234?** [Ja, weiter] [Nein, neues Konto]“ ✔
   - Beides schlägt fehl → „Konto übertragen“ mit dem Code, der in Safari angezeigt wird.
5. Wer möchte, kann auch direkt in Safari weiterspielen.

### Flow B – Spieler hat die App schon und bekommt einen Link
1. Der Link öffnet sich in Safari, und dort ist (wegen der Speichertrennung) meist kein Konto.
2. Safari zeigt: „**Du hast Scope Rush schon auf dem Home-Bildschirm?** Öffne dort die App, die Einladung von Max wartet dort.“ Darunter steht der Button „Ich bin neu hier“, der zu Flow A führt. Safari legt eine Einladungs-Kopplung an.
3. Lena öffnet die App, die beim Start bzw. bei der Rückkehr nachfragt. Pop-up: „**Max#4821 möchte mit dir befreundet sein** [Annehmen] [Ablehnen]“ ✔
4. Gibt es in Safari doch ein Konto, wird direkt dort angenommen. Das gilt auch für die App, denn die Freundschaft liegt auf dem Server.

### Flow C – QR-Code
Max öffnet „Freunde → Mein QR-Code“, Lena scannt mit der iPhone-Kamera. Es geht weiter wie in Flow A oder B. Der QR-Code wird lokal im Browser erzeugt (kleine Bibliothek, kein externer Dienst).

### Flow D – Name#Tag-Suche
In der App: „Freund hinzufügen → Max#4821“. Max bekommt eine Anfrage (Pop-up bzw. Liste) und kann sie annehmen oder ablehnen.

### Flow E – Gerätewechsel
Einstellungen → „Konto übertragen“ zeigt einen QR-Code und einen 8-stelligen Code (`K7QM-3XPA`, 15 min gültig, nur einmal verwendbar). Das neue Gerät scannt den QR-Code (ab dann wie Flow A ab Schritt 3) oder tippt den Code ein. Das alte Gerät bleibt eingeloggt, bis man sich dort abmeldet.

### Herausfordern und Revanche
- In der Freundesliste tippst du auf „⚔️ Herausfordern“.
  - Ist der Freund **online**, bekommt er ein Pop-up mit 30-s-Balken. Nimmt er an, öffnen sich bei beiden die Ausrüstungswahl und der Room.
  - Ist der Freund **offline**, wartet die Herausforderung 5 Minuten im Posteingang. Öffnet er die App in dieser Zeit: „Max hat dich vor 2 Min. herausgefordert.“ Ist Max inzwischen weg: „Max ist nicht mehr da, [Zurückfordern]“.
- **Revanche:** Nach dem Match tippen beide auf „Revanche“, und es geht im selben Room direkt weiter. Bis der andere zustimmt, steht „Warte auf Max …“ da.

### Party-Lobby
„Party erstellen“ legt einen Room an. Freunde werden mit einem Tipp eingeladen (Pop-up „Beitreten“). Zum Beitreten ohne App-Konto taugt auch ein Party-Link. Der Host wählt den Modus („1v1 mit Zuschauern“ oder „Klassik“). Beim 1v1 mit Zuschauern bleibt der Sieger drin, der nächste aus der Warteschlange fordert ihn heraus.

---

## 9. Teststrategie

- **Unit-Tests (Vitest)** in `/shared`:
  - Bewegung: Sprungkurve, Spurwechsel-Dauer, Hürden-/Lücken-Kollision, bewegliche Plattform, Ducken hinter Deckung
  - Ballistik: Flugbahn, Flugzeit, Segment-gegen-Kugel/Box, Deckung blockiert, Splash
  - Lag-Kompensation: Ringpuffer, Zurückspulen, Deckel bei 250 ms, verspätete Eingaben
  - Punktewertung: alle Rundensieg-Regeln, Best of 3, Klassik-Punkte, Rotation
  - Streckengenerator: gleicher Seed = gleiche Strecke, jede Strecke ist lösbar und ein sauberer Lauf dauert 27–33 s (Bot-Lauf im Test)
  - Determinismus: gleiche Eingaben ⇒ gleicher Zustands-Hash
- **Server-Tests** mit `@cloudflare/vitest-pool-workers`: Hub-Flows (Konto, Freunde, Herausforderung, Kopplung) und ein Room-Match mit zwei simulierten Clients.
- **Netzwerk lokal:** `pnpm dev` + zwei Browserfenster mit `?lag=150&jitter=40`. Zusätzlich ein Skript, das zwei Bot-Clients gegen `wrangler dev` ein komplettes Match spielen lässt.
- **Browser-Smoke-Test** (Playwright, iPhone-Viewport): Seite lädt, Hochformat-Hinweis, keine Konsolenfehler, Screenshot.
- **Ladegröße:** Die CI bricht ab, wenn der Build über 5 MB liegt.
- **iPhone-Checkliste** am Ende jedes Meilensteins (von dir abzuhaken).

---

## 10. Deployment

GitHub Actions bei jedem Push auf `main`:
1. **check:** `pnpm install` → Typecheck → Tests → Build → Größenprüfung
2. **deploy-worker:** `wrangler deploy` (über `cloudflare/wrangler-action`, mit den Secrets `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID`). Die Worker-URL wird automatisch ausgelesen. Fehlen die Secrets noch, wird dieser Schritt mit Hinweis übersprungen.
3. **deploy-pages:** Client mit der Worker-URL bauen → GitHub Pages

Die Schritt-für-Schritt-Anleitung für GitHub und Cloudflare kommt mit M0 (Datei `docs/SETUP.md`).

---

## 11. Meilensteine

Am Ende jedes Meilensteins: Tests grün → Deploy → kurze Zusammenfassung + iPhone-Checkliste → **warten auf dein Feedback**.

### M0 – Grundgerüst und Pipeline
- Monorepo (pnpm, TypeScript strict), Vite + Three.js, Worker mit HubDO/RoomDO-Gerüst und `new_sqlite_classes`
- GitHub-Actions-Workflow, `docs/SETUP.md` (GitHub Pages aktivieren, Cloudflare-Konto, API-Token, Secrets)
- **Testseite:** Low-Poly-Turm und Läufer drehen sich im Hochformat, dazu:
  - FPS-Anzeige
  - Safe-Area-Rahmen
  - Hochformat-Hinweis
  - Wisch-Test (zeigt die erkannte Geste)
  - Ton-Test
  - Server-Test (`/version` + WebSocket-Echo mit Ping-Anzeige)
  - Home-Bildschirm-Anleitung
  - PWA-Manifest und Service Worker
  - Versionsanzeige
- ✅ Abnahme: Die Testseite läuft live auf deinem iPhone, auch als Home-Bildschirm-App.

### M1 – Offline-Prototyp gegen Bots (Spielspaß finden)
- Eine Strecke aus 6–8 Segmenten (Hürden, Lücke, bewegliche Plattform, Sprungpad, Deckung)
- Läufer-Steuerung komplett. Sniper-Zielen mit Zoomstufen, Wackeln, Flugzeit und Nachladen (Präzisionsgewehr). Zerstörbare Deckung, Glitzern.
- Läufer- und Sniper-Bot, beide Rollen spielbar, ein kompletter Zug inklusive Ergebnis
- Sniper-Steuerung A und B umschaltbar, Empfindlichkeit, Gyroskop (experimentell)
- Debug-Regler-Panel (`?debug=1`)
- ✅ Abnahme: Du spielst auf dem iPhone beide Rollen gegen Bots mit 60 FPS. Danach gibst du Feedback zu Spielgefühl und Steuerungsvariante.

### M2 – Online-1v1 per Raum-Link
- RoomDO mit Server-Simulation, Uhr-Abgleich, Vorhersage, Interpolation, Lag-Kompensation
- Rollentausch, Rundenwertung, Best of 3, Ergebnis-Bildschirm, Revanche im Room
- Reconnect und Pause mit Schonfrist nach App-Wechsel
- Test-Einstieg: „Raum erstellen“ → Link teilen → Freund öffnet ihn und gibt einen Gastnamen ein (vorübergehend)
- Lag-Simulator und Zwei-Bot-Client-Skript
- ✅ Abnahme: Zwei iPhones (WLAN + Mobilfunk) spielen ein Duell, eines wechselt zwischendurch kurz zu WhatsApp, danach geht es weiter.

### M3 – Konten, Freunde, Herausforderungen
- Konto ohne Passwort (Name#Tag), Cookie + localStorage, Netzwerk-Kopplung, Übertragungscode/-QR
- Einladungslink über das iOS-Teilen-Menü, QR-Code, Name#Tag-Suche, Anfragen annehmen/ablehnen
- Freundesliste mit Status, Herausforderung per Pop-up (30 s), Posteingang (5 min)
- Party-Lobby (Einladen, Beitreten, Modus wählen, Zuschauer), Revanche
- Versions-Check „Update verfügbar“
- ✅ Abnahme: Zwei iPhones werden einmal per Link Freunde und fordern sich danach nur noch per Tipp heraus, ohne Code.

### M4 – Ausrüstung, Strecken, Klassik
- Alle 3 Waffen und 4 Gadgets inklusive Auswahl-Bildschirm
- Streckengenerator mit ca. 12 Segmenttypen und 3 Themen, Lösbarkeits-Test
- Party-Modus „Klassik“ (3–8 Spieler, 1–2 Sniper, Rotation, Punkte, Zuschauen durchs Zielfernrohr)
- ✅ Abnahme: Vier Geräte spielen eine Klassik-Runde.

### M5 – Feinschliff
- Prozedurale Sounds und Effekte (Mündungsfeuer, Kugelspur, Konfetti, Bildschirm-Wackeln), Bullet-Cam in Zeitlupe, Sieger-Emotes
- Trophäen, Freischaltungen (Themen, Skins, Emotes), Statistiken (Bilanz pro Freund, Rangliste)
- Tutorial beim ersten Start (interaktiv, offline), Leistungs-Feinschliff auf dem iPhone 12
- Haptik-Experiment (Switch-Trick, falls er auf deinem iOS noch geht)
- ✅ Abnahme: die „Fertig heißt“-Kriterien aus deiner Beschreibung.

### M6 (optional) – Push bei Herausforderungen
- Web-Push nur für die Home-Bildschirm-App (iOS ≥ 16.4): Berechtigung per Tipp, VAPID und Verschlüsselung direkt im Worker (WebCrypto), kein externer Dienst, 0 €
- ✅ Abnahme: Die App ist geschlossen, eine Herausforderung kommt trotzdem als Mitteilung an.

---

## 12. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Spielgefühl stimmt nicht (zu leicht/schwer für Sniper) | M1 ist reine Spielspaß-Phase mit Debug-Reglern. Geschoss-Tempo, Wackeln und Nachladezeit sind die wichtigsten Stellschrauben. |
| Ruckeln auf dem iPhone 12 | Leistungsbudget von Anfang an (Draw-Calls, Pixel-Ratio, keine Shadow-Maps), FPS-Anzeige, automatische Qualitätsstufe |
| Cookie-Übernahme funktioniert auf deinem iOS anders | Netzwerk-Kopplung und Code als Rückfallebenen, Test im M3-Check |
| Netzwerk-Kopplung im selben WLAN (z. B. Spieleabend) | Immer mit Namensanzeige und Bestätigung. Ein Eintrag wird nur einmal verwendet und verfällt nach 10 min. |
| Free-Plan-Grenze überschritten | Sparsames Protokoll, Hibernation, Nutzungsanzeige. Selbst im schlimmsten Fall kostet es nichts, die Aufrufe schlagen dann nur bis 01:00 Uhr fehl. |
| Apple ändert Web-App-Verhalten | Plattformcode gekapselt in `client/src/platform/`, eine iPhone-Checkliste pro Meilenstein |

---

## 13. Entschiedene Fragen

- **F1 – URL:** Das Repo wird in `runners-vs-snipers` umbenannt. Spiel: `https://m4tt3s-209.github.io/runners-vs-snipers/`. Der Spieltitel bleibt „Scope Rush“ (Arbeitstitel).
- **F2 – Cloudflare:** Es gibt noch kein Konto. Die Anleitung von null steht in [docs/SETUP.md](docs/SETUP.md).
- **F3 – Geräte:** nur iPhone.
