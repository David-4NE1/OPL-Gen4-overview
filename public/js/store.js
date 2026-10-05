/*
 * store.js – Datenhaltung mit Cloudflare D1 als Backend.
 *
 * Lädt beim Start alle Einträge per API, hält sie im Speicher und
 * synchronisiert Änderungen im Hintergrund zurück an die API.
 * localStorage dient als Offline-Fallback und Zwischenspeicher.
 */
(function (global) {
  'use strict';

  var API = (function () {
    // Wenn die Seite direkt vom Worker/Pages kommt, ist die API relativ.
    // Ansonsten konfigurierbar:
    var base = global.__OPL_API_BASE || '';
    return {
      get:    function (p) { return fetch(base + p).then(toJSON); },
      post:   function (p, d) { return fetch(base + p, { method: 'POST', headers: CT, body: JSON.stringify(d) }).then(toJSON); },
      put:    function (p, d) { return fetch(base + p, { method: 'PUT', headers: CT, body: JSON.stringify(d) }).then(toJSON); },
      del:    function (p) { return fetch(base + p, { method: 'DELETE' }).then(toJSON); }
    };
    function toJSON(r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || r.statusText); });
      return r.json();
    }
  })();
  var CT = { 'content-type': 'application/json' };

  var KEY = 'opl.4ne1.gen4.v1';

  var BEREICHE = [
    'Hardware/Mechanik', 'Elektrik/Elektronik', 'Simulation/Berechnung',
    'Montage/Fertigung', 'Design', 'Software', 'Advanced Development'
  ];
  var PRIOS = ['Hoch', 'Mittel', 'Niedrig'];
  var STATI = ['Offen', 'In Arbeit', 'Erledigt'];
  var VERANTWORTLICHKEITEN = ['Advanced Development', 'Pre Series'];
  // Feste Themen (Pflicht beim Speichern im Tool); der konkrete Ort/Inhalt steht im To Do
  var THEMEN = [
    'Kollision & Bauraum', 'Kabel & Steckverbinder', 'Montage & Service',
    'Verbindungstechnik & Toleranzen', 'Poka Yoke & Varianten', 'Auslegung & Simulation',
    'Thermik', 'Elektronik & Software', 'BOM/CAD & Dokumentation', 'Industrialisierung & Design'
  ];
  // Reihenfolge von Kopf bis Fuß
  var BAUGRUPPEN = ['Kopf', 'Torso', 'Arm', 'Pelvis/Hüfte', 'Bein', 'Fuß', 'Übergreifend'];
  // Seite aus Sicht des Roboters (fuer paarige Baugruppen wie Arm, Bein, Fuß)
  var SEITEN = ['Links', 'Rechts', 'Beidseitig'];
  // Nacharbeit an bestehenden Teilen
  var NACHARBEIT = ['Re-Milling', 'Modification', 'Re-Milling + Modification'];
  // Alte Freitext-Themen ohne eigenen Informationsgehalt: fallen beim Einordnen weg
  var THEMEN_GENERISCH = ['CAD', 'Montage', 'Kabel', 'Design', 'Schrauben', 'Berechnung', 'Passung',
    'Kollision', 'Elektrik', 'Thermik', 'Lagerung', 'Simulation', 'Material', 'Design-Regel'];

  function istThema(t) { return THEMEN.indexOf(t) >= 0; }

  // Standard-Verantwortlichkeit je Person; greift nur, wenn das Feld leer ist
  var TEAM_STANDARD = {
    'marc zinner': 'Advanced Development',
    'jannik göz': 'Advanced Development',
    'jannik goez': 'Advanced Development',
    'jannik': 'Advanced Development',
    'marcellinus meyer': 'Advanced Development',
    'marcellinus': 'Advanced Development',
    'peter bahn': 'Advanced Development',
    'thorsten grelle': 'Pre Series'
  };
  function teamStandard(name) {
    return TEAM_STANDARD[String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()] || '';
  }

  // Unbekanntes Thema (z. B. aus einer alten Excel) wandert vor das To Do,
  // damit nichts verloren geht; das Thema bleibt leer und wird im Tool gewählt.
  function altesThemaInsTodo(alt, todo) {
    alt = (alt || '').trim();
    todo = todo || '';
    if (!alt || istThema(alt) || THEMEN_GENERISCH.indexOf(alt) >= 0 || todo.indexOf(alt) === 0) return todo;
    return alt + (todo ? ': ' + todo : '');
  }

  function themaEinordnen(n) {
    if (!n.thema || istThema(n.thema)) return n;
    n.todo = altesThemaInsTodo(n.thema, n.todo);
    n.thema = '';
    return n;
  }

  var state = { entries: [], log: [], user: '' };
  var listeners = [];
  var online = true;  // ob die API erreichbar ist
  var statusListener = null;
  var pollFehler = 0;

  function setOnline(wert) {
    var vorher = online;
    online = wert;
    if (statusListener && vorher !== wert) statusListener(wert);
  }

  function heute() { return new Date().toISOString().slice(0, 10); }
  function jetzt() { return new Date().toISOString(); }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function normalizeEntry(e) {
    return {
      nr: e.nr,
      bereich: BEREICHE.indexOf(e.bereich) >= 0 ? e.bereich : BEREICHE[0],
      thema: e.thema || '',
      prio: PRIOS.indexOf(e.prio) >= 0 ? e.prio : 'Mittel',
      verantwortlicher: e.verantwortlicher || '',
      verantwortlichkeit: VERANTWORTLICHKEITEN.indexOf(e.verantwortlichkeit) >= 0 ? e.verantwortlichkeit : '',
      baugruppe: BAUGRUPPEN.indexOf(e.baugruppe) >= 0 ? e.baugruppe : '',
      seite: SEITEN.indexOf(e.seite) >= 0 ? e.seite : '',
      nacharbeit: NACHARBEIT.indexOf(e.nacharbeit) >= 0 ? e.nacharbeit : '',
      release: e.release || '',
      faellig: e.faellig || '',
      status: STATI.indexOf(e.status) >= 0 ? e.status : 'Offen',
      todo: e.todo || '',
      bilder: Array.isArray(e.bilder) ? e.bilder : [],
      notiz: e.notiz || '',
      erstelltAm: e.erstelltAm || '',
      geaendertAm: e.geaendertAm || '',
      geaendertVon: e.geaendertVon || ''
    };
  }

  /* ---- Persistenz: lokal als Fallback ---- */

  function saveLocal() {
    try {
      // Alten (evtl. sehr grossen) Stand zuerst entfernen, sonst scheitert
      // setItem am Speicherlimit und der veraltete Stand bliebe stehen.
      global.localStorage.removeItem(KEY);
      global.localStorage.setItem(KEY, JSON.stringify({
        entries: state.entries, log: state.log.slice(-500), user: state.user
      }));
    } catch (err) { /* voll – ignorieren */ }
  }

  function loadLocal() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state.entries = (parsed.entries || []).map(normalizeEntry);
        state.log = parsed.log || [];
        state.user = parsed.user || '';
        return state.entries.length > 0;
      }
    } catch (err) { /* ignorieren */ }
    return false;
  }

  /* ---- API-Sync ---- */

  function syncToAPI(method, path, data) {
    var p;
    if (method === 'POST') p = API.post(path, data);
    else if (method === 'PUT') p = API.put(path, data);
    else if (method === 'DELETE') p = API.del(path);
    else return;

    p.catch(function (err) {
      console.warn('API-Sync fehlgeschlagen:', err.message);
      notifyError((global.OPLi18n ? global.OPLi18n.T : String)('Speichern auf dem Server fehlgeschlagen: {msg}').replace('{msg}', err.message));
    });
  }

  function load() {
    // Erst lokal laden (für sofortige Anzeige)
    var hadLocal = loadLocal();

    // Dann von API laden
    ladeVomServer()
      .then(function (entries) {
        state.entries = entries.map(normalizeEntry);
        saveLocal();
        setOnline(true);
        emit();
      })
      .catch(function (err) {
        console.warn('API nicht erreichbar, verwende lokalen Stand:', err.message);
        online = true; // damit der Listener sicher feuert
        setOnline(false);
        if (!hadLocal) {
          // Seed-Daten als letzter Fallback
          state.entries = (global.OPL_SEED || []).map(normalizeEntry);
          saveLocal();
        }
      })
      .finally(function () {
        emit();
      });

    // Falls es lokale Daten gab, sofort rendern (API-Update kommt nach)
    if (hadLocal) emit();
    else if (global.OPL_SEED) {
      state.entries = (global.OPL_SEED || []).map(normalizeEntry);
      emit();
    }

    startPolling();
  }

  /* ---- Live-Sync: periodisch pruefen, ob andere etwas geaendert haben ---- */

  // Gepollt wird nur der kleine Aenderungsstand (/api/stand); die volle Liste
  // kommt nur, wenn er sich geaendert hat. Sonst kostet jede Abfrage im Worker
  // so viel CPU-Zeit, dass das Cloudflare-Free-Tier-Limit (10 ms) reisst.
  var POLL_MS = 10000;
  var pollTimer = null;
  var letzterStand = null;

  function istDialogOffen() {
    return !!document.querySelector('dialog[open]');
  }

  // Stand vor der Liste holen: aendert sich dazwischen etwas, ist der
  // gemerkte Stand aelter und die naechste Abfrage laedt erneut.
  function ladeVomServer() {
    var stand;
    return API.get('/api/stand').then(function (r) {
      stand = r.stand;
      return API.get('/api/entries');
    }).then(function (entries) {
      letzterStand = stand;
      return entries;
    });
  }

  function poll() {
    if (document.hidden || istDialogOffen()) return;
    API.get('/api/stand')
      .then(function (r) {
        if (online && r.stand === letzterStand) return null;
        return ladeVomServer();
      })
      .then(function (entries) {
        pollFehler = 0;
        var warOffline = !online;
        setOnline(true);
        if (!entries) return;
        var neu = entries.map(normalizeEntry);
        if (warOffline || JSON.stringify(neu) !== JSON.stringify(state.entries)) {
          state.entries = neu;
          saveLocal();
          emit();
        }
      })
      .catch(function () {
        // Einzelne Aussetzer nicht sofort melden, erst ab dem zweiten in Folge
        pollFehler++;
        if (pollFehler >= 2) setOnline(false);
      });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll();
    });
  }

  function save() {
    saveLocal();
    return true;
  }

  var errorHandler = null;
  function onError(fn) { errorHandler = fn; }
  function onStatus(fn) { statusListener = fn; }
  function isOnline() { return online; }
  function notifyError(msg) { if (errorHandler) errorHandler(msg); }

  function subscribe(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function logEntry(nr, text) {
    state.log.push({ nr: nr, text: text, wann: jetzt(), wer: state.user || 'unbekannt' });
  }

  function commit() { save(); emit(); }

  /* -------------------------------------------------------------- */

  function nextNr() {
    return state.entries.reduce(function (m, e) { return Math.max(m, e.nr); }, 0) + 1;
  }

  function byNr(nr) {
    return state.entries.filter(function (e) { return e.nr === nr; })[0] || null;
  }

  function add(data) {
    var e = normalizeEntry(data);
    e.nr = nextNr();
    e.erstelltAm = heute();
    e.geaendertAm = jetzt();
    e.geaendertVon = state.user || 'unbekannt';
    state.entries.push(e);
    logEntry(e.nr, 'angelegt');
    commit();
    syncToAPI('POST', '/api/entries', Object.assign({}, e, { user: state.user }));
    return e;
  }

  function update(nr, patch) {
    var e = byNr(nr);
    if (!e) return null;
    Object.keys(patch).forEach(function (k) {
      if (e[k] === patch[k]) return;
      if (k === 'bilder' || k === 'geaendertAm' || k === 'geaendertVon') { e[k] = patch[k]; return; }
      logEntry(nr, k + ': "' + (e[k] || '–') + '" → "' + (patch[k] || '–') + '"');
      e[k] = patch[k];
    });
    Object.assign(e, normalizeEntry(e));
    e.geaendertAm = jetzt();
    e.geaendertVon = state.user || 'unbekannt';
    commit();
    var daten = Object.assign({}, e, { user: state.user });
    // Release wird in der Roadmap gepflegt; ein evtl. veralteter lokaler Wert
    // soll eine frische Zuordnung dort nicht ueberschreiben.
    if (!('release' in patch)) delete daten.release;
    syncToAPI('PUT', '/api/entries/' + nr, daten);
    return e;
  }

  function remove(nr) {
    var i = state.entries.findIndex(function (e) { return e.nr === nr; });
    if (i < 0) return false;
    state.entries.splice(i, 1);
    logEntry(nr, 'gelöscht');
    commit();
    syncToAPI('DELETE', '/api/entries/' + nr);
    return true;
  }

  function cycle(nr, feld) {
    var e = byNr(nr);
    if (!e) return;
    var list = feld === 'prio' ? PRIOS : STATI;
    var next = list[(list.indexOf(e[feld]) + 1) % list.length];
    var patch = {};
    patch[feld] = next;
    update(nr, patch);
  }

  function setUser(name) {
    state.user = name || '';
    save();
  }

  function applyImport(entries, modus) {
    var vorher = state.entries.length;
    var bilderProNr = {};
    var erstelltAmProNr = {};
    state.entries.forEach(function (e) {
      if (e.bilder && e.bilder.length) bilderProNr[e.nr] = e.bilder;
      if (e.erstelltAm) erstelltAmProNr[e.nr] = e.erstelltAm;
    });

    var neu = 0, aktualisiert = 0;
    var betroffen = [];
    if (modus === 'ersetzen') {
      state.entries = entries.map(function (e) {
        var n = themaEinordnen(normalizeEntry(e));
        n.verantwortlichkeit = n.verantwortlichkeit || teamStandard(n.verantwortlicher);
        if (!n.bilder.length && bilderProNr[n.nr]) n.bilder = bilderProNr[n.nr];
        n.erstelltAm = n.erstelltAm || erstelltAmProNr[n.nr] || heute();
        return n;
      });
      neu = state.entries.length;
      logEntry(0, 'Excel-Import (ersetzen): ' + vorher + ' → ' + neu + ' Einträge');
    } else {
      entries.forEach(function (raw) {
        var n = normalizeEntry(raw);
        var vorhanden = byNr(n.nr);
        if (vorhanden) {
          if (!n.bilder.length) n.bilder = vorhanden.bilder;
          n.erstelltAm = n.erstelltAm || vorhanden.erstelltAm || heute();
          n.verantwortlichkeit = n.verantwortlichkeit || vorhanden.verantwortlichkeit || teamStandard(n.verantwortlicher);
          n.baugruppe = n.baugruppe || vorhanden.baugruppe;
          n.release = n.release || vorhanden.release;
          n.seite = n.seite || vorhanden.seite;
          n.nacharbeit = n.nacharbeit || vorhanden.nacharbeit;
          // Altes Freitext-Thema aus der Datei ueberschreibt kein gueltiges Thema
          if (!istThema(n.thema) && istThema(vorhanden.thema)) n.thema = vorhanden.thema;
          else themaEinordnen(n);
          Object.assign(vorhanden, n, {
            geaendertAm: jetzt(), geaendertVon: state.user || 'Excel-Import'
          });
          betroffen.push(vorhanden);
          aktualisiert++;
        } else {
          themaEinordnen(n);
          n.verantwortlichkeit = n.verantwortlichkeit || teamStandard(n.verantwortlicher);
          if (!n.bilder.length && bilderProNr[n.nr]) n.bilder = bilderProNr[n.nr];
          n.erstelltAm = n.erstelltAm || heute();
          n.geaendertAm = jetzt();
          n.geaendertVon = state.user || 'Excel-Import';
          state.entries.push(n);
          betroffen.push(n);
          neu++;
        }
      });
      logEntry(0, 'Excel-Import (zusammenführen): ' + aktualisiert + ' aktualisiert, ' + neu + ' neu');
    }
    state.entries.sort(function (a, b) { return a.nr - b.nr; });
    commit();

    // Beim Zusammenfuehren nur die Eintraege aus der Datei schicken, damit
    // parallele Aenderungen anderer an den uebrigen Karten nicht mit dem
    // lokalen Stand ueberschrieben werden.
    syncToAPI('POST', '/api/import', {
      entries: modus === 'ersetzen' ? state.entries : betroffen, modus: modus, user: state.user
    });

    return { neu: neu, aktualisiert: aktualisiert };
  }

  function reset() {
    state.entries = (global.OPL_SEED || []).map(normalizeEntry);
    state.log = [];
    commit();
    syncToAPI('POST', '/api/reset', {});
  }

  function istUeberfaellig(e) {
    return e.status !== 'Erledigt' && !!e.faellig && e.faellig < heute();
  }

  global.OPLStore = {
    BEREICHE: BEREICHE, PRIOS: PRIOS, STATI: STATI, VERANTWORTLICHKEITEN: VERANTWORTLICHKEITEN,
    THEMEN: THEMEN, BAUGRUPPEN: BAUGRUPPEN, SEITEN: SEITEN, NACHARBEIT: NACHARBEIT, istThema: istThema, teamStandard: teamStandard, altesThemaInsTodo: altesThemaInsTodo,
    state: state,
    load: load, subscribe: subscribe, onError: onError, onStatus: onStatus, isOnline: isOnline,
    add: add, update: update, remove: remove, cycle: cycle, byNr: byNr,
    setUser: setUser, applyImport: applyImport, reset: reset,
    istUeberfaellig: istUeberfaellig, heute: heute, clone: clone
  };
})(window);
