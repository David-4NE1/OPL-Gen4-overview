-- Ordnet die 28 Punkte mit Nacharbeit an vorhandenen Teilen zu (Praesentation "Nacharbeit an Bauteilen", OPL 04.10.2026).
-- Re-Milling: maschinelle Nacharbeit (fraesen, bohren, Gewinde, Lagersitz, Langloch, Toleranz).
-- Modification: Anpassung von Hand (dremeln, flexen, ausschneiden, Rippen anpassen, freiarbeiten).
-- Nur wo das Feld noch leer ist; pro Karte ein Eintrag im Aenderungsprotokoll. Mehrfaches Ausfuehren aendert nichts mehr.
INSERT INTO changelog (nr, text, wann, wer)
SELECT e.nr, 'nacharbeit: "–" → "' || m.column2 || '"', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'Wartung'
FROM entries e JOIN (VALUES
  (57, 'Re-Milling'),
  (58, 'Re-Milling'),
  (59, 'Re-Milling'),
  (60, 'Re-Milling'),
  (63, 'Re-Milling'),
  (64, 'Re-Milling'),
  (73, 'Re-Milling'),
  (74, 'Re-Milling + Modification'),
  (76, 'Modification'),
  (78, 'Re-Milling'),
  (81, 'Modification'),
  (84, 'Re-Milling'),
  (86, 'Modification'),
  (87, 'Modification'),
  (88, 'Re-Milling'),
  (91, 'Re-Milling'),
  (92, 'Re-Milling'),
  (95, 'Re-Milling'),
  (97, 'Re-Milling'),
  (98, 'Modification'),
  (99, 'Modification'),
  (108, 'Modification'),
  (109, 'Modification'),
  (110, 'Re-Milling'),
  (115, 'Modification'),
  (120, 'Modification'),
  (127, 'Modification'),
  (128, 'Modification')
) AS m ON e.nr = m.column1
WHERE COALESCE(e.nacharbeit,'') = '';

UPDATE entries SET nacharbeit = m.column2
FROM (VALUES
  (57, 'Re-Milling'),
  (58, 'Re-Milling'),
  (59, 'Re-Milling'),
  (60, 'Re-Milling'),
  (63, 'Re-Milling'),
  (64, 'Re-Milling'),
  (73, 'Re-Milling'),
  (74, 'Re-Milling + Modification'),
  (76, 'Modification'),
  (78, 'Re-Milling'),
  (81, 'Modification'),
  (84, 'Re-Milling'),
  (86, 'Modification'),
  (87, 'Modification'),
  (88, 'Re-Milling'),
  (91, 'Re-Milling'),
  (92, 'Re-Milling'),
  (95, 'Re-Milling'),
  (97, 'Re-Milling'),
  (98, 'Modification'),
  (99, 'Modification'),
  (108, 'Modification'),
  (109, 'Modification'),
  (110, 'Re-Milling'),
  (115, 'Modification'),
  (120, 'Modification'),
  (127, 'Modification'),
  (128, 'Modification')
) AS m
WHERE entries.nr = m.column1 AND COALESCE(entries.nacharbeit,'') = '';
