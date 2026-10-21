-- Management-Forderungen je Kategorie ("Was brauchen wir von den Kabelexperten?"),
-- mit OPL-Nummern als aktuelle Beispiele (kommagetrennt). Der Worker legt die Tabelle selbst an.
CREATE TABLE IF NOT EXISTS forderungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kategorie TEXT NOT NULL, text TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '', beispiele TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0,
  geaendert_am TEXT NOT NULL DEFAULT '', geaendert_von TEXT NOT NULL DEFAULT '');
