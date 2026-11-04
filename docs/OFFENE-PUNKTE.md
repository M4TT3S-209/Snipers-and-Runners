# Offene Punkte für dich

Hier sammle ich alles, wofür ich **deine Entscheidung, deinen Test auf dem iPhone oder eine Einstellung von dir** brauche. Ich arbeite in der Zwischenzeit weiter. Wenn du Zeit hast, geh die Liste von oben nach unten durch und antworte einfach mit der Nummer, z. B. „3: Variante B fühlt sich besser an“.

Legende: 🔧 = musst du tun · 🎮 = bitte testen und Meinung sagen · ❓ = Entscheidung

---

## Einrichtung (damit alles online geht)

1. 🔧 **Repo umbenennen** in `runners-vs-snipers`: [docs/SETUP.md](SETUP.md), Teil A1
2. 🔧 **GitHub Pages einschalten** (Source: „GitHub Actions“): SETUP.md, Teil A2
3. 🔧 **Cloudflare-Konto anlegen**, Subdomain wählen, API-Token erstellen: SETUP.md, Teil B
4. 🔧 **Zwei Secrets bei GitHub eintragen** (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`): SETUP.md, Teil C
5. 🔧 **Ersten Deploy starten** (Actions → Deploy → Run workflow) und mir sagen, ob alles grün ist

Solange 1–4 fehlen, laufen die Tests trotzdem bei jedem Push. Server und Spielseite werden dann nur übersprungen, mit einer gelben Warnung statt eines Fehlers.

## Spielgefühl (M1 – Offline gegen Bots)

6. 🎮 **Sniper-Steuerung**: In den Einstellungen gibt es zwei Varianten:
   - **A) „Ziehen + Feuer-Knopf“** (Standard)
   - **B) „Halten, ziehen, loslassen“**: Finger aufsetzen = Zielfernrohr an, loslassen = Schuss

   Welche fühlt sich besser an? Die bessere wird Standard.
7. 🎮 **Kugel-Tempo und Vorhalten**: Das Präzisionsgewehr fliegt mit 180 m/s, über die ganze Strecke ca. 1,2 s. Zu leicht oder zu schwer? Mit `?debug=1` hinter der Adresse kannst du es im Spiel live verstellen (🛠-Knopf) und mir die Werte über „Werte kopieren“ schicken.
8. 🎮 **Empfindlichkeit beim Zielen**: Standardwert passend? (Einstellungen → Ziel-Empfindlichkeit)
9. 🎮 **Gyroskop-Zielen** (Einstellungen → An): brauchbar oder eher störend?
10. 🎮 **Bot-Stärke**: Ist „Mittel“ ein guter Gegner?
    - Meine Messung mit Bots gegeneinander (Bot-Läufer gegen Bot-Sniper, beide „Mittel“): ca. 40 % der Läufer kommen ins Ziel.
    - Ein sauberer Lauf ohne Sniper dauert im Schnitt 30,8 s (Ziel waren ca. 30 s ✔).
11. 🎮 **Wischgesten**: Werden Wischer zuverlässig erkannt? Ist „Halten = Ducken“ (nach 0,17 s) zu schnell oder zu langsam?

## Online-Duell (M2 – sobald Teil 1–5 erledigt sind)

12. 🎮 **Duell mit zwei iPhones** (am besten eins im WLAN, eins im Mobilfunk):
    1. iPhone A: Menü → „🌐 Online-Duell per Link“ → „Link teilen“ → per WhatsApp an iPhone B schicken
    2. iPhone B: Link antippen → Namen eingeben → beide tippen „Bereit!“
    3. Ein komplettes Duell spielen (bis zum Sieger), dann „Revanche“
    4. Mitten im Lauf auf einem iPhone kurz zu WhatsApp wechseln und zurück → das Spiel sollte pausieren („… ist kurz weg“) und nach 3 s weiterlaufen
    5. Bitte sagen: Fühlt sich das Ausweichen fair an? Gibt es Treffer, die „unmöglich“ aussahen?

## Freunde & Herausforderungen (M3)

13. 🎮 **Freund hinzufügen ohne Code-Eintippen**: Freunde → „Einladungslink teilen“ → per WhatsApp an einen Freund. Er tippt drauf, wählt einen Namen, und ihr seid befreundet. Alternativ den QR-Code zeigen und mit der iPhone-Kamera scannen lassen.
14. 🎮 **Home-Bildschirm nach dem Einladungslink**: Nach dem Namen erscheint die Anleitung „Zum Home-Bildschirm“. Danach sollte die App **ohne** erneute Namenswahl starten (Cookie-Übernahme von iOS). Falls doch nach dem Namen gefragt wird, sollte stattdessen „Bist du …?“ erscheinen (Netzwerk-Kopplung). Bitte sag mir, was bei dir passiert ist. Das ist die wichtigste iOS-Unbekannte.
15. 🎮 **Herausfordern**: In der Freundesliste auf ⚔️ tippen. Beim Freund erscheint ein Pop-up mit 30-Sekunden-Balken. Ist er offline, wartet die Herausforderung 5 Minuten.
16. 🎮 **Party**: Freunde → „Party erstellen“ → Freunde einladen → Gastgeber wählt Modus „Klassik“ → ab 3 Spielern auf „Bereit“.
17. ❓ **Datenschutz-Hinweis**: Für die Netzwerk-Kopplung speichert der Server deine IP-Adresse 10 Minuten lang als verschlüsselten Fingerabdruck (nicht lesbar). Ist das für euch okay? Sonst lasse ich die Kopplung weg, dann bleiben nur Cookie und Übertragungscode.

## Beobachtungen beim Balancing (zur Info, keine Antwort nötig)

- Der Turm ist hoch, die Kugeln kommen deshalb recht flach. Fehler nach vorn oder hinten verzeiht das Spiel, Fehler zur Seite und in der Höhe kaum. Ausweichen per **Spurwechsel** ist für Läufer deshalb die wichtigste Verteidigung, neben Deckung. Ich finde das gut so. Falls dir Treffen zu leicht vorkommt, wären die Stellschrauben: Kugel langsamer machen oder mehr Wackeln im Zielfernrohr.

## Später (wenn wir dort ankommen)

- ✔ Party-Modus: Mitläufer sind in der Läufer-Sicht halb durchsichtig und kollidieren nicht. Sag Bescheid, falls du es anders willst.
- ✔ „1v1 mit Zuschauern“: Der Sieger bleibt, der nächste wartende Freund fordert ihn heraus (Revanche-Knopf des Siegers).
- ❓ Namensfilter: Gibt es Wörter, die in eurem Freundeskreis auf keinen Fall als Name gehen sollen (oder gerade unbedingt erlaubt sein müssen)?
