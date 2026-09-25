-- Freigabeliste fuer den Login: bisher hart im Code, jetzt in D1,
-- damit sie ueber die Admin-Funktion im Tool verwaltet werden kann.
-- Einmalig in der Cloudflare D1-Console ausfuehren (vor dem Deploy
-- des Workers, der diese Tabelle voraussetzt).

CREATE TABLE IF NOT EXISTS allowed_emails (
  email TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO allowed_emails (email) VALUES
  ('david.rybinski@neura-robotics.com'),
  ('thorsten.grelle@neura-robotics.com'),
  ('marcellinus.meyer@neura-robotics.com'),
  ('jannik.goez@neura-robotics.com'),
  ('marc.zinner@neura-robotics.com'),
  ('jan.buehler@neura-robotics.com'),
  ('sebastian.lein@neura-robotics.com'),
  ('josef.mecid@neura-robotics.com');
