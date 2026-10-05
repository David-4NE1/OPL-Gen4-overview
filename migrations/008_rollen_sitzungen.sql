-- Rollen je freigeschalteter Adresse: 'lesen' | 'bearbeiten' | 'admin'.
-- Tabelle settings: zufaellig erzeugter Schluessel fuer die signierten Sitzungen
-- (nur falls kein Secret SESSION_SECRET gesetzt ist). login_fehler: Fehlversuche
-- fuer die Login-Sperre. Der Worker legt alles beim ersten Aufruf selbst an.
ALTER TABLE allowed_emails ADD COLUMN rolle TEXT DEFAULT 'bearbeiten';
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_fehler (email TEXT NOT NULL, wann TEXT NOT NULL);
