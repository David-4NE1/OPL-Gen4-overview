-- D1 schema for OPL Gen4

CREATE TABLE IF NOT EXISTS entries (
  nr          INTEGER PRIMARY KEY,
  bereich     TEXT NOT NULL DEFAULT 'Hardware/Mechanik',
  thema       TEXT NOT NULL DEFAULT '',
  prio        TEXT NOT NULL DEFAULT 'Mittel',
  verantwortlicher TEXT NOT NULL DEFAULT '',
  faellig     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'Offen',
  todo        TEXT NOT NULL DEFAULT '',
  bilder      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  notiz       TEXT NOT NULL DEFAULT '',
  geaendert_am  TEXT NOT NULL DEFAULT '',
  geaendert_von TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS changelog (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nr    INTEGER NOT NULL,
  text  TEXT NOT NULL,
  wann  TEXT NOT NULL,
  wer   TEXT NOT NULL DEFAULT 'unbekannt'
);
