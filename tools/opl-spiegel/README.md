# OPL-Datenspiegel (interner Windows-Server)

Holt die OPL regelmäßig per **Lese-Token** und legt sie in einer SQLite-Datenbank
auf dem internen Server ab: Punkte, Verlauf jeder Version und das vollständige
Änderungsprotokoll. Darauf liegen fertige Auswertungen für Lessons Learned.

- Die OPL selbst bleibt unverändert (Link, Login, Rollen).
- Der Token darf **nur lesen** (`GET /api/entries`, `GET /api/log`), nie schreiben.
- Abgeholt wird inkrementell (nur Geändertes); das belastet das D1-Kontingent kaum.

## Voraussetzungen

1. **READ_TOKEN im Cloudflare-Worker** (einmalig, durch dich, Wert selbst wählen):
   Cloudflare-Dashboard → Workers & Pages → `opl-gen4-overview` → Settings →
   Variables and Secrets → *Add* → Typ **Secret**, Name `READ_TOKEN`.
   Einen langen Zufallswert verwenden, z. B. aus einem Passwortmanager. Den Wert
   nirgends ins Repository, in Tickets oder Chats schreiben.
2. **Python 3** auf dem Server (python.org, Option „Add python.exe to PATH“).
   Es werden keine zusätzlichen Pakete benötigt.
3. Der Server braucht Internetzugang zur OPL-Adresse (ggf. über den Firmen-Proxy;
   der Windows-Proxy wird automatisch verwendet).

## Einrichten

Ordner `tools\opl-spiegel` auf den Server kopieren (z. B. nach `D:\OPL-Spiegel`),
dort eine PowerShell **als Administrator** öffnen:

```powershell
powershell -ExecutionPolicy Bypass -File .\einrichten.ps1
```

Das Skript fragt nach dem Konto für die geplante Aufgabe und verdeckt nach dem
Token, macht einen ersten vollständigen Abruf und richtet die stündliche Aufgabe
„OPL-Datenspiegel“ ein. Ergebnis: `opl_spiegel.sqlite` im selben Ordner.

Manuell: `python opl_spiegel.py` (Änderungen) bzw. `python opl_spiegel.py --voll`.

## Inhalt der Datenbank

| Tabelle | Inhalt |
|---|---|
| `punkte` | aktueller Stand je OPL-Nr. (gelöschte Punkte bleiben mit `geloescht_am`) |
| `punkte_verlauf` | jede gesehene Version eines Punkts als JSON |
| `protokoll` | alle Änderungen: wer, wann, Feld, alt → neu |
| `abrufe` | Protokoll der Läufe (auch Fehler) |

| Auswertung (View) | Frage |
|---|---|
| `v_stand_kategorie` | Wo liegen offene, Prio-Hoch-, überfällige Punkte und Nacharbeit? |
| `v_durchlaufzeit` | Wie lange dauert es je Kategorie/Prio bis „erledigt“? |
| `v_erledigung` | Erledigungsdatum und Dauer je Punkt |
| `v_offen_alter` | Welche offenen Punkte liegen am längsten? |
| `v_wiedereroeffnet` | Welche Punkte wurden erledigt und wieder geöffnet? |
| `v_nacharbeit` | Nacharbeit je Baugruppe und Art |
| `v_komponenten` | Welche Komponenten tauchen am häufigsten in der OPL auf? |
| `v_aktivitaet_woche` | Angelegt/erledigt/Änderungen je Kalenderwoche |
| `v_feldaenderungen` | Welche Felder werden am häufigsten nachträglich geändert? |

Öffnen z. B. mit **DB Browser for SQLite**, in **Excel/Power BI** über den
SQLite-ODBC-Treiber, oder per Python.

## Hinweise

- `token.txt` liegt neben dem Skript und ist per Dateirecht auf das Aufgabenkonto
  und Administratoren beschränkt. Nicht weitergeben, nicht ins Repository.
- Bilder werden nicht kopiert, nur ihre Anzahl je Punkt.
- Läuft ein Abruf auf einen Fehler, steht er in der Tabelle `abrufe`; der nächste
  Lauf holt alles Verpasste nach.
