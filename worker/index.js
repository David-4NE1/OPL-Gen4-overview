import { Buffer } from 'node:buffer';

/**
 * Cloudflare Worker – OPL Gen4 REST API
 *
 * D1 database binding: DB
 * Routes:
 *   POST   /api/login            → Anmeldung (setzt Cookie)
 *   GET    /api/auth              → Auth-Status prüfen
 *   GET    /api/logout            → Abmelden (löscht Cookie)
 *   GET    /api/health            → Erreichbarkeit (kein Auth, keine Daten)
 *   GET    /api/entries           → alle Einträge (Cookie ODER Bearer READ_TOKEN)
 *   GET    /api/stand             → Aenderungsstand (kleiner Fingerabdruck fuers Polling)
 *   GET    /api/entries/:nr       → ein Eintrag
 *   GET    /api/bild/:nr/:i       → einzelnes Bild als Binaerdatei
 *
 * Listen enthalten Bilder nur als Verweis (src = /api/bild/...), nicht als
 * Base64-Daten – sonst waere jede Abfrage so gross wie alle Bilder zusammen.
 * Beim Schreiben werden solche Verweise wieder durch die gespeicherten Daten
 * ersetzt (bilderAufloesen).
 *   POST   /api/entries           → neuen Eintrag anlegen
 *   PUT    /api/entries/:nr       → Eintrag aktualisieren (Patch)
 *   DELETE /api/entries/:nr       → Eintrag löschen
 *   POST   /api/import            → Bulk-Import (ersetzen / zusammenführen)
 *   POST   /api/reset             → auf Seed-Stand zurücksetzen
 *   GET    /api/log               → Änderungsprotokoll (neueste zuerst, max 500)
 *   GET    /api/admin/emails      → Freigabeliste lesen (nur Admin)
 *   POST   /api/admin/emails      → E-Mail zur Freigabeliste hinzufuegen (nur Admin)
 *   DELETE /api/admin/emails/:e   → E-Mail von der Freigabeliste entfernen (nur Admin)
 *   POST   /api/translate         → Texte DE→EN maschinell uebersetzen (Workers AI, Cache in D1)
 *   GET    /api/releases          → Releases fuer die Roadmap (Name, Zieltermin, Status, Beschreibung)
 *   POST   /api/releases          → Release anlegen/aendern { name, ziel, status, beschreibung }
 *   DELETE /api/releases/:name    → Release loeschen (zugeordnete Punkte werden wieder "nicht eingeplant")
 *
 * Die Zuordnung Punkt → Release steht als Feld "release" am Eintrag
 * (PUT /api/entries/:nr { release: '4.0.2' }) und landet im Aenderungsprotokoll.
 *
 * Freigegebene E-Mail-Adressen liegen in der D1-Tabelle "allowed_emails"
 * (Migration: siehe migrations/002_allowed_emails.sql).
 */

const ADMIN_EMAIL = 'david.rybinski@neura-robotics.com';

const AUTH_COOKIE = 'opl_auth';
const TOKEN = 'c4f8a2e1b7d9';

function getPassword(env) {
  return env.OPL_PASSWORD || 'OPL-FORANYONE';
}

function isAuthenticated(request) {
  const cookie = request.headers.get('cookie') || '';
  return cookie.split(';').some(c => c.trim() === `${AUTH_COOKIE}=${TOKEN}`);
}

const USER_COOKIE = 'opl_user';

function nameFromEmail(email) {
  if (!email) return '';
  const local = email.split('@')[0] || '';
  return local.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

function getUserName(request) {
  const cookie = request.headers.get('cookie') || '';
  for (const c of cookie.split(';')) {
    const trimmed = c.trim();
    if (trimmed.startsWith(USER_COOKIE + '=')) {
      return decodeURIComponent(trimmed.slice(USER_COOKIE.length + 1));
    }
  }
  return '';
}

const EMAIL_COOKIE = 'opl_email';

function getEmail(request) {
  const cookie = request.headers.get('cookie') || '';
  for (const c of cookie.split(';')) {
    const trimmed = c.trim();
    if (trimmed.startsWith(EMAIL_COOKIE + '=')) {
      return decodeURIComponent(trimmed.slice(EMAIL_COOKIE.length + 1));
    }
  }
  return '';
}

function isAdmin(request) {
  return isAuthenticated(request) && getEmail(request) === ADMIN_EMAIL;
}

// Read-only Zugang fuer GET /api/entries per Bearer-Token (fuer maschinelle
// Konsumenten wie den Planner). Konstante Zeit, damit die Antwortzeit nicht
// Stueck fuer Stueck den richtigen Wert verraet. Greift NICHT, wenn
// READ_TOKEN nicht gesetzt ist.
function tokenGueltig(request, env) {
  const kopf = request.headers.get('Authorization') || '';
  const ist = kopf.startsWith('Bearer ') ? kopf.slice(7) : '';
  const soll = env.READ_TOKEN || '';
  if (!soll || ist.length !== soll.length) return false;
  let abweichung = 0;
  for (let i = 0; i < soll.length; i++) {
    abweichung |= ist.charCodeAt(i) ^ soll.charCodeAt(i);
  }
  return abweichung === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') return corsResponse(new Response(null, { status: 204 }));

    // --- Nur API-Routen laufen durch den Worker ---
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    }

    try {
      const res = await handleAPI(url, method, request, env);
      return corsResponse(res);
    } catch (err) {
      return corsResponse(json({ error: err.message }, 500));
    }
  }
};

/* ------------------------------------------------------------------ API */

async function handleAPI(url, method, request, env) {
  const path = url.pathname.replace(/\/+$/, '');

  // POST /api/login (kein Auth noetig)
  if (path === '/api/login' && method === 'POST') {
    const data = await request.json();
    const email = (data.email || '').trim().toLowerCase();
    const zugelassen = await env.DB.prepare(
      'SELECT 1 FROM allowed_emails WHERE email = ?'
    ).bind(email).first();
    if (!zugelassen) {
      return json({ error: 'Diese E-Mail-Adresse ist nicht zugelassen' }, 403);
    }
    if (data.password === getPassword(env)) {
      const userName = nameFromEmail(email);
      const admin = email === ADMIN_EMAIL;
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('set-cookie', `${AUTH_COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      headers.append('set-cookie', `${EMAIL_COOKIE}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      if (userName) {
        headers.append('set-cookie', `${USER_COOKIE}=${encodeURIComponent(userName)}; Path=/; SameSite=Strict; Max-Age=2592000`);
      }
      return new Response(JSON.stringify({ ok: true, user: userName, isAdmin: admin }), { status: 200, headers });
    }
    return json({ error: 'Falsches Passwort' }, 401);
  }

  // GET /api/auth (kein Auth noetig – prüft nur ob Cookie da ist)
  if (path === '/api/auth' && method === 'GET') {
    if (isAuthenticated(request)) {
      return json({
        authenticated: true,
        user: getUserName(request),
        isAdmin: getEmail(request) === ADMIN_EMAIL
      });
    }
    return json({ authenticated: false }, 401);
  }

  // GET /api/logout
  if (path === '/api/logout') {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    headers.append('set-cookie', `${USER_COOKIE}=; Path=/; Max-Age=0`);
    headers.append('set-cookie', `${EMAIL_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  // GET /api/health (kein Auth noetig – keine Daten, nur Erreichbarkeit)
  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true });
  }

  // GET /api/entries per Bearer-Token (read-only, fuer maschinelle Konsumenten).
  // Gilt ausschliesslich fuer diese eine Route/Methode und ersetzt die
  // Cookie-Pruefung nicht, sondern ergaenzt sie nur als Alternative.
  if (path === '/api/entries' && method === 'GET' && tokenGueltig(request, env)) {
    await schemaSicherstellen(env.DB);
    return json(await listeEintraege(env.DB));
  }

  // --- Ab hier: Auth erforderlich ---
  if (!isAuthenticated(request)) {
    return json({ error: 'Nicht angemeldet' }, 401);
  }

  // --- Admin-Routen: nur der Admin-Account darf die Freigabeliste verwalten ---
  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(request)) {
      return json({ error: 'Kein Zugriff' }, 403);
    }
    return handleAdmin(path, method, request, env);
  }

  // POST /api/translate { texts: [...] } → { translations: [...] }
  if (path === '/api/translate' && method === 'POST') {
    return handleTranslate(request, env);
  }

  const db = env.DB;
  await schemaSicherstellen(db);

  // GET /api/stand – das Frontend fragt hier alle paar Sekunden nach, ob sich
  // etwas geaendert hat, und laedt die volle Liste nur bei Bedarf. Das haelt
  // die CPU-Zeit pro Abfrage weit unter dem Free-Tier-Limit von 10 ms.
  if (path === '/api/stand' && method === 'GET') {
    return json({ stand: await aenderungsStand(db) });
  }

  // GET /api/entries
  if (path === '/api/entries' && method === 'GET') {
    return json(await listeEintraege(db));
  }

  if (path === '/api/releases' || path.startsWith('/api/releases/')) {
    return handleReleases(path, method, request, db);
  }

  // GET /api/bild/:nr/:i
  const matchBild = path.match(/^\/api\/bild\/(\d+)\/(\d+)$/);
  if (matchBild && method === 'GET') {
    return bildAusliefern(db, +matchBild[1], +matchBild[2], url);
  }

  // GET /api/entries/:nr
  const matchOne = path.match(/^\/api\/entries\/(\d+)$/);
  if (matchOne && method === 'GET') {
    const row = await db.prepare('SELECT * FROM entries WHERE nr = ?').bind(+matchOne[1]).first();
    if (!row) return json({ error: 'Nicht gefunden' }, 404);
    return json(mitBildVerweisen(dbToEntry(row)));
  }

  // POST /api/entries  (neuer Eintrag)
  if (path === '/api/entries' && method === 'POST') {
    const data = await request.json();
    data.bilder = await bilderAufloesen(db, data.bilder);
    const maxRow = await db.prepare('SELECT MAX(nr) AS m FROM entries').first();
    const nr = (maxRow?.m || 0) + 1;
    const now = new Date().toISOString();
    const e = normalize({ ...data, nr, erstelltAm: now.slice(0, 10), geaendertAm: now, geaendertVon: data.user || 'unbekannt' });
    await insertEntry(db, e);
    await logChange(db, nr, 'angelegt', e.geaendertVon);
    return json(mitBildVerweisen(e), 201);
  }

  // PUT /api/entries/:nr  (Patch)
  if (matchOne && method === 'PUT') {
    const nr = +matchOne[1];
    const row = await db.prepare('SELECT * FROM entries WHERE nr = ?').bind(nr).first();
    if (!row) return json({ error: 'Nicht gefunden' }, 404);
    const old = dbToEntry(row);
    const patch = await request.json();
    if (patch.bilder !== undefined) patch.bilder = await bilderAufloesen(db, patch.bilder);
    const now = new Date().toISOString();

    const changes = [];
    for (const k of ['bereich','thema','prio','verantwortlicher','verantwortlichkeit','baugruppe','seite','release','faellig','status','todo','notiz']) {
      if (patch[k] !== undefined && patch[k] !== old[k]) {
        changes.push(`${k}: "${old[k] || '–'}" → "${patch[k] || '–'}"`);
      }
    }

    const updated = normalize({
      ...old,
      ...patch,
      nr,
      geaendertAm: now,
      geaendertVon: patch.user || old.geaendertVon || 'unbekannt'
    });
    await updateEntry(db, updated);
    for (const c of changes) await logChange(db, nr, c, updated.geaendertVon);
    return json(mitBildVerweisen(updated));
  }

  // DELETE /api/entries/:nr
  if (matchOne && method === 'DELETE') {
    const nr = +matchOne[1];
    const existing = await db.prepare('SELECT nr FROM entries WHERE nr = ?').bind(nr).first();
    if (!existing) return json({ error: 'Nicht gefunden' }, 404);
    await db.prepare('DELETE FROM entries WHERE nr = ?').bind(nr).run();
    await logChange(db, nr, 'gelöscht', 'unbekannt');
    return json({ ok: true });
  }

  // POST /api/import
  if (path === '/api/import' && method === 'POST') {
    const { entries, modus, user } = await request.json();
    const now = new Date().toISOString();
    // Bild-Verweise aufloesen, solange die alten Daten noch in der DB stehen
    for (const raw of entries) raw.bilder = await bilderAufloesen(db, raw.bilder);

    if (modus === 'ersetzen') {
      // Die Excel kennt weder Release noch Seite: bisherige Werte je Nr behalten
      const { results: alt } = await db.prepare("SELECT nr, release, seite FROM entries WHERE release <> '' OR seite <> ''").all();
      const altJeNr = new Map(alt.map(r => [r.nr, r]));
      await db.prepare('DELETE FROM entries').run();
      const stmts = entries.map(raw => {
        const e = normalize({ ...raw, release: raw.release || altJeNr.get(raw.nr)?.release, seite: raw.seite || altJeNr.get(raw.nr)?.seite, geaendertAm: now, geaendertVon: user || 'Excel-Import' });
        return insertStmt(db, e);
      });
      await db.batch(stmts);
      await logChange(db, 0, `Excel-Import (ersetzen): ${entries.length} Einträge`, user || 'Excel-Import');
      return json({ neu: entries.length, aktualisiert: 0 });
    }

    let neu = 0, aktualisiert = 0;
    const stmts = [];
    for (const raw of entries) {
      const existing = await db.prepare('SELECT nr, release, seite FROM entries WHERE nr = ?').bind(raw.nr).first();
      // Die Excel kennt weder Release noch Seite: bestehende Werte behalten
      const e = normalize({ ...raw, release: raw.release || existing?.release, seite: raw.seite || existing?.seite, geaendertAm: now, geaendertVon: user || 'Excel-Import' });
      if (existing) {
        stmts.push(updateStmt(db, e));
        aktualisiert++;
      } else {
        stmts.push(insertStmt(db, e));
        neu++;
      }
    }
    if (stmts.length) await db.batch(stmts);
    await logChange(db, 0, `Excel-Import (zusammenführen): ${aktualisiert} aktualisiert, ${neu} neu`, user || 'Excel-Import');
    return json({ neu, aktualisiert });
  }

  // POST /api/reset
  if (path === '/api/reset' && method === 'POST') {
    const seed = (await import('./seed.json', { with: { type: 'json' } })).default;
    await db.prepare('DELETE FROM entries').run();
    await db.prepare('DELETE FROM changelog').run();
    const stmts = seed.map(raw => insertStmt(db, normalize(raw)));
    await db.batch(stmts);
    return json({ ok: true, count: seed.length });
  }

  // GET /api/log
  if (path === '/api/log' && method === 'GET') {
    const { results } = await db.prepare(
      'SELECT * FROM changelog ORDER BY id DESC LIMIT 500'
    ).all();
    return json(results);
  }

  return json({ error: 'Route nicht gefunden' }, 404);
}

/* -------------------------------------------------------------- Stand */

// Jede Schreib-Route aendert mindestens einen dieser Werte: Anlegen/Loeschen
// die Anzahl, Bearbeiten (auch nur Bilder) geaendert_am, Import/Reset das
// Protokoll bzw. die Anzahl.
async function aenderungsStand(db) {
  const row = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM entries) AS n,
            (SELECT MAX(geaendert_am) FROM entries) AS g,
            (SELECT MAX(id) FROM changelog) AS l,
            (SELECT COUNT(*) FROM changelog) AS lc,
            (SELECT COUNT(*) || '/' || IFNULL(MAX(geaendert_am), '') FROM releases) AS r`
  ).first();
  return [row.n, row.g || '', row.l || 0, row.lc, row.r || ''].join('|');
}

/* ------------------------------------------------------------ Releases */

const RELEASE_NAME = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const RELEASE_STATI = ['Geplant', 'In Arbeit', 'Freigegeben'];

function releaseName(v) {
  const s = String(v == null ? '' : v).trim();
  return RELEASE_NAME.test(s) ? s : '';
}

async function listeReleases(db) {
  const { results } = await db.prepare(
    'SELECT name, ziel, status, beschreibung, geaendert_am AS geaendertAm FROM releases'
  ).all();
  return results;
}

async function handleReleases(path, method, request, db) {
  if (path === '/api/releases' && method === 'GET') {
    return json(await listeReleases(db));
  }

  // POST /api/releases { name, ziel, status, beschreibung, user } – anlegen oder aendern
  if (path === '/api/releases' && method === 'POST') {
    const d = await request.json();
    const name = releaseName(d.name);
    if (!name) return json({ error: 'Release-Name im Format 4.0.1 angeben' }, 400);
    const ziel = /^\d{4}-\d{2}-\d{2}$/.test(d.ziel || '') ? d.ziel : '';
    const status = RELEASE_STATI.includes(d.status) ? d.status : 'Geplant';
    const beschreibung = String(d.beschreibung || '').slice(0, 2000);
    const vorher = await db.prepare('SELECT name FROM releases WHERE name = ?').bind(name).first();
    await db.prepare(
      `INSERT INTO releases (name, ziel, status, beschreibung, geaendert_am) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET ziel = excluded.ziel, status = excluded.status,
         beschreibung = excluded.beschreibung, geaendert_am = excluded.geaendert_am`
    ).bind(name, ziel, status, beschreibung, new Date().toISOString()).run();
    await logChange(db, 0, `Release ${name} ${vorher ? 'geändert' : 'angelegt'} (${status}${ziel ? ', Ziel ' + ziel : ''})`, d.user);
    return json(await listeReleases(db));
  }

  // DELETE /api/releases/:name – zugeordnete Punkte fallen zurueck in "nicht eingeplant"
  const m = path.match(/^\/api\/releases\/([^/]+)$/);
  if (m && method === 'DELETE') {
    const name = releaseName(decodeURIComponent(m[1]));
    if (!name) return json({ error: 'Unbekanntes Release' }, 404);
    const now = new Date().toISOString();
    const { meta } = await db.prepare(
      "UPDATE entries SET release = '', geaendert_am = ? WHERE release = ?"
    ).bind(now, name).run();
    await db.prepare('DELETE FROM releases WHERE name = ?').bind(name).run();
    await logChange(db, 0, `Release ${name} gelöscht (${meta.changes || 0} Punkte wieder nicht eingeplant)`, 'unbekannt');
    return json(await listeReleases(db));
  }

  return json({ error: 'Route nicht gefunden' }, 404);
}

/* -------------------------------------------------------------- Admin */

async function listeEmails(db) {
  const { results } = await db.prepare('SELECT email FROM allowed_emails ORDER BY email').all();
  return results.map(r => r.email);
}

async function handleAdmin(path, method, request, env) {
  const db = env.DB;

  // GET /api/admin/emails
  if (path === '/api/admin/emails' && method === 'GET') {
    return json(await listeEmails(db));
  }

  // POST /api/admin/emails { email }
  if (path === '/api/admin/emails' && method === 'POST') {
    const data = await request.json();
    const email = (data.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@neura-robotics\.com$/.test(email)) {
      return json({ error: 'Nur @neura-robotics.com Adressen erlaubt' }, 400);
    }
    await db.prepare('INSERT OR IGNORE INTO allowed_emails (email) VALUES (?)').bind(email).run();
    return json(await listeEmails(db));
  }

  // DELETE /api/admin/emails/:email
  const matchEmail = path.match(/^\/api\/admin\/emails\/(.+)$/);
  if (matchEmail && method === 'DELETE') {
    const email = decodeURIComponent(matchEmail[1]).trim().toLowerCase();
    if (email === ADMIN_EMAIL) {
      return json({ error: 'Der Admin-Zugang kann nicht entfernt werden' }, 400);
    }
    await db.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(email).run();
    return json(await listeEmails(db));
  }

  return json({ error: 'Route nicht gefunden' }, 404);
}

/* -------------------------------------------------------- Uebersetzung */

// Workers AI laeuft ueber das AI-Binding im eigenen Cloudflare-Konto, ohne
// separaten API-Schluessel. Ergebnisse werden in D1 zwischengespeichert,
// damit jeder Text nur einmal uebersetzt wird.
const TR_MODEL = '@cf/meta/m2m100-1.2b';
const TR_MAX_TEXTE = 25;
const TR_MAX_ZEICHEN = 4000;

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uebersetzeZeile(env, zeile) {
  if (!zeile.trim()) return zeile;
  const res = await env.AI.run(TR_MODEL, { text: zeile, source_lang: 'german', target_lang: 'english' });
  return (res && res.translated_text) ? res.translated_text : null;
}

async function uebersetzeText(env, db, text) {
  const hash = await sha256Hex('de>en|' + text);
  const cached = await db.prepare('SELECT text FROM translations WHERE hash = ?').bind(hash).first();
  if (cached) return cached.text;
  // Zeilenweise, damit Zeilenumbrueche im To Do erhalten bleiben
  const zeilen = text.split('\n');
  const ergebnis = [];
  for (const z of zeilen) {
    const en = await uebersetzeZeile(env, z);
    if (en == null) return null;
    ergebnis.push(en);
  }
  const en = ergebnis.join('\n');
  await db.prepare('INSERT OR REPLACE INTO translations (hash, text) VALUES (?, ?)').bind(hash, en).run();
  return en;
}

async function handleTranslate(request, env) {
  if (!env.AI) return json({ error: 'Übersetzung nicht verfügbar' }, 501);
  const data = await request.json();
  const texte = (Array.isArray(data.texts) ? data.texts : [])
    .slice(0, TR_MAX_TEXTE)
    .map(t => String(t == null ? '' : t).slice(0, TR_MAX_ZEICHEN));
  const db = env.DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS translations (hash TEXT PRIMARY KEY, text TEXT NOT NULL)').run();

  const out = new Array(texte.length).fill(null);
  let fehler = 0;
  let next = 0;
  async function worker() {
    while (next < texte.length) {
      const i = next++;
      if (!texte[i].trim()) { out[i] = texte[i]; continue; }
      try {
        out[i] = await uebersetzeText(env, db, texte[i]);
      } catch (err) {
        fehler++;
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (texte.length && fehler === texte.length) {
    return json({ error: 'Übersetzung fehlgeschlagen' }, 502);
  }
  return json({ translations: out, fehler });
}

/* -------------------------------------------------------------- Bilder */

const BILD_VERWEIS = /^\/api\/bild\/(\d+)\/(\d+)(?:\?.*)?$/;

function bildUrl(nr, i, laenge) {
  return `/api/bild/${nr}/${i}?v=${laenge}`;
}

function mitBildVerweisen(e) {
  return {
    ...e,
    bilder: (e.bilder || []).map((b, i) => ({
      name: b.name || '',
      src: BILD_VERWEIS.test(b.src || '') ? b.src : bildUrl(e.nr, i, (b.src || '').length)
    }))
  };
}

// Kartenliste ohne Base64-Bilddaten. Die Bild-Metadaten (Name, Laenge) ermittelt
// D1 per JSON-Funktionen, damit der Worker die grossen Daten nie parsen muss.
async function listeEintraege(db) {
  const { results } = await db.prepare(
    `SELECT nr, bereich, thema, prio, verantwortlicher, verantwortlichkeit, baugruppe, seite, release, faellig, status, todo, notiz,
            erstellt_am, geaendert_am, geaendert_von,
            (SELECT json_group_array(json_object(
                       'i', CAST(j.key AS INTEGER),
                       'name', json_extract(j.value, '$.name'),
                       'len', length(json_extract(j.value, '$.src'))))
               FROM json_each(CASE WHEN json_valid(entries.bilder) THEN entries.bilder ELSE '[]' END) AS j
            ) AS bilder_meta
       FROM entries ORDER BY nr`
  ).all();
  return results.map(row => {
    let meta = [];
    try { meta = JSON.parse(row.bilder_meta || '[]'); } catch { meta = []; }
    const bilder = meta
      .filter(m => m && m.len > 0)
      .sort((a, b) => a.i - b.i)
      .map(m => ({ name: m.name || '', src: bildUrl(row.nr, m.i, m.len) }));
    return { ...dbToEntry({ ...row, bilder: '[]' }), bilder };
  });
}

// Bilder aus dem urspruenglichen Startstand sind als Pfad auf eine statische
// Datei gespeichert (z. B. assets/img/fig01-....png), nicht als Bilddaten.
const ASSET_PFAD = /^\/?assets\/[A-Za-z0-9._\/-]+$/;

async function bildAusliefern(db, nr, i, url) {
  const row = await db.prepare(
    "SELECT json_extract(bilder, ?) AS src FROM entries WHERE nr = ? AND json_valid(bilder)"
  ).bind(`$[${Math.trunc(i)}].src`, nr).first();
  if (row && typeof row.src === 'string' && ASSET_PFAD.test(row.src) && !row.src.includes('..')) {
    return Response.redirect(new URL('/' + row.src.replace(/^\//, ''), url).toString(), 302);
  }
  const m = row && typeof row.src === 'string' ? /^data:([^;,]+);base64,/.exec(row.src) : null;
  if (!m) return json({ error: 'Bild nicht gefunden' }, 404);
  const bytes = Buffer.from(row.src.slice(m[0].length), 'base64');
  return new Response(bytes, {
    headers: {
      'content-type': m[1],
      // Die URL enthaelt ?v=<Laenge>; aendert sich das Bild, aendert sich die URL.
      'cache-control': 'private, max-age=31536000, immutable'
    }
  });
}

// Ersetzt Verweise (/api/bild/nr/i) durch die in der DB gespeicherten Bilddaten.
// Neue Bilder (data:-URLs) bleiben unveraendert; nicht aufloesbare fallen weg.
async function bilderAufloesen(db, bilder) {
  if (!Array.isArray(bilder)) return [];
  const out = [];
  for (const b of bilder) {
    if (!b || typeof b.src !== 'string') continue;
    const m = BILD_VERWEIS.exec(b.src);
    if (!m) { out.push({ name: b.name || '', src: b.src }); continue; }
    const row = await db.prepare(
      "SELECT json_extract(bilder, ?) AS src FROM entries WHERE nr = ? AND json_valid(bilder)"
    ).bind(`$[${+m[2]}].src`, +m[1]).first();
    // Gespeicherten Wert unveraendert uebernehmen – Bilddaten wie auch
    // Pfade auf statische Dateien (Startstand), sonst gingen diese verloren.
    if (row && typeof row.src === 'string' && row.src) {
      out.push({ name: b.name || '', src: row.src });
    }
  }
  return out;
}

/* -------------------------------------------------------- DB helpers */

// Neue Spalten legt der Worker selbst an (einmal je Isolate), damit ein Deploy
// nicht auf eine manuell ausgefuehrte Migration warten muss.
let schemaOk = false;
async function schemaSicherstellen(db) {
  if (schemaOk) return;
  try {
    await db.prepare("ALTER TABLE entries ADD COLUMN baugruppe TEXT DEFAULT ''").run();
  } catch (err) {
    if (!/duplicate column/i.test(String(err && err.message))) throw err;
  }
  for (const spalte of ['release', 'seite']) {
    try {
      await db.prepare(`ALTER TABLE entries ADD COLUMN ${spalte} TEXT DEFAULT ''`).run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
  }
  // Releases-Tabelle beim ersten Mal mit den Gen4-Releases vorbelegen;
  // spaeter geloeschte Releases kommen dadurch nicht wieder.
  const vorhanden = await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'releases'"
  ).first();
  if (!vorhanden) {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS releases (
        name TEXT PRIMARY KEY, ziel TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Geplant',
        beschreibung TEXT NOT NULL DEFAULT '', geaendert_am TEXT NOT NULL DEFAULT '')`),
      ...['4.0.1', '4.0.2', '4.0.3'].map(n =>
        db.prepare('INSERT OR IGNORE INTO releases (name) VALUES (?)').bind(n))
    ]);
  }
  schemaOk = true;
}

function normalize(e) {
  const BEREICHE = [
    'Hardware/Mechanik','Elektrik/Elektronik','Simulation/Berechnung',
    'Montage/Fertigung','Design','Software','Advanced Development'
  ];
  const PRIOS = ['Hoch','Mittel','Niedrig'];
  const STATI = ['Offen','In Arbeit','Erledigt'];
  const VERANTWORTLICHKEITEN = ['Advanced Development','Pre Series'];
  const BAUGRUPPEN = ['Kopf','Torso','Arm','Pelvis/Hüfte','Bein','Fuß','Übergreifend'];
  // Seite aus Sicht des Roboters
  const SEITEN = ['Links','Rechts','Beidseitig'];
  return {
    nr: e.nr,
    bereich: BEREICHE.includes(e.bereich) ? e.bereich : BEREICHE[0],
    thema: e.thema || '',
    prio: PRIOS.includes(e.prio) ? e.prio : 'Mittel',
    verantwortlicher: e.verantwortlicher || '',
    verantwortlichkeit: VERANTWORTLICHKEITEN.includes(e.verantwortlichkeit) ? e.verantwortlichkeit : '',
    baugruppe: BAUGRUPPEN.includes(e.baugruppe) ? e.baugruppe : '',
    seite: SEITEN.includes(e.seite) ? e.seite : '',
    release: releaseName(e.release),
    faellig: e.faellig || '',
    status: STATI.includes(e.status) ? e.status : 'Offen',
    todo: e.todo || '',
    bilder: Array.isArray(e.bilder) ? e.bilder : [],
    notiz: e.notiz || '',
    erstelltAm: e.erstelltAm || new Date().toISOString().slice(0, 10),
    geaendertAm: e.geaendertAm || '',
    geaendertVon: e.geaendertVon || ''
  };
}

function dbToEntry(row) {
  let bilder = [];
  try { bilder = JSON.parse(row.bilder || '[]'); } catch { bilder = []; }
  return {
    nr: row.nr,
    bereich: row.bereich,
    thema: row.thema,
    prio: row.prio,
    verantwortlicher: row.verantwortlicher,
    verantwortlichkeit: row.verantwortlichkeit || '',
    baugruppe: row.baugruppe || '',
    seite: row.seite || '',
    release: row.release || '',
    faellig: row.faellig,
    status: row.status,
    todo: row.todo,
    bilder,
    notiz: row.notiz,
    erstelltAm: row.erstellt_am || '',
    geaendertAm: row.geaendert_am,
    geaendertVon: row.geaendert_von
  };
}

function insertStmt(db, e) {
  return db.prepare(
    `INSERT INTO entries (nr, bereich, thema, prio, verantwortlicher, verantwortlichkeit, baugruppe, seite, release, faellig, status, todo, bilder, notiz, erstellt_am, geaendert_am, geaendert_von)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(e.nr, e.bereich, e.thema, e.prio, e.verantwortlicher, e.verantwortlichkeit, e.baugruppe, e.seite, e.release, e.faellig, e.status, e.todo,
         JSON.stringify(e.bilder), e.notiz, e.erstelltAm, e.geaendertAm, e.geaendertVon);
}

async function insertEntry(db, e) { await insertStmt(db, e).run(); }

function updateStmt(db, e) {
  // erstellt_am ist unveraenderlich, sobald gesetzt – ein leerer/fehlender
  // Wert in der DB wird aber mit dem mitgeschickten Wert aufgefuellt (Backfill).
  return db.prepare(
    `UPDATE entries SET bereich=?, thema=?, prio=?, verantwortlicher=?, verantwortlichkeit=?, baugruppe=?, seite=?, release=?, faellig=?, status=?, todo=?, bilder=?, notiz=?,
       erstellt_am = CASE WHEN erstellt_am IS NULL OR erstellt_am = '' THEN ? ELSE erstellt_am END,
       geaendert_am=?, geaendert_von=?
     WHERE nr=?`
  ).bind(e.bereich, e.thema, e.prio, e.verantwortlicher, e.verantwortlichkeit, e.baugruppe, e.seite, e.release, e.faellig, e.status, e.todo,
         JSON.stringify(e.bilder), e.notiz, e.erstelltAm, e.geaendertAm, e.geaendertVon, e.nr);
}

async function updateEntry(db, e) { await updateStmt(db, e).run(); }

async function logChange(db, nr, text, wer) {
  await db.prepare(
    'INSERT INTO changelog (nr, text, wann, wer) VALUES (?, ?, ?, ?)'
  ).bind(nr, text, new Date().toISOString(), wer || 'unbekannt').run();
}

/* -------------------------------------------------------- Response helpers */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function corsResponse(res) {
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  h.set('access-control-allow-headers', 'content-type');
  return new Response(res.body, { status: res.status, headers: h });
}
