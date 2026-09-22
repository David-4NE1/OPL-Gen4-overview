/**
 * Cloudflare Worker – OPL Gen4 REST API
 *
 * D1 database binding: DB
 * Routes:
 *   POST   /api/login            → Anmeldung (setzt Cookie)
 *   GET    /api/auth              → Auth-Status prüfen
 *   GET    /api/logout            → Abmelden (löscht Cookie)
 *   GET    /api/entries           → alle Einträge
 *   GET    /api/entries/:nr       → ein Eintrag
 *   POST   /api/entries           → neuen Eintrag anlegen
 *   PUT    /api/entries/:nr       → Eintrag aktualisieren (Patch)
 *   DELETE /api/entries/:nr       → Eintrag löschen
 *   POST   /api/import            → Bulk-Import (ersetzen / zusammenführen)
 *   POST   /api/reset             → auf Seed-Stand zurücksetzen
 *   GET    /api/log               → Änderungsprotokoll (neueste zuerst, max 500)
 */

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
    if (!email.endsWith('@neura-robotics.com')) {
      return json({ error: 'Nur @neura-robotics.com Adressen erlaubt' }, 403);
    }
    if (data.password === getPassword(env)) {
      const userName = nameFromEmail(data.email);
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('set-cookie', `${AUTH_COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      if (userName) {
        headers.append('set-cookie', `${USER_COOKIE}=${encodeURIComponent(userName)}; Path=/; SameSite=Strict; Max-Age=2592000`);
      }
      return new Response(JSON.stringify({ ok: true, user: userName }), { status: 200, headers });
    }
    return json({ error: 'Falsches Passwort' }, 401);
  }

  // GET /api/auth (kein Auth noetig – prüft nur ob Cookie da ist)
  if (path === '/api/auth' && method === 'GET') {
    if (isAuthenticated(request)) {
      return json({ authenticated: true, user: getUserName(request) });
    }
    return json({ authenticated: false }, 401);
  }

  // GET /api/logout
  if (path === '/api/logout') {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    headers.append('set-cookie', `${USER_COOKIE}=; Path=/; Max-Age=0`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  // --- Ab hier: Auth erforderlich ---
  if (!isAuthenticated(request)) {
    return json({ error: 'Nicht angemeldet' }, 401);
  }

  const db = env.DB;

  // GET /api/entries
  if (path === '/api/entries' && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM entries ORDER BY nr').all();
    return json(results.map(dbToEntry));
  }

  // GET /api/entries/:nr
  const matchOne = path.match(/^\/api\/entries\/(\d+)$/);
  if (matchOne && method === 'GET') {
    const row = await db.prepare('SELECT * FROM entries WHERE nr = ?').bind(+matchOne[1]).first();
    if (!row) return json({ error: 'Nicht gefunden' }, 404);
    return json(dbToEntry(row));
  }

  // POST /api/entries  (neuer Eintrag)
  if (path === '/api/entries' && method === 'POST') {
    const data = await request.json();
    const maxRow = await db.prepare('SELECT MAX(nr) AS m FROM entries').first();
    const nr = (maxRow?.m || 0) + 1;
    const now = new Date().toISOString();
    const e = normalize({ ...data, nr, geaendertAm: now, geaendertVon: data.user || 'unbekannt' });
    await insertEntry(db, e);
    await logChange(db, nr, 'angelegt', e.geaendertVon);
    return json(e, 201);
  }

  // PUT /api/entries/:nr  (Patch)
  if (matchOne && method === 'PUT') {
    const nr = +matchOne[1];
    const row = await db.prepare('SELECT * FROM entries WHERE nr = ?').bind(nr).first();
    if (!row) return json({ error: 'Nicht gefunden' }, 404);
    const old = dbToEntry(row);
    const patch = await request.json();
    const now = new Date().toISOString();

    const changes = [];
    for (const k of ['bereich','thema','prio','verantwortlicher','faellig','status','todo','notiz']) {
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
    return json(updated);
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

    if (modus === 'ersetzen') {
      await db.prepare('DELETE FROM entries').run();
      const stmts = entries.map(raw => {
        const e = normalize({ ...raw, geaendertAm: now, geaendertVon: user || 'Excel-Import' });
        return insertStmt(db, e);
      });
      await db.batch(stmts);
      await logChange(db, 0, `Excel-Import (ersetzen): ${entries.length} Einträge`, user || 'Excel-Import');
      return json({ neu: entries.length, aktualisiert: 0 });
    }

    let neu = 0, aktualisiert = 0;
    const stmts = [];
    for (const raw of entries) {
      const e = normalize({ ...raw, geaendertAm: now, geaendertVon: user || 'Excel-Import' });
      const existing = await db.prepare('SELECT nr FROM entries WHERE nr = ?').bind(e.nr).first();
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

/* -------------------------------------------------------- DB helpers */

function normalize(e) {
  const BEREICHE = [
    'Hardware/Mechanik','Elektrik/Elektronik','Simulation/Berechnung',
    'Montage/Fertigung','Design','Software','Advanced Development'
  ];
  const PRIOS = ['Hoch','Mittel','Niedrig'];
  const STATI = ['Offen','In Arbeit','Erledigt'];
  return {
    nr: e.nr,
    bereich: BEREICHE.includes(e.bereich) ? e.bereich : BEREICHE[0],
    thema: e.thema || '',
    prio: PRIOS.includes(e.prio) ? e.prio : 'Mittel',
    verantwortlicher: e.verantwortlicher || '',
    faellig: e.faellig || '',
    status: STATI.includes(e.status) ? e.status : 'Offen',
    todo: e.todo || '',
    bilder: Array.isArray(e.bilder) ? e.bilder : [],
    notiz: e.notiz || '',
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
    faellig: row.faellig,
    status: row.status,
    todo: row.todo,
    bilder,
    notiz: row.notiz,
    geaendertAm: row.geaendert_am,
    geaendertVon: row.geaendert_von
  };
}

function insertStmt(db, e) {
  return db.prepare(
    `INSERT INTO entries (nr, bereich, thema, prio, verantwortlicher, faellig, status, todo, bilder, notiz, geaendert_am, geaendert_von)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(e.nr, e.bereich, e.thema, e.prio, e.verantwortlicher, e.faellig, e.status, e.todo,
         JSON.stringify(e.bilder), e.notiz, e.geaendertAm, e.geaendertVon);
}

async function insertEntry(db, e) { await insertStmt(db, e).run(); }

function updateStmt(db, e) {
  return db.prepare(
    `UPDATE entries SET bereich=?, thema=?, prio=?, verantwortlicher=?, faellig=?, status=?, todo=?, bilder=?, notiz=?, geaendert_am=?, geaendert_von=?
     WHERE nr=?`
  ).bind(e.bereich, e.thema, e.prio, e.verantwortlicher, e.faellig, e.status, e.todo,
         JSON.stringify(e.bilder), e.notiz, e.geaendertAm, e.geaendertVon, e.nr);
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
