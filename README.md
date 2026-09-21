# OPL 4NE1 Gen4 – Open Point List Tool

Schlanke Web-App zum Anlegen, Bearbeiten, Filtern und Verfolgen offener Punkte
der 4NE1-Gen4-Entwicklung. Gedacht als aufgeräumte Version der bestehenden
Excel-Liste – ein Klick statt Zeilen-Editing, kein Formelwissen nötig.

Kein Build-Step, keine Abhängigkeiten, kein Internet nötig:
`index.html` im Browser öffnen, fertig.

## Starten

| Weg | Vorgehen |
|---|---|
| Lokal | `index.html` doppelklicken |
| Im Team | Ordner auf einen Webserver/Fileshare legen und die URL teilen |
| Lokaler Testserver | `python3 -m http.server 8000`, dann <http://localhost:8000> |
| Öffentlich per URL | GitHub Pages, siehe „Deployment“ |

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` deployt das Repo-Root bei jedem Push als statische
Seite – kein Build, keine Abhängigkeiten. Einmalig nötig:

1. Push auf `main` (oder einen `claude/**`-Branch) bzw. **Actions → Deploy to
   GitHub Pages → Run workflow** manuell auslösen. Pages wird dabei per
   `enablement: true` automatisch auf „GitHub Actions” gestellt – kein Klick in
   den Settings nötig.
2. Die URL steht danach unter Settings → Pages bzw. am Deploy-Job:
   `https://<user>.github.io/OPL-Gen4-overview/`

Hinweise:

- Bei einem **privaten** Repo braucht GitHub Pages einen bezahlten Plan (Pro/Team/
  Enterprise). Auf dem Free-Plan das Repo auf public stellen oder anders hosten
  (SharePoint-Ordner, interner Webserver, Netlify/Vercel – überall reicht das
  Hochladen der Dateien, da kein Build nötig ist).
- Die Pages-Site eines **public** Repos ist immer öffentlich erreichbar.
- Pages liefert nur die Dateien aus. Der **Datenstand bleibt pro Browser** im
  localStorage – eine öffentliche URL macht daraus noch keinen gemeinsamen
  Live-Stand, siehe „Offene Punkte“.

## Bedienung

- **Ampel-Punkt anklicken** → Prio wechselt Hoch → Mittel → Niedrig.
- **Status-Chip anklicken** → Offen → In Arbeit → Erledigt.
- **Datum-/Personen-Chip anklicken** → Dialog springt direkt auf das Feld.
- **✎ oben rechts auf der Karte** (oder Doppelklick auf eine Tabellenzeile) → Punkt bearbeiten.
- **KPI-Kacheln oben** sind Schnellfilter (z. B. nur überfällige Punkte).
- **Taste `n`** legt einen neuen Punkt an.
- Erledigte Punkte werden nicht gelöscht, sondern landen in der einklappbaren
  Sektion **„✓ Erledigt“**.
- Überfällig = Datum „Bis wann“ liegt vor heute **und** Status ≠ Erledigt.
  Die Badge oben pulsiert rot, sobald es überfällige Punkte gibt.

## Excel-Export und -Import

Über das Menü **⋯** oben rechts:

- **Excel-Export (.xlsx)** – erzeugt eine Datei im **exakt gleichen Schema** wie die
  bestehende OPL-Excel: Titelzeile, KPI-Block mit lebenden `COUNTA`/`COUNTIF`-Formeln,
  Kopfzeile in Zeile 7, Daten ab Zeile 8, Spalten `Nr | Bereich | Thema/Aufgabe | Prio |
  Verantwortlicher | Bis wann | Status | To Do | Bild`. Inklusive Spaltenbreiten,
  Ampelfarben, fixierter Kopfzeile, Autofilter und Dropdown-Validierung für
  Bereich/Prio/Status. Überfällige Termine sind in der Excel rot hervorgehoben.
- **Excel-Import (.xlsx)** – liest dieses Schema wieder ein. Die Kopfzeile wird
  automatisch gesucht (Zeile mit `Nr` in Spalte A und `Bereich` in Spalte B), Titel-
  und KPI-Zeilen darüber werden ignoriert. Vor dem Import zeigt eine Vorschau, wie
  viele Zeilen gelesen wurden und welche Werte korrigiert werden mussten.
  - **Zusammenführen** (Standard): Einträge mit bekannter `Nr` werden aktualisiert,
    unbekannte kommen dazu.
  - **Ersetzen**: Der aktuelle Stand wird komplett durch die Datei ersetzt.
- **CSV-Export** für alles, was lieber CSV frisst (UTF-8 mit BOM, Semikolon-getrennt).

Damit lässt sich offline in Excel weiterarbeiten und der Stand danach wieder
einspielen. Datumsangaben werden sowohl als Text (`25.09.2026`) als auch als echte
Excel-Datumswerte erkannt.

**Bilder** liegen nicht in der Excel-Datei (dort steht nur ein Hinweis in Spalte
„Bild“). Beim Import bleiben lokal vorhandene Bilder anhand der `Nr` erhalten.

Export und Import kommen ohne externe Bibliothek aus – `js/xlsx-io.js` schreibt und
liest die xlsx-Pakete direkt (ZIP + OOXML). Nichts wird nachgeladen, nichts verlässt
den Rechner.

## Datenhaltung

Der Stand liegt im **localStorage des Browsers** und wird nach jeder Änderung sofort
gespeichert. Beim ersten Start werden die 29 Punkte aus
`assets/OPL_4NE1_Gen4_Vorlage.xlsx` (Stand 21.09.2026) geladen.

> **Wichtig:** Das ist damit ein Stand **pro Browser/Gerät**, kein Live-Server.
> Der Abgleich im Team läuft über Excel-Export/-Import. Für einen echten gemeinsamen
> Live-Stand bräuchte es ein Backend – siehe „Offene Punkte“ unten.

Das Menü **⋯ → Änderungsprotokoll** zeigt, wer wann was geändert hat (Name im Feld
oben rechts eintragen). **⋯ → Auf Excel-Startstand zurücksetzen** verwirft alles und
lädt die Ausgangsliste neu.

## Dateien

```
index.html          Oberfläche
css/app.css         Styles (Desktop, Tablet, Handy)
js/seed.js          Startdaten, generiert aus der Excel-Vorlage
js/xlsx-io.js       xlsx-Export/-Import ohne Fremdbibliothek
js/store.js         Datenhaltung, Persistenz, Änderungsprotokoll
js/app.js           Rendering, Filter, Dialoge
assets/OPL_4NE1_Gen4_Vorlage.xlsx   Ausgangsliste (Stand 21.09.2026)
assets/img/         Bilder zu Punkt #26 (Kollision Bein, aus dem Mechanik-Review)
```

## Browser

Aktueller Chrome, Edge, Firefox oder Safari. Der Excel-**Import** braucht
`DecompressionStream` (Chrome/Edge 103+, Firefox 113+, Safari 16.4+); fehlt die API,
meldet das Tool das verständlich statt stillschweigend zu scheitern. Alles andere
funktioniert auch in älteren Browsern.

## Offene Punkte

- **Gemeinsamer Live-Stand**: aktuell Excel-Austausch statt Server. Ein kleines
  Backend (oder eine SharePoint-/Teams-Ablage mit einer Datei) wäre der nächste
  Schritt, wenn mehrere gleichzeitig pflegen sollen.
- **Bilder** vergrößern den localStorage schnell; sie werden beim Hochladen auf
  max. 1400 px skaliert und als JPEG (Qualität 0.82) abgelegt. Bei „Speichern
  fehlgeschlagen“ hilft exportieren und Bilder reduzieren.
