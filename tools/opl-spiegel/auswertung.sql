-- Auswertungen für Lessons Learned auf dem OPL-Datenspiegel (SQLite).
-- Status: Open/Assigned/In Progress/In Review/Closed/Canceled; bis 11/2026
-- Offen/In Arbeit/Erledigt (Protokoll enthält beide). Abgeschlossen = Closed,
-- Canceled oder (alt) Erledigt.
-- Wird bei jedem Lauf von opl_spiegel.py neu angelegt; direkt nutzbar in
-- Excel/Power BI (ODBC) oder z. B. "DB Browser for SQLite".

-- Stand je Kategorie: Umfang, offen, Prio Hoch, Nacharbeit, Termine
DROP VIEW IF EXISTS v_stand_kategorie;
CREATE VIEW v_stand_kategorie AS
SELECT thema AS kategorie,
       COUNT(*) AS punkte,
       SUM(status NOT IN ('Closed', 'Canceled', 'Erledigt')) AS offen,
       SUM(status IN ('Closed', 'Canceled', 'Erledigt')) AS erledigt,
       SUM(status NOT IN ('Closed', 'Canceled', 'Erledigt') AND prio = 'Hoch') AS offen_prio_hoch,
       SUM(nacharbeit <> '') AS mit_nacharbeit,
       SUM(status NOT IN ('Closed', 'Canceled', 'Erledigt') AND faellig = '') AS offen_ohne_termin,
       SUM(status NOT IN ('Closed', 'Canceled', 'Erledigt') AND faellig <> '' AND faellig < date('now')) AS ueberfaellig
FROM punkte WHERE geloescht_am IS NULL
GROUP BY thema ORDER BY offen DESC;

-- Wann wurde ein Punkt erledigt? (erster Statuswechsel auf "Erledigt" im Protokoll)
DROP VIEW IF EXISTS v_erledigung;
CREATE VIEW v_erledigung AS
SELECT p.nr, p.thema AS kategorie, p.baugruppe, p.prio, p.verantwortlichkeit, p.erstellt_am,
       substr(MIN(l.wann), 1, 10) AS erledigt_am,
       CAST(julianday(substr(MIN(l.wann), 1, 10)) - julianday(p.erstellt_am) AS INTEGER) AS tage_bis_erledigt
FROM punkte p JOIN protokoll l ON l.nr = p.nr AND l.feld = 'status' AND l.neu IN ('Closed', 'Erledigt')
WHERE p.erstellt_am <> ''
GROUP BY p.nr;

-- Durchlaufzeit je Kategorie und Prio (Tage von "erstellt" bis "erledigt")
DROP VIEW IF EXISTS v_durchlaufzeit;
CREATE VIEW v_durchlaufzeit AS
SELECT kategorie, prio, COUNT(*) AS erledigte_punkte,
       ROUND(AVG(tage_bis_erledigt), 1) AS tage_mittel,
       MIN(tage_bis_erledigt) AS tage_min, MAX(tage_bis_erledigt) AS tage_max
FROM v_erledigung GROUP BY kategorie, prio ORDER BY kategorie, prio;

-- Wie lange sind offene Punkte schon offen?
DROP VIEW IF EXISTS v_offen_alter;
CREATE VIEW v_offen_alter AS
SELECT nr, thema AS kategorie, baugruppe, prio, verantwortlicher, verantwortlichkeit, faellig,
       CAST(julianday('now') - julianday(erstellt_am) AS INTEGER) AS tage_offen,
       substr(replace(replace(todo, char(13), ' '), char(10), ' '), 1, 160) AS todo_kurz
FROM punkte
WHERE geloescht_am IS NULL AND status NOT IN ('Closed', 'Canceled', 'Erledigt') AND erstellt_am <> ''
ORDER BY tage_offen DESC;

-- Wiedereröffnete Punkte (erledigt -> wieder offen): Hinweis auf vorschnelle Abschlüsse
DROP VIEW IF EXISTS v_wiedereroeffnet;
CREATE VIEW v_wiedereroeffnet AS
SELECT l.nr, p.thema AS kategorie, COUNT(*) AS wiedereroeffnet, MAX(l.wann) AS zuletzt, p.status AS status_heute
FROM protokoll l JOIN punkte p ON p.nr = l.nr
WHERE l.feld = 'status' AND l.alt IN ('Closed', 'Erledigt') AND l.neu NOT IN ('Closed', 'Canceled', 'Erledigt')
GROUP BY l.nr ORDER BY wiedereroeffnet DESC;

-- Nacharbeit am Teil je Baugruppe und Art
DROP VIEW IF EXISTS v_nacharbeit;
CREATE VIEW v_nacharbeit AS
SELECT baugruppe, nacharbeit, thema AS kategorie, COUNT(*) AS punkte
FROM punkte WHERE geloescht_am IS NULL AND nacharbeit <> ''
GROUP BY baugruppe, nacharbeit, thema ORDER BY punkte DESC;

-- Komponenten einzeln (aus "4101, 4701, X8") und wie oft sie in der OPL vorkommen
DROP VIEW IF EXISTS v_komponenten;
CREATE VIEW v_komponenten AS
WITH RECURSIVE teile(nr, rest, komponente) AS (
  SELECT nr, komponenten || ',', NULL FROM punkte WHERE geloescht_am IS NULL AND komponenten <> ''
  UNION ALL
  SELECT nr, substr(rest, instr(rest, ',') + 1), trim(substr(rest, 1, instr(rest, ',') - 1))
  FROM teile WHERE rest <> ''
)
SELECT t.komponente, COUNT(*) AS punkte,
       SUM(p.status NOT IN ('Closed', 'Canceled', 'Erledigt')) AS offen,
       GROUP_CONCAT(t.nr, ', ') AS opl_nummern
FROM teile t JOIN punkte p ON p.nr = t.nr
WHERE t.komponente IS NOT NULL AND t.komponente <> ''
GROUP BY t.komponente ORDER BY punkte DESC;

-- Aktivität je Kalenderwoche: neue Punkte, Änderungen, Erledigungen
DROP VIEW IF EXISTS v_aktivitaet_woche;
CREATE VIEW v_aktivitaet_woche AS
SELECT strftime('%Y-KW%W', wann) AS woche,
       SUM(text = 'angelegt') AS angelegt,
       SUM(feld = 'status' AND neu IN ('Closed', 'Erledigt')) AS erledigt,
       COUNT(*) AS aenderungen,
       COUNT(DISTINCT wer) AS personen
FROM protokoll GROUP BY woche ORDER BY woche;

-- Welche Felder werden am häufigsten geändert? (Unschärfe in der Erfassung)
DROP VIEW IF EXISTS v_feldaenderungen;
CREATE VIEW v_feldaenderungen AS
SELECT feld, COUNT(*) AS aenderungen, COUNT(DISTINCT nr) AS punkte
FROM protokoll WHERE feld IS NOT NULL GROUP BY feld ORDER BY aenderungen DESC;
