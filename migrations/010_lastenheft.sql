-- Lastenheft: Kurztitel und Anforderung (Zielzustand) je OPL-Punkt.
-- Stehen nicht in der OPL-Excel; ein Excel-Import behaelt vorhandene Werte.
-- Der Worker legt die Spalten beim ersten Aufruf selbst an.
ALTER TABLE entries ADD COLUMN lh_titel TEXT DEFAULT '';
ALTER TABLE entries ADD COLUMN anforderung TEXT DEFAULT '';
