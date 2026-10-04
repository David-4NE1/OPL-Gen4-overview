-- Setzt die Standard-Verantwortlichkeit je Person, nur wo das Feld noch leer ist:
-- Marc Zinner, Jannik Göz, Marcellinus Meyer, Peter Bahn -> Advanced Development;
-- Thorsten Grelle -> Pre Series. Auch nur mit Vorname eingetragen (Jannik, Marcellinus).
-- Pro Karte ein Eintrag im Aenderungsprotokoll. Mehrfaches Ausfuehren aendert nichts mehr.
INSERT INTO changelog (nr, text, wann, wer)
SELECT nr,
       'verantwortlichkeit: "–" → "' || CASE WHEN lower(trim(verantwortlicher)) = 'thorsten grelle' THEN 'Pre Series' ELSE 'Advanced Development' END || '" (Standard je Person)',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'Wartung'
FROM entries
WHERE COALESCE(verantwortlichkeit,'') = ''
  AND lower(trim(verantwortlicher)) IN ('marc zinner', 'jannik göz', 'jannik goez', 'jannik', 'marcellinus meyer', 'marcellinus', 'peter bahn', 'thorsten grelle');

UPDATE entries
SET verantwortlichkeit = CASE WHEN lower(trim(verantwortlicher)) = 'thorsten grelle' THEN 'Pre Series' ELSE 'Advanced Development' END
WHERE COALESCE(verantwortlichkeit,'') = ''
  AND lower(trim(verantwortlicher)) IN ('marc zinner', 'jannik göz', 'jannik goez', 'jannik', 'marcellinus meyer', 'marcellinus', 'peter bahn', 'thorsten grelle');
