-- Team-Verantwortlichkeit je Karte (zusaetzlich zur Person):
-- '' | 'Advanced Development' | 'Pre Series'.
-- Einmalig in der Cloudflare D1-Console ausfuehren, BEVOR der Worker
-- mit diesem Feld deployed ist (alter Code ignoriert die Spalte).

ALTER TABLE entries ADD COLUMN verantwortlichkeit TEXT DEFAULT '';
