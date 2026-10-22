-- Eigene Passwoerter und Einmalpasswoerter je freigeschalteter Adresse.
-- Der Worker legt die Spalten beim ersten Aufruf selbst an (authSchemaSicherstellen);
-- diese Datei dokumentiert nur das Schema.
ALTER TABLE allowed_emails ADD COLUMN pw_hash TEXT;               -- pbkdf2$runden$salt$hash bzw. sha256$salt$hash (Einmalpasswort)
ALTER TABLE allowed_emails ADD COLUMN pw_einmal INTEGER DEFAULT 0; -- 1 = Einmalpasswort, muss beim Login ersetzt werden
ALTER TABLE allowed_emails ADD COLUMN pw_seit TEXT;               -- Zeitpunkt der Vergabe (Einmalpasswort gilt 14 Tage)
ALTER TABLE allowed_emails ADD COLUMN sitzung_ab INTEGER DEFAULT 0; -- Sitzungen vor diesem Zeitpunkt (ms) sind ungueltig
