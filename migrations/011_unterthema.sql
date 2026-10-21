-- Unterthema je Punkt (zweite Ebene unter der festen Kategorie, Liste in store.js/worker).
-- Der Worker legt die Spalte beim ersten Aufruf selbst an.
ALTER TABLE entries ADD COLUMN unterthema TEXT DEFAULT '';
