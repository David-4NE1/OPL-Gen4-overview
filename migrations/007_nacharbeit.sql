-- Nacharbeit an bestehenden Teilen: Re-Milling, Modification oder beides.
-- Der Worker legt die Spalte beim ersten Zugriff selbst an (schemaSicherstellen).
ALTER TABLE entries ADD COLUMN nacharbeit TEXT DEFAULT '';
