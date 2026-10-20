-- Ziel-Release je Punkt: '' | '4.1.1' | '4.1.2' | '4.1.3' | '4.2.0'.
-- Erledigte Punkte ohne Ziel-Release bekommen automatisch 4.1.1 (normalize im Worker).
-- Der Worker legt die Spalte beim ersten Aufruf selbst an und traegt dabei bei allen
-- schon erledigten Punkten einmalig 4.1.1 nach (mit Eintrag im Aenderungsprotokoll).
ALTER TABLE entries ADD COLUMN ziel_release TEXT DEFAULT '';
UPDATE entries SET ziel_release = '4.1.1' WHERE status = 'Erledigt' AND COALESCE(ziel_release, '') = '';
