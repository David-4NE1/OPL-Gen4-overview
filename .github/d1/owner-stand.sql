-- Stand Owner und Termine (nur Zaehlungen, keine Karteninhalte).
-- "fertigbarkeit" = die 101 Punkte der COO-Auswertung (Stand 04.10.2026).
SELECT 'alle' AS umfang,
       COUNT(*) AS punkte,
       SUM(CASE WHEN COALESCE(TRIM(verantwortlicher),'') = '' THEN 1 ELSE 0 END) AS ohne_owner,
       SUM(CASE WHEN COALESCE(faellig,'') = '' THEN 1 ELSE 0 END) AS ohne_termin,
       SUM(CASE WHEN COALESCE(TRIM(verantwortlicher),'') = '' OR COALESCE(faellig,'') = '' THEN 1 ELSE 0 END) AS owner_oder_termin_fehlt,
       SUM(CASE WHEN status = 'Erledigt' THEN 1 ELSE 0 END) AS erledigt
FROM entries
UNION ALL
SELECT 'fertigbarkeit',
       COUNT(*),
       SUM(CASE WHEN COALESCE(TRIM(verantwortlicher),'') = '' THEN 1 ELSE 0 END),
       SUM(CASE WHEN COALESCE(faellig,'') = '' THEN 1 ELSE 0 END),
       SUM(CASE WHEN COALESCE(TRIM(verantwortlicher),'') = '' OR COALESCE(faellig,'') = '' THEN 1 ELSE 0 END),
       SUM(CASE WHEN status = 'Erledigt' THEN 1 ELSE 0 END)
FROM entries WHERE nr IN (2, 3, 4, 8, 9, 10, 11, 13, 16, 17, 18, 19, 22, 24, 25, 26, 27, 33, 35, 36, 43, 45, 46, 47, 50, 52, 53, 54, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 131, 132);
SELECT verantwortlichkeit, COUNT(*) AS punkte,
       SUM(CASE WHEN COALESCE(TRIM(verantwortlicher),'') = '' THEN 1 ELSE 0 END) AS ohne_owner,
       SUM(CASE WHEN COALESCE(faellig,'') = '' THEN 1 ELSE 0 END) AS ohne_termin
FROM entries GROUP BY verantwortlichkeit;
