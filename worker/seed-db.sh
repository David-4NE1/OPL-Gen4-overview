#!/usr/bin/env bash
# Seed-Daten in D1 laden.
# Voraussetzung: wrangler ist installiert und eingeloggt.
# Aufruf:  cd worker && bash seed-db.sh

set -euo pipefail

echo "→ Schema anlegen …"
npx wrangler d1 execute opl-gen4 --file=schema.sql --remote

echo "→ Seed-Daten einfügen …"
node -e "
const seed = require('./seed.json');
const lines = seed.map(e =>
  \`INSERT OR REPLACE INTO entries (nr,bereich,thema,prio,verantwortlicher,faellig,status,todo,bilder,notiz,geaendert_am,geaendert_von)
   VALUES (\${e.nr}, '\${esc(e.bereich)}', '\${esc(e.thema)}', '\${esc(e.prio)}', '\${esc(e.verantwortlicher)}',
   '\${e.faellig || ''}', '\${esc(e.status)}', '\${esc(e.todo)}', '\${esc(JSON.stringify(e.bilder || []))}',
   '\${esc(e.notiz || '')}', '', '');\`
);
function esc(s) { return (s||'').replace(/'/g, \"''\"); }
require('fs').writeFileSync('/tmp/seed.sql', lines.join('\n'));
"
npx wrangler d1 execute opl-gen4 --file=/tmp/seed.sql --remote

echo "✓ D1-Datenbank initialisiert mit $(node -e "console.log(require('./seed.json').length)") Einträgen."
