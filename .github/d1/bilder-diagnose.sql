-- Bilder aller Karten, die doppelte Bilder enthalten (nur Nr, Position, Art, Dateiname, Groesse).
-- Doppelt = gleiche Quelle wie ein frueheres Bild ODER Daten-Kopie eines statischen AMK-Bildes
-- (Name der Kopie = Dateiname des statischen Pfads, entstanden durch "AMK-Bilder nachtragen").
WITH b AS (
  SELECT e.nr, CAST(j.key AS INTEGER) AS i,
         json_extract(j.value, '$.src') AS src, json_extract(j.value, '$.name') AS name, e.bilder
  FROM entries e, json_each(e.bilder) j
  WHERE json_valid(e.bilder)
), d AS (
  SELECT b.*, (
    SELECT MIN(CAST(a.key AS INTEGER)) FROM json_each(b.bilder) a
    WHERE CAST(a.key AS INTEGER) <> b.i AND (
      (json_extract(a.value, '$.src') LIKE 'assets/img/%' AND b.src LIKE 'data:%'
        AND substr(json_extract(a.value, '$.src'), 12) = b.name)
      OR (CAST(a.key AS INTEGER) < b.i AND json_extract(a.value, '$.src') = b.src))
  ) AS doppelt_von
  FROM b
)
SELECT nr, i,
       CASE WHEN src LIKE 'data:%' THEN 'daten' ELSE 'pfad' END AS art,
       CASE WHEN src LIKE 'assets/%' THEN substr(src, 12)
            WHEN name GLOB '*.png' OR name GLOB '*.jpg' OR name GLOB '*.jpeg' THEN name ELSE '' END AS datei,
       length(src) AS bytes,
       doppelt_von
FROM d
WHERE nr IN (SELECT nr FROM d WHERE doppelt_von IS NOT NULL)
ORDER BY nr, i;
