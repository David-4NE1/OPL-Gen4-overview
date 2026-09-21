/*
 * Tests für das OPL-Backend. Ohne Test-Framework, damit `npm test` überall läuft.
 * Startet den Server in einem temporären Datenordner auf einem freien Port.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opl-test-'));
let PORT = 0;
let server = null;
let bestanden = 0;
const fehler = [];

function pruefe(name, bedingung, detail) {
  if (bedingung) { bestanden++; console.log('  ok   ' + name); }
  else { fehler.push(name + (detail ? ' – ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' – ' + detail : '')); }
}

function gleich(name, ist, soll) {
  pruefe(name, JSON.stringify(ist) === JSON.stringify(soll), 'ist ' + JSON.stringify(ist) + ', erwartet ' + JSON.stringify(soll));
}

function anfrage(pfad, optionen) {
  const opt = optionen || {};
  let body = opt.body;
  const headers = Object.assign({}, opt.headers);
  if (body !== undefined && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: pfad, method: opt.method || 'GET', headers
    }, (res) => {
      const teile = [];
      res.on('data', (c) => teile.push(c));
      res.on('end', () => {
        const roh = Buffer.concat(teile);
        let daten = null;
        try { daten = JSON.parse(roh.toString('utf8')); } catch (err) { daten = null; }
        resolve({ status: res.statusCode, daten, roh, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function starteServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      env: Object.assign({}, process.env, { OPL_DATA: DATA, PORT: '0', HOST: '127.0.0.1' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let ausgabe = '';
    const zeit = setTimeout(() => reject(new Error('Server startet nicht: ' + ausgabe)), 10000);
    server.stdout.on('data', (c) => {
      ausgabe += c.toString();
      const m = /http:\/\/[^:]+:(\d+)/.exec(ausgabe);
      if (m) { PORT = parseInt(m[1], 10); clearTimeout(zeit); resolve(); }
    });
    server.stderr.on('data', (c) => { ausgabe += c.toString(); });
    server.on('exit', (code) => { clearTimeout(zeit); reject(new Error('Server beendet (' + code + '): ' + ausgabe)); });
  });
}

function stoppeServer() {
  return new Promise((resolve) => {
    if (!server || server.exitCode !== null) return resolve();
    server.on('exit', () => resolve());
    server.kill('SIGTERM');
    setTimeout(() => { try { server.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000);
  });
}

/** Hört am SSE-Kanal mit und sammelt Meldungen. */
function sseLauscher() {
  const meldungen = [];
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/events', method: 'GET' }, (res) => {
    let puffer = '';
    res.on('data', (c) => {
      puffer += c.toString();
      let i;
      while ((i = puffer.indexOf('\n\n')) >= 0) {
        const block = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        const zeile = block.split('\n').find((z) => z.startsWith('data: '));
        if (zeile) { try { meldungen.push(JSON.parse(zeile.slice(6))); } catch (e) {} }
      }
    });
  });
  req.end();
  return { meldungen, schliessen: () => req.destroy() };
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */

async function main() {
  console.log('Datenordner: ' + DATA + '\n');
  await starteServer();
  console.log('Server auf Port ' + PORT + '\n');

  console.log('Start und Grundzustand');
  const health = await anfrage('/api/health');
  gleich('health antwortet ok', health.daten && health.daten.ok, true);
  const start = await anfrage('/api/state');
  gleich('Startstand hat die 29 Excel-Punkte', start.daten.entries.length, 29);
  gleich('Punkt 26 hat die zwei Bilder', start.daten.entries.find((e) => e.nr === 26).bilder.length, 2);
  pruefe('rev ist gesetzt', start.daten.rev > 0);

  console.log('\nLive-Verteilung');
  const lausch = sseLauscher();
  await warte(300);
  gleich('SSE begrüßt den Client', lausch.meldungen[0] && lausch.meldungen[0].typ, 'hallo');

  console.log('\nAnlegen');
  const neu = await anfrage('/api/entries', {
    method: 'POST', body: { entry: { bereich: 'Software', thema: 'Testpunkt', prio: 'Hoch', todo: 'x' }, user: 'Tester' }
  });
  gleich('Anlegen liefert 200', neu.status, 200);
  gleich('Nr wird fortlaufend vergeben', neu.daten.entry.nr, 30);
  gleich('Anleger wird vermerkt', neu.daten.entry.geaendertVon, 'Tester');
  const ohneThema = await anfrage('/api/entries', { method: 'POST', body: { entry: { thema: '' } } });
  gleich('Anlegen ohne Thema wird abgelehnt', ohneThema.status, 400);

  await warte(200);
  const addMeldung = lausch.meldungen.find((m) => m.typ === 'add');
  gleich('Anlegen wird live verteilt', addMeldung && addMeldung.entry.nr, 30);

  console.log('\nÄndern mit Versionsprüfung');
  const rev1 = neu.daten.entry.rev;
  const p1 = await anfrage('/api/entries/30', {
    method: 'PATCH', body: { patch: { status: 'In Arbeit' }, rev: rev1, user: 'Anna' }
  });
  gleich('Änderung mit aktueller rev geht durch', p1.status, 200);
  gleich('Status wurde übernommen', p1.daten.entry.status, 'In Arbeit');
  gleich('rev zählt hoch', p1.daten.entry.rev, rev1 + 1);

  const p2 = await anfrage('/api/entries/30', {
    method: 'PATCH', body: { patch: { status: 'Erledigt' }, rev: rev1, user: 'Bob' }
  });
  gleich('veraltete rev wird mit 409 abgelehnt', p2.status, 409);
  gleich('409 liefert den aktuellen Stand mit', p2.daten.entry.status, 'In Arbeit');

  const p3 = await anfrage('/api/entries/30', {
    method: 'PATCH', body: { patch: { prio: 'Quatsch', bereich: 'Erfunden' }, rev: p1.daten.entry.rev }
  });
  // Unsinnige Werte dürfen einen guten Stand nicht kaputtmachen: der bisherige bleibt stehen.
  gleich('unbekannte Prio lässt den alten Wert stehen', p3.daten.entry.prio, 'Hoch');
  gleich('unbekannter Bereich lässt den alten Wert stehen', p3.daten.entry.bereich, 'Software');

  const p4 = await anfrage('/api/entries/9999', { method: 'PATCH', body: { patch: { status: 'Offen' } } });
  gleich('Änderung an unbekanntem Punkt ergibt 404', p4.status, 404);

  console.log('\nLöschen');
  const del = await anfrage('/api/entries/30?user=Anna', { method: 'DELETE' });
  gleich('Löschen liefert 200', del.status, 200);
  const nachDel = await anfrage('/api/state');
  gleich('Punkt ist weg', nachDel.daten.entries.some((e) => e.nr === 30), false);

  console.log('\nExcel-Import');
  const zusammen = await anfrage('/api/import', {
    method: 'POST',
    body: {
      modus: 'zusammenfuehren', user: 'Excel',
      entries: [
        { nr: 1, bereich: 'Hardware/Mechanik', thema: 'Schrauben', prio: 'Niedrig', status: 'Erledigt', todo: 'aus Excel' },
        { nr: 99, bereich: 'Design', thema: 'Neu aus Excel', prio: 'Hoch', status: 'Offen', todo: 'neu' }
      ]
    }
  });
  gleich('Zusammenführen aktualisiert einen Punkt', zusammen.daten.aktualisiert, 1);
  gleich('Zusammenführen legt einen Punkt an', zusammen.daten.neu, 1);
  const nachMerge = await anfrage('/api/state');
  gleich('Punkt 1 übernimmt den Excel-Stand', nachMerge.daten.entries.find((e) => e.nr === 1).status, 'Erledigt');
  gleich('Bilder an Punkt 26 überleben den Import',
    nachMerge.daten.entries.find((e) => e.nr === 26).bilder.length, 2);

  const ersetzen = await anfrage('/api/import', {
    method: 'POST',
    body: { modus: 'ersetzen', user: 'Excel', entries: [{ nr: 26, bereich: 'Design', thema: 'Nur einer', prio: 'Hoch', status: 'Offen', todo: 'x' }] }
  });
  gleich('Ersetzen setzt die Liste neu', ersetzen.daten.entries.length, 1);
  gleich('Bilder bleiben auch beim Ersetzen an Punkt 26', ersetzen.daten.entries[0].bilder.length, 2);
  const leer = await anfrage('/api/import', { method: 'POST', body: { entries: [] } });
  gleich('leerer Import wird abgelehnt', leer.status, 400);

  console.log('\nZurücksetzen');
  const reset = await anfrage('/api/reset', { method: 'POST', body: { user: 'Tester' } });
  gleich('Reset stellt die 29 Excel-Punkte her', reset.daten.entries.length, 29);

  console.log('\nBilder');
  // 1x1-PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await anfrage('/api/images', {
    method: 'POST', body: png, headers: { 'Content-Type': 'image/png', 'X-Filename': 'test%20bild.png' }
  });
  gleich('Bild-Upload liefert 200', up.status, 200);
  pruefe('Upload liefert eine URL', /^\/api\/images\/[a-f0-9-]+\.png$/.test(up.daten.url), up.daten.url);
  gleich('Dateiname wird dekodiert', up.daten.name, 'test bild.png');
  const holen = await anfrage(up.daten.url);
  gleich('Bild kommt zurück', holen.status, 200);
  gleich('Bild ist unverändert', holen.roh.equals(png), true);
  const boese = await anfrage('/api/images', {
    method: 'POST', body: Buffer.from('<script>'), headers: { 'Content-Type': 'text/html' }
  });
  gleich('fremder Dateityp wird abgelehnt', boese.status, 415);
  const weg = await anfrage('/api/images/gibtsnicht.png');
  gleich('unbekanntes Bild ergibt 404', weg.status, 404);

  console.log('\nStatische Auslieferung und Zugriffsschutz');
  const seite = await anfrage('/');
  gleich('Startseite kommt', seite.status, 200);
  pruefe('Startseite ist die App', seite.roh.toString().includes('OPL'));
  const css = await anfrage('/css/app.css');
  gleich('CSS wird ausgeliefert', css.status, 200);
  const raus = await anfrage('/../../etc/passwd');
  pruefe('Pfad-Ausbruch wird geblockt', raus.status === 403 || raus.status === 404, 'Status ' + raus.status);
  const git = await anfrage('/.git/config');
  pruefe('.git ist gesperrt', git.status === 403 || git.status === 404, 'Status ' + git.status);
  const unbekannt = await anfrage('/api/gibtsnicht');
  gleich('unbekannter Endpunkt ergibt 404', unbekannt.status, 404);
  const kaputt = await anfrage('/api/entries', {
    method: 'POST', body: Buffer.from('{kein json'), headers: { 'Content-Type': 'application/json' }
  });
  gleich('kaputtes JSON ergibt 400', kaputt.status, 400);

  lausch.schliessen();

  console.log('\nNeustart');
  const vorNeustart = await anfrage('/api/state');
  await stoppeServer();
  await starteServer();
  const nachNeustart = await anfrage('/api/state');
  gleich('Stand überlebt den Neustart', nachNeustart.daten.entries.length, vorNeustart.daten.entries.length);
  gleich('rev überlebt den Neustart', nachNeustart.daten.rev, vorNeustart.daten.rev);
  pruefe('Protokoll überlebt den Neustart', nachNeustart.daten.log.length > 0);

  await stoppeServer();

  console.log('\n' + '-'.repeat(50));
  console.log(bestanden + ' Prüfungen bestanden, ' + fehler.length + ' fehlgeschlagen');
  if (fehler.length) { fehler.forEach((f) => console.log('  FAIL ' + f)); process.exitCode = 1; }
  fs.rmSync(DATA, { recursive: true, force: true });
}

main().catch(async (err) => {
  console.error('\nTestlauf abgebrochen:', err);
  await stoppeServer();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(1);
});
