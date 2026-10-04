-- Feld "Baugruppe" (Kopf, Torso, Arm, Pelvis/Hüfte, Bein, Fuß, Übergreifend).
-- Der Worker legt die Spalte beim ersten Aufruf selbst an; diese Datei dient
-- der Dokumentation bzw. für eine neue, leere Datenbank.
ALTER TABLE entries ADD COLUMN baugruppe TEXT DEFAULT '';
