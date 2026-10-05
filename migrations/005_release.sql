-- Roadmap: Zuordnung Punkt → Release (z. B. 4.0.1) und Release-Stammdaten.
-- Der Worker legt Spalte und Tabelle beim ersten Aufruf selbst an (inkl.
-- 4.0.1 / 4.0.2 / 4.0.3); diese Datei dient der Dokumentation bzw. fuer
-- eine neue, leere Datenbank.
ALTER TABLE entries ADD COLUMN release TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS releases (
  name         TEXT PRIMARY KEY,               -- z. B. '4.0.1'
  ziel         TEXT NOT NULL DEFAULT '',       -- Zieltermin YYYY-MM-DD
  status       TEXT NOT NULL DEFAULT 'Geplant', -- Geplant | In Arbeit | Freigegeben
  beschreibung TEXT NOT NULL DEFAULT '',
  geaendert_am TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO releases (name) VALUES ('4.0.1'), ('4.0.2'), ('4.0.3');
