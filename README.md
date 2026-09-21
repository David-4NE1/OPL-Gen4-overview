# OPL 4NE1 Gen4 – Open Point List Tool

Schlanke Web-App zum Anlegen, Bearbeiten, Filtern und Verfolgen offener Punkte
der 4NE1-Gen4-Entwicklung. Gedacht als aufgeräumte Version der bestehenden
Excel-Liste – ein Klick statt Zeilen-Editing, kein Formelwissen nötig.

Kein Build-Step, keine Fremdbibliotheken – weder im Browser noch auf dem Server.

## Starten

**Im Team (empfohlen): mit Server, alle sehen denselben Live-Stand.**

```bash
node server/server.js          # oder: npm start
```

Dann <http://localhost:8787> öffnen bzw. die Adresse des Rechners im Team teilen.
Änderungen landen sofort beim Server und werden per Server-Sent-Events an alle
offenen Browser verteilt – kein Neuladen, kein „wer hat zuletzt gespeichert“.
Oben im Kopf zeigt eine Plakette **● Live**, dass die Verbindung steht.

Voraussetzung: Node 18 oder neuer. Sonst nichts – kein `npm install`.

| Umgebungsvariable | Standard | Zweck |
|---|---|---|
| `PORT` | `8787` | Port |
| `HOST` | `0.0.0.0` | Netzwerk-Interface (`127.0.0.1` = nur lokal) |
| `OPL_DATA` | `./data` | Ordner für `opl.json` und hochgeladene Bilder |

**Ohne Server** funktioniert weiterhin alles: `index.html` doppelklicken. Die App
merkt, dass kein Backend da ist, zeigt **● Lokal** und hält den Stand im
localStorage. Austausch dann über Excel-Export/-Import.

## Betrieb

Der Server ist ein einzelner Node-Prozess ohne Abhängigkeiten. Beispiel als
systemd-Dienst (`deploy/opl.service`) oder per Docker (`deploy/Dockerfile`):

```bash
docker build -t opl-gen4 -f deploy/Dockerfile .
docker run -d -p 8787:8787 -v opl-daten:/data -e OPL_DATA=/data --name opl opl-gen4
```

Die Daten liegen in `$OPL_DATA/opl.json` (bei jeder Änderung atomar geschrieben)
und `$OPL_DATA/images/`. Für ein Backup reicht es, diesen Ordner zu sichern.

**Kein Login.** Das Tool ist für den internen Gebrauch gedacht und hat bewusst
keine Nutzerverwaltung – wer die URL erreicht, darf lesen und schreiben. Also
nicht ungeschützt ins offene Netz stellen, sondern ins Firmennetz bzw. VPN, oder
einen Reverse Proxy mit Authentifizierung davorsetzen. Der Name im Feld oben
rechts dient nur dem Änderungsprotokoll, nicht der Zugangskontrolle.

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

## Datenhaltung und gleichzeitiges Arbeiten

Im **Servermodus** hält der Server den Stand; jede Änderung wird sofort in
`data/opl.json` geschrieben und an alle verbundenen Browser verteilt. Beim ersten
Start werden die 29 Punkte aus `js/seed.js` (generiert aus
`assets/OPL_4NE1_Gen4_Vorlage.xlsx`, Stand 21.09.2026) übernommen.

Damit sich zwei Leute nicht gegenseitig überschreiben, hat jeder Punkt eine
Versionsnummer. Wer auf einem veralteten Stand aufsetzt, bekommt den aktuellen
Stand angezeigt statt ihn zu überschreiben („Punkt #7 wurde zwischenzeitlich von
Anna geändert – aktueller Stand übernommen“). Änderungen erscheinen sofort in der
eigenen Ansicht und werden vom Server bestätigt; schlägt das fehl, springt die
Anzeige zurück und sagt warum.

Reißt die Verbindung ab, wechselt die Plakette auf **● Getrennt**, die App
verbindet sich selbst wieder und holt den verpassten Stand nach.

Im **lokalen Modus** liegt der Stand im localStorage dieses Browsers.

Das Menü **⋯ → Änderungsprotokoll** zeigt, wer wann was geändert hat (Name im Feld
oben rechts eintragen). **⋯ → Auf Excel-Startstand zurücksetzen** verwirft alles und
lädt die Ausgangsliste neu – im Servermodus für das ganze Team.

## API

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/health` | Erreichbarkeitsprüfung |
| `GET` | `/api/state` | kompletter Stand `{rev, entries, log}` |
| `GET` | `/api/events` | Server-Sent-Events mit allen Änderungen |
| `POST` | `/api/entries` | Punkt anlegen |
| `PATCH` | `/api/entries/:nr` | Punkt ändern (mit Versionsprüfung, sonst `409`) |
| `DELETE` | `/api/entries/:nr?user=` | Punkt löschen |
| `POST` | `/api/import` | Excel-Import (`zusammenfuehren` \| `ersetzen`) |
| `POST` | `/api/reset` | zurück auf den Excel-Startstand |
| `POST` | `/api/images` | Bild hochladen (JPEG/PNG/WebP/GIF, max. 8 MB) |

## Tests

```bash
npm test     # 45 Prüfungen gegen die API: Anlegen, Versionskonflikte, Import,
             # Bilder, Zugriffsschutz, Persistenz über einen Neustart
```

## Dateien

```
index.html          Oberfläche
css/app.css         Styles (Desktop, Tablet, Handy)
js/seed.js          Startdaten, generiert aus der Excel-Vorlage
js/xlsx-io.js       xlsx-Export/-Import ohne Fremdbibliothek
js/api.js           Verbindung zum Server (HTTP + Server-Sent-Events)
js/store.js         Datenhaltung in beiden Modi, Änderungsprotokoll
js/app.js           Rendering, Filter, Dialoge
server/server.js    Backend: API, Live-Verteilung, statische Auslieferung
test/api.test.js    Tests gegen die API
deploy/             Dockerfile und systemd-Unit
assets/OPL_4NE1_Gen4_Vorlage.xlsx   Ausgangsliste (Stand 21.09.2026)
assets/img/         Bilder zu Punkt #26 (Kollision Bein, aus dem Mechanik-Review)
data/               wird vom Server angelegt (nicht im Git)
```

## Browser

Aktueller Chrome, Edge, Firefox oder Safari. Der Excel-**Import** braucht
`DecompressionStream` (Chrome/Edge 103+, Firefox 113+, Safari 16.4+); fehlt die API,
meldet das Tool das verständlich statt stillschweigend zu scheitern. Alles andere
funktioniert auch in älteren Browsern.

## Grenzen und mögliche nächste Schritte

- **Kein Login**: siehe „Betrieb“. Für den Einsatz außerhalb des Firmennetzes
  bräuchte es einen Reverse Proxy mit Authentifizierung.
- **Eine Datei als Speicher**: `opl.json` wird komplett gelesen und geschrieben.
  Für die Größenordnung einer OPL (Hunderte Punkte, eine Handvoll Bearbeiter)
  völlig ausreichend; für Tausende Einträge wäre SQLite der nächste Schritt.
- **Feldgenaues Zusammenführen**: Bei gleichzeitigen Änderungen am selben Punkt
  gewinnt derzeit die erste; die zweite bekommt den aktuellen Stand angezeigt.
  Ein Zusammenführen pro Feld wäre denkbar, macht die Bedienung aber schwerer
  nachvollziehbar.
- **Bilder** werden beim Hochladen auf max. 1400 px skaliert und als JPEG
  (Qualität 0.82) abgelegt. Im lokalen Modus landen sie im localStorage; bei
  „Speichern fehlgeschlagen“ hilft exportieren und Bilder reduzieren.
