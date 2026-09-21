/**
 * Cloudflare Pages Function – catch-all für /api/*
 *
 * Leitet an die gleiche Logik weiter wie der standalone Worker.
 * D1-Binding "DB" muss im Pages-Dashboard unter Settings → Functions → D1
 * verbunden werden (Variable name: DB).
 */

import SEED from '../../worker/seed.json';

/* -------------------------------------------------------- Normalize */

const BEREICHE = [
  'Hardware/Mechanik','Elektrik/Elektronik','Simulation/Berechnung',
  'Montage/Fertigung','Design','Software','Advanced Development'
];
const PRIOS = ['Hoch','Mittel','Niedrig'];
const STATI = ['Offen','In Arbeit','Erledigt'];

function normalize(e) {
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
    nr: row.nr, bereich: row.bereich, thema: row.thema, prio: row.prio,
    verantwortlicher: row.verantwortlicher, faellig: row.faellig,
    status: row.status, todo: row.todo, bilder, notiz: row.notiz,
    geaendertAm: row.geaendert_am, geaendertVon: row.geaendert_von
  };
}

/* -------------------------------------------------------- DB helpers */

function insertStmt(db, e) {
  return db.prepare(
    `INSERT INTO entries (nr,bereich,thema,prio,verantwortlicher,faellig,status,todo,bilder,notiz,geaendert_am,geaendert_von)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(e.nr,e.bereich,e.thema,e.prio,e.verantwortlicher,e.faellig,e.status,e.todo,
    JSON.stringify(e.bilder),e.notiz,e.geaendertAm,e.geaendertVon);
}

function updateStmt(db, e) {
  return db.prepare(
    `UPDATE entries SET bereich=?,thema=?,prio=?,verantwortlicher=?,faellig=?,status=?,todo=?,bilder=?,notiz=?,geaendert_am=?,geaendert_von=? WHERE nr=?`
  ).bind(e.bereich,e.thema,e.prio,e.verantwortlicher,e.faellig,e.status,e.todo,
    JSON.stringify(e.bilder),e.notiz,e.geaendertAm,e.geaendertVon,e.nr);
}

async function logChange(db, nr, text, wer) {
  await db.prepare('INSERT INTO changelog (nr,text,wann,wer) VALUES (?,?,?,?)')
    .bind(nr, text, new Date().toISOString(), wer || 'unbekannt').run();
}

/* -------------------------------------------------------- Responses */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

/* -------------------------------------------------------- Handler */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') return json(null, 204);

  const db = env.DB;
  if (!db) return json({ error: 'D1-Binding DB fehlt – in Pages Settings → Functions → D1 verbinden.' }, 500);

  const path = url.pathname.replace(/\/+$/, '');

  try {
    // GET /api/entries
    if (path === '/api/entries' && method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM entries ORDER BY nr').all();
      return json(results.map(dbToEntry));
    }

    // GET /api/entries/:nr
    const matchOne = path.match(/^\/api\/entries\/(\d+)$/);
    if (matchOne && method === 'GET') {
      const row = await db.prepare('SELECT * FROM entries WHERE nr=?').bind(+matchOne[1]).first();
      if (!row) return json({ error: 'Nicht gefunden' }, 404);
      return json(dbToEntry(row));
    }

    // POST /api/entries
    if (path === '/api/entries' && method === 'POST') {
      const data = await request.json();
      const maxRow = await db.prepare('SELECT MAX(nr) AS m FROM entries').first();
      const nr = (maxRow?.m || 0) + 1;
      const now = new Date().toISOString();
      const e = normalize({ ...data, nr, geaendertAm: now, geaendertVon: data.user || 'unbekannt' });
      await insertStmt(db, e).run();
      await logChange(db, nr, 'angelegt', e.geaendertVon);
      return json(e, 201);
    }

    // PUT /api/entries/:nr
    if (matchOne && method === 'PUT') {
      const nr = +matchOne[1];
      const row = await db.prepare('SELECT * FROM entries WHERE nr=?').bind(nr).first();
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
        ...old, ...patch, nr,
        geaendertAm: now, geaendertVon: patch.user || old.geaendertVon || 'unbekannt'
      });
      await updateStmt(db, updated).run();
      for (const c of changes) await logChange(db, nr, c, updated.geaendertVon);
      return json(updated);
    }

    // DELETE /api/entries/:nr
    if (matchOne && method === 'DELETE') {
      const nr = +matchOne[1];
      const existing = await db.prepare('SELECT nr FROM entries WHERE nr=?').bind(nr).first();
      if (!existing) return json({ error: 'Nicht gefunden' }, 404);
      await db.prepare('DELETE FROM entries WHERE nr=?').bind(nr).run();
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
        if (stmts.length) await db.batch(stmts);
        await logChange(db, 0, `Excel-Import (ersetzen): ${entries.length} Einträge`, user || 'Excel-Import');
        return json({ neu: entries.length, aktualisiert: 0 });
      }

      let neu = 0, aktualisiert = 0;
      const stmts = [];
      for (const raw of entries) {
        const e = normalize({ ...raw, geaendertAm: now, geaendertVon: user || 'Excel-Import' });
        const existing = await db.prepare('SELECT nr FROM entries WHERE nr=?').bind(e.nr).first();
        if (existing) { stmts.push(updateStmt(db, e)); aktualisiert++; }
        else { stmts.push(insertStmt(db, e)); neu++; }
      }
      if (stmts.length) await db.batch(stmts);
      await logChange(db, 0, `Excel-Import (zusammenführen): ${aktualisiert} aktualisiert, ${neu} neu`, user || 'Excel-Import');
      return json({ neu, aktualisiert });
    }

    // POST /api/reset
    if (path === '/api/reset' && method === 'POST') {
      await db.prepare('DELETE FROM entries').run();
      await db.prepare('DELETE FROM changelog').run();
      const stmts = SEED.map(raw => insertStmt(db, normalize(raw)));
      if (stmts.length) await db.batch(stmts);
      return json({ ok: true, count: SEED.length });
    }

    // GET /api/log
    if (path === '/api/log' && method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM changelog ORDER BY id DESC LIMIT 500').all();
      return json(results);
    }

    return json({ error: 'Route nicht gefunden' }, 404);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
