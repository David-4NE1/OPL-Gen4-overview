-- Lastenheft auf einen Blick: Anforderung und Ziel je Kategorie bzw. Unterthema.
-- Schluessel: '<Kategorie>' oder '<Kategorie> › <Unterthema>'. Der Worker legt die Tabelle selbst an.
CREATE TABLE IF NOT EXISTS lastenheft_ziele (
  schluessel TEXT PRIMARY KEY, anforderung TEXT NOT NULL DEFAULT '', ziel TEXT NOT NULL DEFAULT '',
  geaendert_am TEXT NOT NULL DEFAULT '', geaendert_von TEXT NOT NULL DEFAULT '');
