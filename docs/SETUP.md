# Einrichtung: GitHub und Cloudflare (einmalig, ca. 20 Minuten)

Diese Anleitung machst du **nur einmal**. Danach geht jede neue Version automatisch online, sobald neuer Code auf `main` landet.

Alles hier ist **kostenlos** und braucht **keine Kreditkarte**. Wenn dich eine Seite nach Zahlungsdaten oder einem Upgrade fragt, brich ab und melde dich bei mir. Für dieses Projekt brauchen wir das nie.

> 💡 Am besten am Computer erledigen. Auf dem iPhone geht es auch, ist aber fummeliger.

---

## Teil A – GitHub (5 Minuten)

### A1. Repository umbenennen
Damit lautet die Spieladresse später `https://m4tt3s-209.github.io/runners-vs-snipers/`.

1. Öffne https://github.com/M4TT3S-209/Snipers-and-Runners
2. Klicke oben auf **⚙️ Settings**. Auf dem Handy steckt es eventuell im Menü „…“.
3. Ganz oben steht **Repository name**. Trage ein: `runners-vs-snipers` (alles klein).
4. Klicke auf **Rename**.

GitHub leitet die alte Adresse automatisch weiter, dabei geht nichts kaputt.

### A2. GitHub Pages einschalten
1. Im selben Repository: **⚙️ Settings** → in der linken Spalte **Pages**.
2. Unter **Build and deployment** → **Source** wählst du **GitHub Actions**. Nicht „Deploy from a branch“.
3. Ein Speichern-Button ist nicht nötig, die Auswahl gilt sofort.

---

## Teil B – Cloudflare (10 Minuten)

Cloudflare betreibt unseren Spiel-Server: Konten, Freunde und die Online-Matches.

### B1. Konto anlegen
1. Öffne https://dash.cloudflare.com/sign-up
2. E-Mail-Adresse und ein sicheres Passwort eingeben → **Sign up**.
3. Bestätige die E-Mail, die Cloudflare dir schickt (Link anklicken). Ohne bestätigte E-Mail kann man nichts veröffentlichen.
4. Falls Cloudflare nach einer **Website/Domain** fragt: überspringen („Skip“ oder einfach zur Startseite zurück). Wir brauchen keine eigene Domain.

### B2. Deine `workers.dev`-Adresse festlegen
1. Klicke in der linken Spalte auf **Workers & Pages**. Je nach Version liegt es unter **Compute (Workers)**.
2. Beim ersten Besuch fragt Cloudflare nach einer **Subdomain**. Wähle einen kurzen Namen, z. B. `m4tt3s`. Den Namen kannst du später nicht mehr ohne Weiteres ändern.
   - Wirst du nicht gefragt: Auf derselben Seite steht rechts **Subdomain** mit `…workers.dev`. Wenn dort schon etwas steht, ist alles gut.
3. Der Server ist danach erreichbar unter `https://runners-vs-snipers.<deine-subdomain>.workers.dev`.
4. Falls Cloudflare einen **Plan** anbietet: **Free** auswählen.

### B3. Account-ID kopieren
1. Bleib auf **Workers & Pages**. Rechts (oder unten) steht **Account ID**, eine lange Zeichenfolge aus Ziffern und Buchstaben a–f.
2. Kopiere sie und leg sie dir kurz in eine Notiz.
   - Alternative: Sie steht auch in der Adresszeile des Browsers, direkt nach `dash.cloudflare.com/`.

### B4. API-Token erstellen
Mit dem Token darf GitHub den Server in deinem Namen hochladen.

1. Öffne https://dash.cloudflare.com/profile/api-tokens. Alternativ: oben rechts auf dein Profil-Symbol → **Profile** → **API Tokens**.
2. Klicke auf **Create Token**.
3. Bei der Vorlage **Edit Cloudflare Workers** klickst du auf **Use template**.
4. Unten bei den Ressourcen:
   - **Account Resources**: `Include` → dein Konto auswählen
   - **Zone Resources**: `Include` → `All zones` (du hast keine Zonen, das ist in Ordnung)
5. **Continue to summary** → **Create Token**.
6. Der Token wird **nur ein einziges Mal** angezeigt. Kopiere ihn sofort (Copy-Button).

> 🔒 **Der Token ist wie ein Schlüssel.** Gib ihn niemandem, auch nicht mir im Chat. Er gehört nur in die GitHub-Secrets (Teil C). Wenn er doch einmal irgendwo landet, wo er nicht hingehört: auf derselben Seite **Roll** oder **Delete** klicken und einen neuen erstellen.

---

## Teil C – Schlüssel bei GitHub hinterlegen (3 Minuten)

1. Öffne dein Repository auf GitHub → **⚙️ Settings**.
2. Linke Spalte: **Secrets and variables** → **Actions**.
3. Klicke auf **New repository secret** und lege nacheinander zwei Secrets an:

| Name (genau so schreiben) | Wert |
|---|---|
| `CLOUDFLARE_API_TOKEN` | der Token aus B4 |
| `CLOUDFLARE_ACCOUNT_ID` | die Account-ID aus B3 |

Jeweils mit **Add secret** speichern. Die Werte kann danach niemand mehr ansehen, auch du nicht. Das ist gewollt.

---

## Teil D – Ersten Deploy starten (3 Minuten)

1. Im Repository oben auf **▶ Actions** klicken.
2. Links **Deploy** auswählen → rechts **Run workflow** → Branch `main` → **Run workflow**.
3. Nach 1–3 Minuten sollten alle drei Schritte einen grünen Haken haben:
   - ✅ Prüfen (Typen + Tests)
   - ✅ Server → Cloudflare
   - ✅ Spiel → GitHub Pages
4. Klick auf den Lauf. In der Zusammenfassung stehen beide Adressen: die **Server-Adresse** und unter „Spiel → GitHub Pages“ der Link zum Spiel.

Ab jetzt läuft das bei jedem Push auf `main` automatisch.

---

## Teil E – Aufs iPhone

1. Öffne in **Safari** auf dem iPhone: `https://m4tt3s-209.github.io/runners-vs-snipers/`
2. Die Testseite erklärt dir, wie du sie **zum Home-Bildschirm** hinzufügst:
   **⋯** bzw. Teilen-Symbol → **Teilen** → **Zum Home-Bildschirm** → „Als Web-App öffnen“ an lassen → **Hinzufügen**.
3. Ab dann Scope Rush immer über das neue Symbol starten.

---

## Wenn etwas nicht klappt

| Was du siehst | Was es bedeutet | Lösung |
|---|---|---|
| Gelbe Warnung **„Cloudflare noch nicht eingerichtet“** im Actions-Lauf | Die Secrets fehlen oder sind falsch geschrieben | Teil C prüfen: Namen exakt wie in der Tabelle |
| Gelbe Warnung **„GitHub Pages noch nicht eingeschaltet“** | Pages steht nicht auf „GitHub Actions“ | Teil A2 |
| Roter Fehler mit **„Authentication error“** oder **„code: 10000“** | Token falsch oder ohne Rechte | Neuen Token mit der Vorlage aus B4 erstellen und das Secret ersetzen |
| Fehler mit **„workers.dev subdomain“** | Noch keine Subdomain festgelegt | Teil B2 |
| Auf der Testseite steht **„Noch kein Server eingerichtet“** | Der Server-Schritt wurde übersprungen | Teil B + C erledigen, dann Teil D wiederholen |
| Die Spielseite zeigt **404** | Pages braucht nach dem ersten Mal 1–2 Minuten, oder die Adresse ist vertippt | Kurz warten, Adresse prüfen (Repo-Name aus A1) |

Wenn du nicht weiterkommst: Schreib mir, welcher Schritt hakt, und schick einen Screenshot. **Ohne** Token natürlich 😉
