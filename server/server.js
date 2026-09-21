/*
 * server.js – Backend für den gemeinsamen Live-Stand der OPL.
 *
 * Bewusst ohne Fremdbibliotheken: nur Node (>= 18) und das Dateisystem.
 * Starten:  node server/server.js
 * Optionen: PORT (Standard 8787), HOST (Standard 0.0.0.0), OPL_DATA (Datenordner)
 *
 * Endpunkte:
 *   GET    /api/health            Erreichbarkeitsprüfung
 *   GET    /api/state             kompletter Stand {rev, entries, log}
 *   GET    /api/events            Server-Sent-Events, schiebt Änderungen live raus
 *   POST   /api/entries           neuen Punkt anlegen
 *   PATCH  /api/entries/:nr       Punkt ändern (mit Versionsprüfung)
 *   DELETE /api/entries/:nr       Punkt löschen
 *   POST   /api/import            Excel-Import (zusammenführen | ersetzen)
 *   POST   /api/reset             zurück auf den Excel-Startstand
 *   POST   /api/images            Bild hochladen
 *   GET    /api/images/:datei     Bild ausliefern
 * Alles andere wird als statische Datei aus dem Projektordner bedient.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.OPL_DATA ? path.resolve(process.env.OPL_DATA) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'opl.json');
const IMAGE_DIR = path.join(DATA_DIR, 'images');
const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0';

const MAX_BODY = 1024 * 1024;          // 1 MB für JSON-Requests
const MAX_IMAGE = 8 * 1024 * 1024;     // 8 MB pro Bild
const MAX_LOG = 2000;

const BEREICHE = [
  'Hardware/Mechanik', 'Elektrik/Elektronik', 'Simulation/Berechnung',
  'Montage/Fertigung', 'Design', 'Software', 'Advanced Development'
];
const PRIOS = ['Hoch', 'Mittel', 'Niedrig'];
const STATI = ['Offen', 'In Arbeit', 'Erledigt'];

/* ------------------------------------------------------------------ */
/* Datenhaltung                                                        */
/* ------------------------------------------------------------------ */

let db = { rev: 0, entries: [], log: [] };
let schreibKette = Promise.resolve();

function jetzt() { return new Date().toISOString(); }

function str(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max == null ? 4000 : max);
}

function istIsoDatum(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }

/** Nimmt beliebigen Client-Input und macht daraus einen sauberen Eintrag. */
function normalizeEntry(e, vorlage) {
  const alt = vorlage || {};
  const faellig = str(e.faellig, 10);
  const bilder = Array.isArray(e.bilder) ? e.bilder.slice(0, 20).map((b) => ({
    name: str(b && b.name, 200),
    src: str(b && b.src, 300000)
  })).filter((b) => b.src) : (alt.bilder || []);
  return {
    nr: Number.isFinite(e.nr) ? e.nr : alt.nr,
    bereich: BEREICHE.includes(e.bereich) ? e.bereich : (alt.bereich || BEREICHE[0]),
    thema: str(e.thema, 300),
    prio: PRIOS.includes(e.prio) ? e.prio : (alt.prio || 'Mittel'),
    verantwortlicher: str(e.verantwortlicher, 120),
    faellig: istIsoDatum(faellig) ? faellig : '',
    status: STATI.includes(e.status) ? e.status : (alt.status || 'Offen'),
    todo: str(e.todo, 5000),
    bilder,
    notiz: str(e.notiz, 300),
    geaendertAm: alt.geaendertAm || '',
    geaendertVon: alt.geaendertVon || '',
    rev: alt.rev || 0
  };
}

function seedLesen() {
  // js/seed.js ist die eine Quelle der Startdaten (aus der Excel generiert).
  const txt = fs.readFileSync(path.join(ROOT, 'js', 'seed.js'), 'utf8');
  const von = txt.indexOf('[');
  const bis = txt.lastIndexOf(']');
  if (von < 0 || bis < 0) throw new Error('js/seed.js enthält keine lesbare Liste.');
  return JSON.parse(txt.slice(von, bis + 1));
}

function seedEntries() {
  return seedLesen().map((e) => {
    const n = normalizeEntry(e, {});
    n.rev = 1;
    n.geaendertAm = jetzt();
    n.geaendertVon = 'Excel-Startstand';
    return n;
  });
}

async function laden() {
  await fsp.mkdir(IMAGE_DIR, { recursive: true });
  try {
    const roh = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
    db.rev = roh.rev || 0;
    db.entries = (roh.entries || []).map((e) => normalizeEntry(e, e));
    db.log = roh.log || [];
    console.log(`[opl] Stand geladen: ${db.entries.length} Punkte, rev ${db.rev}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Kaputte Datei nicht stillschweigend überschreiben.
      throw new Error(`${DATA_FILE} ist nicht lesbar (${err.message}). ` +
        'Bitte prüfen oder wegsichern und neu starten.');
    }
    db.rev = 1;
    db.entries = seedEntries();
    db.log = [{ nr: 0, text: 'Startstand aus der Excel-Vorlage geladen', wann: jetzt(), wer: 'System' }];
    await sichern();
    console.log(`[opl] Neuer Datenbestand angelegt: ${db.entries.length} Punkte`);
  }
}

/** Atomar schreiben (tmp + rename), Aufrufe werden serialisiert. */
function sichern() {
  schreibKette = schreibKette.then(async () => {
    const tmp = DATA_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(db, null, 1), 'utf8');
    await fsp.rename(tmp, DATA_FILE);
  }).catch((err) => {
    console.error('[opl] Speichern fehlgeschlagen:', err.message);
  });
  return schreibKette;
}

function log(nr, text, wer) {
  db.log.push({ nr, text, wann: jetzt(), wer: wer || 'unbekannt' });
  if (db.log.length > MAX_LOG) db.log = db.log.slice(-MAX_LOG);
}

function byNr(nr) { return db.entries.find((e) => e.nr === nr) || null; }
function nextNr() { return db.entries.reduce((m, e) => Math.max(m, e.nr), 0) + 1; }

/* ------------------------------------------------------------------ */
/* Live-Verteilung (SSE)                                               */
/* ------------------------------------------------------------------ */

const clients = new Set();

function broadcast(payload) {
  const text = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(text); } catch (err) { clients.delete(res); }
  }
}

/** Erhöht die Revision, protokolliert, speichert und verteilt die Änderung. */
async function mutieren(payload, nr, logText, wer) {
  db.rev += 1;
  if (logText) log(nr, logText, wer);
  await sichern();
  broadcast(Object.assign({ rev: db.rev }, payload));
  return db.rev;
}

/* ------------------------------------------------------------------ */
/* HTTP-Helfer                                                         */
/* ------------------------------------------------------------------ */

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function leseBody(req, limit) {
  return new Promise((resolve, reject) => {
    const teile = [];
    let laenge = 0;
    req.on('data', (c) => {
      laenge += c.length;
      if (laenge > limit) {
        reject(Object.assign(new Error('Anfrage zu groß'), { code: 413 }));
        req.destroy();
        return;
      }
      teile.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(teile)));
    req.on('error', reject);
  });
}

async function leseJson(req) {
  const buf = await leseBody(req, MAX_BODY);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    throw Object.assign(new Error('Ungültiges JSON im Request-Body'), { code: 400 });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2'
};

const BILD_TYPEN = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'
};

async function statischAusliefern(req, res, pfad) {
  let rel = decodeURIComponent(pfad.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const ziel = path.resolve(ROOT, '.' + rel);
  // Ausbrechen aus dem Projektordner verhindern; Daten- und Serverordner sperren.
  if (!ziel.startsWith(ROOT + path.sep) ||
      ziel.startsWith(DATA_DIR + path.sep) || ziel === DATA_DIR ||
      ziel.startsWith(path.join(ROOT, 'node_modules') + path.sep) ||
      ziel.startsWith(path.join(ROOT, '.git') + path.sep)) {
    sendJson(res, 403, { fehler: 'Zugriff verweigert' });
    return;
  }
  try {
    const stat = await fsp.stat(ziel);
    if (stat.isDirectory()) { sendJson(res, 404, { fehler: 'Nicht gefunden' }); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(ziel).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(ziel).pipe(res);
  } catch (err) {
    sendJson(res, 404, { fehler: 'Nicht gefunden' });
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function api(req, res, url) {
  const pfad = url.pathname;
  const wer = (u) => str(u, 120) || 'unbekannt';

  if (pfad === '/api/health') {
    sendJson(res, 200, { ok: true, rev: db.rev, punkte: db.entries.length });
    return true;
  }

  if (pfad === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, { rev: db.rev, entries: db.entries, log: db.log });
    return true;
  }

  if (pfad === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    res.write(`data: ${JSON.stringify({ typ: 'hallo', rev: db.rev })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (err) { /* Abbau übernimmt close */ }
    }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return true;
  }

  if (pfad === '/api/entries' && req.method === 'POST') {
    const body = await leseJson(req);
    const e = normalizeEntry(body.entry || {}, {});
    if (!e.thema) { sendJson(res, 400, { fehler: 'Thema fehlt' }); return true; }
    e.nr = nextNr();
    e.rev = 1;
    e.geaendertAm = jetzt();
    e.geaendertVon = wer(body.user);
    db.entries.push(e);
    await mutieren({ typ: 'add', entry: e }, e.nr, 'angelegt', e.geaendertVon);
    sendJson(res, 200, { entry: e, rev: db.rev });
    return true;
  }

  const treffer = /^\/api\/entries\/(\d+)$/.exec(pfad);
  if (treffer) {
    const nr = parseInt(treffer[1], 10);
    const vorhanden = byNr(nr);
    if (!vorhanden) { sendJson(res, 404, { fehler: 'Punkt ' + nr + ' existiert nicht' }); return true; }

    if (req.method === 'PATCH') {
      const body = await leseJson(req);
      // Versionsprüfung: wer auf einem alten Stand aufsetzt, bekommt 409.
      if (body.rev != null && body.rev !== vorhanden.rev) {
        sendJson(res, 409, { fehler: 'Zwischenzeitlich geändert', entry: vorhanden, rev: db.rev });
        return true;
      }
      const neu = normalizeEntry(Object.assign({}, vorhanden, body.patch || {}), vorhanden);
      neu.nr = nr;
      const wechsel = [];
      ['bereich', 'thema', 'prio', 'verantwortlicher', 'faellig', 'status', 'todo', 'notiz']
        .forEach((k) => {
          if (vorhanden[k] !== neu[k]) wechsel.push(`${k}: "${vorhanden[k] || '–'}" → "${neu[k] || '–'}"`);
        });
      if (vorhanden.bilder.length !== neu.bilder.length) {
        wechsel.push(`Bilder: ${vorhanden.bilder.length} → ${neu.bilder.length}`);
      }
      neu.rev = vorhanden.rev + 1;
      neu.geaendertVon = wer(body.user);
      neu.geaendertAm = jetzt();
      db.entries[db.entries.indexOf(vorhanden)] = neu;
      await mutieren({ typ: 'update', entry: neu }, nr,
        wechsel.join('; ') || 'gespeichert', neu.geaendertVon);
      sendJson(res, 200, { entry: neu, rev: db.rev });
      return true;
    }

    if (req.method === 'DELETE') {
      // Nutzer kommt als Query-Parameter: DELETE-Bodies werden von manchen
      // HTTP-Clients und Proxys ohne Content-Length geschickt bzw. verworfen.
      db.entries.splice(db.entries.indexOf(vorhanden), 1);
      await mutieren({ typ: 'remove', nr }, nr, 'gelöscht', wer(url.searchParams.get('user')));
      sendJson(res, 200, { ok: true, rev: db.rev });
      return true;
    }

    sendJson(res, 405, { fehler: 'Methode nicht erlaubt' });
    return true;
  }

  if (pfad === '/api/import' && req.method === 'POST') {
    const body = await leseJson(req);
    const eingang = Array.isArray(body.entries) ? body.entries : [];
    if (!eingang.length) { sendJson(res, 400, { fehler: 'Keine Einträge im Import' }); return true; }
    const benutzer = wer(body.user);
    const bilderProNr = {};
    db.entries.forEach((e) => { if (e.bilder.length) bilderProNr[e.nr] = e.bilder; });

    let neu = 0;
    let aktualisiert = 0;
    if (body.modus === 'ersetzen') {
      db.entries = eingang.map((roh) => {
        const n = normalizeEntry(roh, {});
        // Bilder stehen nicht in der Excel – vorhandene je Nr erhalten.
        if (!n.bilder.length && bilderProNr[n.nr]) n.bilder = bilderProNr[n.nr];
        n.rev = 1;
        n.geaendertAm = jetzt();
        n.geaendertVon = benutzer;
        return n;
      });
      neu = db.entries.length;
    } else {
      eingang.forEach((roh) => {
        const n = normalizeEntry(roh, {});
        const alt = byNr(n.nr);
        if (alt) {
          if (!n.bilder.length) n.bilder = alt.bilder;
          n.rev = alt.rev + 1;
          n.geaendertAm = jetzt();
          n.geaendertVon = benutzer;
          db.entries[db.entries.indexOf(alt)] = n;
          aktualisiert++;
        } else {
          if (!n.bilder.length && bilderProNr[n.nr]) n.bilder = bilderProNr[n.nr];
          n.rev = 1;
          n.geaendertAm = jetzt();
          n.geaendertVon = benutzer;
          db.entries.push(n);
          neu++;
        }
      });
    }
    db.entries.sort((a, b) => a.nr - b.nr);
    await mutieren({ typ: 'voll', entries: db.entries }, 0,
      body.modus === 'ersetzen'
        ? `Excel-Import (ersetzen): ${neu} Punkte`
        : `Excel-Import (zusammenführen): ${aktualisiert} aktualisiert, ${neu} neu`,
      benutzer);
    sendJson(res, 200, { neu, aktualisiert, rev: db.rev, entries: db.entries });
    return true;
  }

  if (pfad === '/api/reset' && req.method === 'POST') {
    const body = await leseJson(req);
    db.entries = seedEntries();
    await mutieren({ typ: 'voll', entries: db.entries }, 0,
      'auf Excel-Startstand zurückgesetzt', wer(body.user));
    sendJson(res, 200, { rev: db.rev, entries: db.entries });
    return true;
  }

  if (pfad === '/api/images' && req.method === 'POST') {
    const typ = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const endung = BILD_TYPEN[typ];
    if (!endung) {
      sendJson(res, 415, { fehler: 'Nur JPEG, PNG, WebP oder GIF erlaubt' });
      return true;
    }
    const buf = await leseBody(req, MAX_IMAGE);
    if (!buf.length) { sendJson(res, 400, { fehler: 'Leere Datei' }); return true; }
    const name = crypto.randomUUID() + endung;
    await fsp.writeFile(path.join(IMAGE_DIR, name), buf);
    sendJson(res, 200, {
      url: '/api/images/' + name,
      name: str(req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : '', 200)
    });
    return true;
  }

  const bild = /^\/api\/images\/([A-Za-z0-9-]+\.(?:jpg|png|webp|gif))$/.exec(pfad);
  if (bild && req.method === 'GET') {
    const datei = path.join(IMAGE_DIR, bild[1]);
    try {
      const stat = await fsp.stat(datei);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(datei)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      fs.createReadStream(datei).pipe(res);
    } catch (err) {
      sendJson(res, 404, { fehler: 'Bild nicht gefunden' });
    }
    return true;
  }

  if (pfad.startsWith('/api/')) { sendJson(res, 404, { fehler: 'Unbekannter Endpunkt' }); return true; }
  return false;
}

/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (await api(req, res, url)) return;
    await statischAusliefern(req, res, url.pathname);
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    const code = err.code === 413 ? 413 : (err.code === 400 ? 400 : 500);
    if (code === 500) console.error('[opl] Fehler bei', req.method, req.url, '–', err.message);
    sendJson(res, code, { fehler: err.message || 'Interner Fehler' });
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

function herunterfahren(signal) {
  console.log(`\n[opl] ${signal} – fahre herunter …`);
  for (const res of clients) { try { res.end(); } catch (err) { /* egal */ } }
  clients.clear();
  server.close(() => {
    schreibKette.then(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => herunterfahren('SIGINT'));
process.on('SIGTERM', () => herunterfahren('SIGTERM'));

laden().then(() => {
  server.listen(PORT, HOST, () => {
    // PORT=0 lässt das System einen freien Port wählen – daher die echte Adresse melden.
    const echterPort = server.address().port;
    console.log(`[opl] OPL-Server läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${echterPort}`);
    console.log(`[opl] Daten: ${DATA_FILE}`);
  });
}).catch((err) => {
  console.error('[opl] Start fehlgeschlagen:', err.message);
  process.exit(1);
});
