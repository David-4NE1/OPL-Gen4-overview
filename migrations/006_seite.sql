-- Seite einer paarigen Baugruppe (Arm, Bein, Fuß) aus Sicht des Roboters:
-- '' | 'Links' | 'Rechts' | 'Beidseitig'. Fuer die Koerperansicht der Roadmap.
-- Der Worker legt die Spalte beim ersten Aufruf selbst an; diese Datei dient
-- der Dokumentation bzw. fuer eine neue, leere Datenbank.
ALTER TABLE entries ADD COLUMN seite TEXT DEFAULT '';
