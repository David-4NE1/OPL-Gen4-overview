/**
 * Cloudflare Pages Function – catch-all für /api/*
 *
 * D1-Binding "DB" muss im Pages-Dashboard unter Settings → Functions → D1
 * verbunden werden (Variable name: DB).
 */

/* Seed-Daten inline, da Pages Functions keine JSON-Imports aus
   Nachbarordnern unterstützen und der Bundler Probleme macht. */
const SEED = [{"nr":1,"bereich":"Hardware/Mechanik","thema":"Schrauben","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Pruefen, ob Biegung/Kerbenbildung bei Stossbelastung am minimal ueberstehenden Lager auftritt; Schraubenverbindung nachrechnen.","bilder":[],"notiz":""},{"nr":2,"bereich":"Hardware/Mechanik","thema":"Schrauben","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Alle Schraubengroessen durchrechnen und hinterfragen; M4-Schrauben (No-Go) durch geeignete Groesse ersetzen.","bilder":[],"notiz":""},{"nr":3,"bereich":"Hardware/Mechanik","thema":"Schrauben","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Schraubenanzahl je Aktuator berechnen; Optimierung (z. B. jede zweite Schraube) bewerten.","bilder":[],"notiz":""},{"nr":4,"bereich":"Hardware/Mechanik","thema":"Schrauben","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Dehnschraube fuer Shell-Befestigung auslegen – keine Scherbelastung zulaessig; Schraubensicherung (Nord-Lock) pruefen.","bilder":[],"notiz":""},{"nr":5,"bereich":"Hardware/Mechanik","thema":"Material","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Material aller angeschraubten Shells challengen und Festigkeitsnachweis erbringen.","bilder":[],"notiz":""},{"nr":6,"bereich":"Simulation/Berechnung","thema":"Simulation","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Drehmoment/Leistung aller Aktuatoren fuer definierte Use Cases inkl. Temperaturverhalten dokumentieren und simulieren.","bilder":[],"notiz":""},{"nr":7,"bereich":"Simulation/Berechnung","thema":"Simulation","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"FEM/FEA fuer relevante Strukturteile durchfuehren (bisher ueberwiegend nach Bauchgefuehl konstruiert).","bilder":[],"notiz":""},{"nr":8,"bereich":"Hardware/Mechanik","thema":"Gleichteile","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Welche Teile sind aktuell KEINE Gleichteile (u. a. Schienbein gespiegelt)? Konzept glattziehen, um doppelte Druckgusskosten zu vermeiden.","bilder":[],"notiz":""},{"nr":9,"bereich":"Elektrik/Elektronik","thema":"Elektrik","prio":"Mittel","verantwortlicher":"Marcel Vinius","faellig":"","status":"Offen","todo":"Steckerfreigaenge/Positionen abstimmen, Kollisionspruefung im CAD mit Gotech; eigene Steckerentwicklung (Norm-Pin zu lang, Kabelabgang ungünstig).","bilder":[],"notiz":""},{"nr":10,"bereich":"Hardware/Mechanik","thema":"Elektrik","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Zugentlastung mechanisch statt Klebepads vorsehen; Poka Yoke fuer Elektrik/Mechanik definieren (Fehlmontage vermeiden).","bilder":[],"notiz":""},{"nr":11,"bereich":"Hardware/Mechanik","thema":"Montage","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Pads fehlen noch – Montageart spezifizieren (nicht kleben, falls Schraubenzugang benoetigt wird); Zugang sicherstellen, Designintegration klaeren.","bilder":[],"notiz":""},{"nr":12,"bereich":"Hardware/Mechanik","thema":"Berechnung","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Reichweiten und typische Bewegungen (z. B. Arm zur gegenueberliegenden Schulter) pruefen.","bilder":[],"notiz":""},{"nr":13,"bereich":"Hardware/Mechanik","thema":"Passung","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Abstand am kritischen Bereich pruefen (Gefahr \"auf Block\"); Anpassungsvorschlag inkl. Radius/Kollision erstellen.","bilder":[],"notiz":""},{"nr":14,"bereich":"Hardware/Mechanik","thema":"Hardstop","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Hardstop definieren und Simulation fuer Lastfall \"Schraube reisst\" durchfuehren.","bilder":[],"notiz":""},{"nr":15,"bereich":"Hardware/Mechanik","thema":"Thermik","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Konzept zur thermischen Kopplung/Waermeabfuhr ausarbeiten und simulieren; Kamerabelueftung (Helix-Kamera) sicherstellen.","bilder":[],"notiz":""},{"nr":16,"bereich":"Hardware/Mechanik","thema":"Lagerung","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Lager in eine Gehaeusehaelfte verlegen (statt Sprengring in zwei Haelften); Verformungsrisiko Innenring eliminieren.","bilder":[],"notiz":""},{"nr":17,"bereich":"Hardware/Mechanik","thema":"Passung","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Wie sind Toleranzen aktuell geregelt (G7/K-Passung, Sackloch vs. Durchgang)? Verliersicherung definieren.","bilder":[],"notiz":""},{"nr":18,"bereich":"Hardware/Mechanik","thema":"Passung","prio":"Niedrig","verantwortlicher":"","faellig":"","status":"Offen","todo":"Einheitliches Zentrier-/Passungskonzept dokumentieren (Zentrierhuelsen vs. Motorpassungen) – bisher kein roter Faden.","bilder":[],"notiz":""},{"nr":19,"bereich":"Montage/Fertigung","thema":"Montage","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Montagereihenfolge (Massembly-Schritte) detailliert dokumentieren; Zugaenglichkeit aller Komponenten pruefen.","bilder":[],"notiz":""},{"nr":20,"bereich":"Elektrik/Elektronik","thema":"Elektrik","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Eignung fuer Hot-Swap unter Last pruefen (fruehere Kontakte \"abgeraucht\" – Brandgefahr).","bilder":[],"notiz":""},{"nr":21,"bereich":"Hardware/Mechanik","thema":"Aufhaengung","prio":"Hoch","verantwortlicher":"","faellig":"","status":"Offen","todo":"Oesen wirken duenn – Festigkeitsrechnung fuer Aufhaengung durchfuehren (Zugkraft > 120 kg); zusaetzlich klaeren, ob eine Bajonett-Loesung zum Loesen/Loslassen des Gehaenges vorgesehen ist.","bilder":[],"notiz":""},{"nr":22,"bereich":"Elektrik/Elektronik","thema":"CAD","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"IMU, Smartlink, Kondensatoren und SSD-Karte im CAD-Modell lokalisieren bzw. ergaenzen.","bilder":[],"notiz":""},{"nr":23,"bereich":"Hardware/Mechanik","thema":"Berechnung","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Federkraft berechnen; Uebereinstimmung mit Bewegungsradius des Kopfes sicherstellen (Federmontage aktuell kritisch).","bilder":[],"notiz":""},{"nr":24,"bereich":"Montage/Fertigung","thema":"Montage","prio":"Mittel","verantwortlicher":"","faellig":"2026-09-25","status":"Offen","todo":"Alle Bauteile auf Montagefaehigkeit pruefen.","bilder":[],"notiz":""},{"nr":25,"bereich":"Montage/Fertigung","thema":"Montage","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Entscheidung zwischen Tischmontage (horizontal) und haengender Montage treffen.","bilder":[],"notiz":""},{"nr":26,"bereich":"Hardware/Mechanik","thema":"Kollision","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Kollision am Bein pruefen – 2 Bilder von Thorsten als Referenz beilegen/dokumentieren.","bilder":[{"name":"Kollision Bein – Ansicht 1","src":"assets/img/opl-26-kollision-bein-1.png"},{"name":"Kollision Bein – Ansicht 2","src":"assets/img/opl-26-kollision-bein-2.png"}],"notiz":"s. Anhang Thorsten (2 Bilder)"},{"nr":27,"bereich":"Hardware/Mechanik","thema":"Kollision","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Kollision am Kuehler und an den Kuehlstuetzen pruefen.","bilder":[],"notiz":""},{"nr":28,"bereich":"Montage/Fertigung","thema":"Montage","prio":"Niedrig","verantwortlicher":"","faellig":"","status":"Offen","todo":"Pruefen, ob eine Vorrichtung fuer die Montage von Beinen und Armen erstellt werden soll.","bilder":[],"notiz":""},{"nr":29,"bereich":"Design","thema":"Design","prio":"Mittel","verantwortlicher":"","faellig":"","status":"Offen","todo":"Design-Aesthetik/Proportionen (Beine bis Huefte) frueh mit Industriedesign abstimmen; Risiko bei enger Bekleidung (Konturen) beruecksichtigen.","bilder":[],"notiz":""}];

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
