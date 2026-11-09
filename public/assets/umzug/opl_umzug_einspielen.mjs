// OPL 4NE1 Gen4 - Datenpaket Umzug in eine SQLite-Datenbank einspielen (Node.js >= 22.13).
//
//   node opl_umzug_einspielen.mjs <Paketordner> <Datenbankdatei>
//
// Wird vom Testbetrieb (testbetrieb.ps1) benutzt, um die lokale Datenbank von
// "wrangler dev" zu fuellen. Vorhandene Inhalte der OPL-Tabellen werden dabei
// ersetzt. Bilder kommen wie in Cloudflare D1 als data:-URL in die Spalte "bilder".
// Zum Schluss wird die Anzahl je Tabelle mit manifest.json verglichen.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [paket, ziel] = process.argv.slice(2);
if (!paket || !ziel) {
  console.error('Aufruf: node opl_umzug_einspielen.mjs <Paketordner> <Datenbankdatei>');
  process.exit(2);
}
const lesen = name => JSON.parse(readFileSync(join(paket, name), 'utf8'));
if (!existsSync(join(paket, 'manifest.json'))) {
  console.error('Kein Datenpaket: manifest.json fehlt in ' + paket);
  process.exit(2);
}
const manifest = lesen('manifest.json');

const db = new DatabaseSync(ziel);
db.exec(readFileSync(join(paket, 'daten', 'schema.sql'), 'utf8'));

function einfuegen(tabelle, zeilen) {
  const spaltenDb = new Set(db.prepare(`PRAGMA table_info("${tabelle}")`).all().map(r => r.name));
  db.exec(`DELETE FROM "${tabelle}"`);
  for (const z of zeilen) {
    const spalten = Object.keys(z).filter(s => spaltenDb.has(s));
    db.prepare(`INSERT OR REPLACE INTO "${tabelle}" (${spalten.map(s => `"${s}"`).join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})`)
      .run(...spalten.map(s => z[s] ?? null));
  }
  return zeilen.length;
}

function bilderAlsDaten(punkt) {
  const bilder = [];
  for (const b of punkt.bilder || []) {
    if (!b.datei) {
      console.log(`  Hinweis: OPL-${punkt.nr} - ein Bild fehlt im Paket (${b.fehler || ''})`);
      continue;
    }
    const daten = readFileSync(join(paket, b.datei)).toString('base64');
    bilder.push({ name: b.name || '', src: `data:${b.mime || 'image/jpeg'};base64,${daten}` });
  }
  return JSON.stringify(bilder);
}

const punkte = lesen('daten/punkte.json').map(p => ({ ...p, bilder: bilderAlsDaten(p) }));
const ist = {};
db.exec('BEGIN');
try {
  ist.punkte = einfuegen('entries', punkte);
  ist.protokoll = einfuegen('changelog', lesen('daten/protokoll.json'));
  ist.forderungen = einfuegen('forderungen', lesen('daten/forderungen.json'));
  ist.lastenheft_ziele = einfuegen('lastenheft_ziele', lesen('daten/lastenheft_ziele.json'));
  ist.releases = einfuegen('releases', lesen('daten/releases.json'));
  ist.zugriff = einfuegen('allowed_emails', lesen('daten/zugriff.json').freigaben);
  ist.einstellungen = einfuegen('settings', lesen('daten/einstellungen.json'));
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
db.close();

const soll = manifest.anzahl || {};
let ok = true;
console.log('Tabelle            Soll    Ist');
for (const [k, n] of Object.entries(ist)) {
  const abw = soll[k] != null && soll[k] !== n;
  if (abw) ok = false;
  console.log(`${k.padEnd(16)} ${String(soll[k] ?? '').padStart(6)} ${String(n).padStart(6)}${abw ? '   <-- ABWEICHUNG' : ''}`);
}
console.log(ok ? 'Daten eingespielt.' : 'Daten eingespielt - bitte Abweichungen prüfen.');
process.exit(ok ? 0 : 1);
