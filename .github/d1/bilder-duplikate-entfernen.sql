-- Entfernt doppelte Bilder (Definition siehe bilder-diagnose.sql). Behalten wird jeweils das
-- erste Vorkommen bzw. das statische AMK-Bild mit beschreibendem Namen; Reihenfolge bleibt.
-- Pro betroffener Karte wird ein Eintrag im Aenderungsprotokoll geschrieben.
INSERT INTO changelog (nr, text, wann, wer)
SELECT e.nr,
       'Doppelte Bilder entfernt (' || (
         SELECT COUNT(*) FROM json_each(e.bilder) b WHERE EXISTS (
           SELECT 1 FROM json_each(e.bilder) a
           WHERE a.key <> b.key AND (
             (json_extract(a.value, '$.src') LIKE 'assets/img/%' AND json_extract(b.value, '$.src') LIKE 'data:%'
               AND substr(json_extract(a.value, '$.src'), 12) = json_extract(b.value, '$.name'))
             OR (a.key < b.key AND json_extract(a.value, '$.src') = json_extract(b.value, '$.src'))))
       ) || ')',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'Wartung'
FROM entries e
WHERE json_valid(e.bilder) AND EXISTS (
  SELECT 1 FROM json_each(e.bilder) b WHERE EXISTS (
    SELECT 1 FROM json_each(e.bilder) a
    WHERE a.key <> b.key AND (
      (json_extract(a.value, '$.src') LIKE 'assets/img/%' AND json_extract(b.value, '$.src') LIKE 'data:%'
        AND substr(json_extract(a.value, '$.src'), 12) = json_extract(b.value, '$.name'))
      OR (a.key < b.key AND json_extract(a.value, '$.src') = json_extract(b.value, '$.src')))));

UPDATE entries SET bilder = (
  SELECT json_group_array(json(v)) FROM (
    SELECT b.value AS v FROM json_each(entries.bilder) b
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(entries.bilder) a
      WHERE a.key <> b.key AND (
        (json_extract(a.value, '$.src') LIKE 'assets/img/%' AND json_extract(b.value, '$.src') LIKE 'data:%'
          AND substr(json_extract(a.value, '$.src'), 12) = json_extract(b.value, '$.name'))
        OR (a.key < b.key AND json_extract(a.value, '$.src') = json_extract(b.value, '$.src'))))
    ORDER BY b.key))
WHERE json_valid(bilder) AND EXISTS (
  SELECT 1 FROM json_each(entries.bilder) b WHERE EXISTS (
    SELECT 1 FROM json_each(entries.bilder) a
    WHERE a.key <> b.key AND (
      (json_extract(a.value, '$.src') LIKE 'assets/img/%' AND json_extract(b.value, '$.src') LIKE 'data:%'
        AND substr(json_extract(a.value, '$.src'), 12) = json_extract(b.value, '$.name'))
      OR (a.key < b.key AND json_extract(a.value, '$.src') = json_extract(b.value, '$.src')))));
