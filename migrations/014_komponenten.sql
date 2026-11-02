-- Komponenten je OPL-Punkt: Teilenummern (4-5-stellig) oder Kennungen, mehrere
-- kommagetrennt ("4101, 4701, X8"). Der Worker legt die Spalte selbst an.
ALTER TABLE entries ADD COLUMN komponenten TEXT DEFAULT '';
