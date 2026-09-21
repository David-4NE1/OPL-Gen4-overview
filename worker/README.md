# OPL Gen4 – Cloudflare Worker + D1 Backend

REST-API für die OPL Gen4 Open-Point-Liste.
Liest und schreibt in eine Cloudflare D1-Datenbank (SQLite).

## Ersteinrichtung

```bash
cd worker

# 1. Wrangler installieren (falls noch nicht vorhanden)
npm install -g wrangler

# 2. Bei Cloudflare einloggen
wrangler login

# 3. D1-Datenbank anlegen
wrangler d1 create opl-gen4

# 4. Die ausgegebene database_id in wrangler.toml eintragen
#    (Zeile: database_id = "placeholder-replace-after-creation")

# 5. Schema + Seed-Daten laden
bash seed-db.sh

# 6. Worker deployen
wrangler deploy
```

## Lokal testen

```bash
wrangler dev
```

Öffnet einen lokalen Server. Die API ist unter `http://localhost:8787/api/entries`
erreichbar.

## API-Endpunkte

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/entries` | Alle Einträge |
| GET | `/api/entries/:nr` | Ein Eintrag |
| POST | `/api/entries` | Neuen Eintrag anlegen |
| PUT | `/api/entries/:nr` | Eintrag aktualisieren (Patch) |
| DELETE | `/api/entries/:nr` | Eintrag löschen |
| POST | `/api/import` | Bulk-Import (ersetzen/zusammenführen) |
| POST | `/api/reset` | Auf Seed-Stand zurücksetzen |
| GET | `/api/log` | Änderungsprotokoll |

## Cloudflare Pages + Worker zusammen

Das Frontend (statische Dateien) wird über Cloudflare Pages ausgeliefert.
Der Worker stellt die `/api/`-Routen bereit.

Option A: **Pages Functions** (empfohlen)
- Das Repo als Cloudflare Pages-Projekt verbinden
- `worker/index.js` als Pages Function unter `functions/api/` einrichten

Option B: **Separater Worker + Pages**
- Worker separat deployen (`wrangler deploy`)
- Im Frontend `__OPL_API_BASE` auf die Worker-URL setzen

## Free-Tier-Limits

- D1: 100.000 Zeilen-Reads / Tag, 100.000 Writes / Tag
- Workers: 100.000 Requests / Tag
- Für ein internes Team-Tool mehr als ausreichend.
