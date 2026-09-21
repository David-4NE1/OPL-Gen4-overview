/*
 * store.js – Datenhaltung, Persistenz und Änderungsprotokoll.
 *
 * Zwei Betriebsarten, die sich nach außen gleich verhalten:
 *   'server' – gemeinsamer Live-Stand über das Backend (siehe server/server.js).
 *              Änderungen landen sofort beim Server und werden per SSE an alle
 *              anderen Browser verteilt.
 *   'lokal'  – kein Backend erreichbar (z. B. index.html per Doppelklick):
 *              Stand liegt im localStorage dieses Browsers.
 *
 * Alle ändernden Funktionen liefern ein Promise.
 */
(function (global) {
  'use strict';

  var KEY = 'opl.4ne1.gen4.v1';
  var Api = global.OPLApi;

  var BEREICHE = [
    'Hardware/Mechanik', 'Elektrik/Elektronik', 'Simulation/Berechnung',
    'Montage/Fertigung', 'Design', 'Software', 'Advanced Development'
  ];
  var PRIOS = ['Hoch', 'Mittel', 'Niedrig'];
  var STATI = ['Offen', 'In Arbeit', 'Erledigt'];

  var state = {
    entries: [], log: [], user: '',
    modus: 'lokal', verbunden: false, rev: 0
  };

  var listeners = [];
  var errorHandler = null;
  var infoHandler = null;

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
      faellig: e.faellig || '',
      status: STATI.indexOf(e.status) >= 0 ? e.status : 'Offen',
      todo: e.todo || '',
      bilder: Array.isArray(e.bilder) ? e.bilder : [],
      notiz: e.notiz || '',
      geaendertAm: e.geaendertAm || '',
      geaendertVon: e.geaendertVon || '',
      rev: e.rev || 0
    };
  }

  function subscribe(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { fn(state); }); }
  function onError(fn) { errorHandler = fn; }
  function onInfo(fn) { infoHandler = fn; }
  function fehler(msg) { if (errorHandler) errorHandler(msg); }
  function info(msg) { if (infoHandler) infoHandler(msg); }

  function byNr(nr) {
    return state.entries.filter(function (e) { return e.nr === nr; })[0] || null;
  }
  function nextNr() {
    return state.entries.reduce(function (m, e) { return Math.max(m, e.nr); }, 0) + 1;
  }
  function istUeberfaellig(e) {
    return e.status !== 'Erledigt' && !!e.faellig && e.faellig < heute();
  }

  /* ---------------------------------------------------------------- */
  /* Lokale Persistenz                                                 */
  /* ---------------------------------------------------------------- */

  function lokalSpeichern() {
    if (state.modus === 'server') return true;   // im Servermodus hält der Server den Stand
    try {
      global.localStorage.setItem(KEY, JSON.stringify({
        entries: state.entries, log: state.log.slice(-500), user: state.user
      }));
      return true;
    } catch (err) {
      console.error('Speichern fehlgeschlagen', err);
      fehler('Speichern fehlgeschlagen – vermutlich ist der lokale Speicher voll ' +
        '(zu viele/zu große Bilder). Bitte exportieren und Bilder verkleinern.');
      return false;
    }
  }

  function benutzerLesen() {
    try { return global.localStorage.getItem(KEY + '.user') || ''; } catch (err) { return ''; }
  }
  function benutzerSchreiben(name) {
    try { global.localStorage.setItem(KEY + '.user', name); } catch (err) { /* egal */ }
  }

  function log(nr, text) {
    state.log.push({ nr: nr, text: text, wann: jetzt(), wer: state.user || 'unbekannt' });
  }

  function lokalCommit() { lokalSpeichern(); emit(); }

  /* ---------------------------------------------------------------- */
  /* Start                                                             */
  /* ---------------------------------------------------------------- */

  function init() {
    state.user = benutzerLesen();
    return Api.verfuegbar().then(function (da) {
      return da ? serverStart() : lokalStart();
    }).catch(function (err) {
      console.warn('Backend-Erkennung fehlgeschlagen, starte lokal.', err);
      return lokalStart();
    });
  }

  function lokalStart() {
    state.modus = 'lokal';
    state.verbunden = false;
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (err) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        state.entries = (parsed.entries || []).map(normalizeEntry);
        state.log = parsed.log || [];
        if (!state.user) state.user = parsed.user || '';
        if (state.entries.length) return Promise.resolve();
      } catch (err) {
        console.warn('Gespeicherter Stand unlesbar, starte mit Seed-Daten.', err);
      }
    }
    state.entries = (global.OPL_SEED || []).map(normalizeEntry);
    state.log = [];
    lokalSpeichern();
    return Promise.resolve();
  }

  function serverStart() {
    state.modus = 'server';
    return Api.state().then(function (daten) {
      uebernehmen(daten);
      Api.live(sseAenderung, function (verbunden) {
        var vorher = state.verbunden;
        state.verbunden = verbunden;
        if (verbunden && !vorher) {
          // Nach einem Verbindungsabriss kann uns etwas entgangen sein.
          Api.state().then(function (d) { uebernehmen(d); emit(); }).catch(function () {});
        }
        emit();
      });
    });
  }

  function uebernehmen(daten) {
    state.entries = (daten.entries || []).map(normalizeEntry);
    state.log = daten.log || state.log;
    state.rev = daten.rev || 0;
  }

  function vollNachladen() {
    return Api.state().then(function (d) { uebernehmen(d); emit(); }).catch(function () {});
  }

  /** Verarbeitet eine Live-Meldung des Servers. */
  function sseAenderung(daten) {
    if (daten.typ === 'hallo') {
      if (daten.rev !== state.rev) vollNachladen();
      return;
    }
    if (daten.rev > state.rev + 1) {
      // Wir haben etwas verpasst – lieber komplett neu holen als raten.
      vollNachladen();
      return;
    }
    if (daten.typ === 'voll' && daten.entries) {
      state.entries = daten.entries.map(normalizeEntry);
    } else if (daten.typ === 'remove') {
      state.entries = state.entries.filter(function (e) { return e.nr !== daten.nr; });
    } else if (daten.entry) {
      var neu = normalizeEntry(daten.entry);
      var alt = byNr(neu.nr);
      if (alt) state.entries[state.entries.indexOf(alt)] = neu;
      else state.entries.push(neu);
      state.entries.sort(function (a, b) { return a.nr - b.nr; });
    }
    state.rev = Math.max(state.rev, daten.rev || 0);
    emit();
  }

  /* ---------------------------------------------------------------- */
  /* Mutationen                                                        */
  /* ---------------------------------------------------------------- */

  function add(data) {
    if (state.modus === 'server') {
      return Api.add(normalizeEntry(Object.assign({ nr: 0 }, data)), state.user)
        .then(function (res) {
          var e = normalizeEntry(res.entry);
          if (!byNr(e.nr)) state.entries.push(e);
          state.rev = res.rev;
          emit();
          return e;
        }).catch(function (err) {
          fehler('Anlegen fehlgeschlagen: ' + err.message);
          throw err;
        });
    }
    var e = normalizeEntry(data);
    e.nr = nextNr();
    e.rev = 1;
    e.geaendertAm = jetzt();
    e.geaendertVon = state.user || 'unbekannt';
    state.entries.push(e);
    log(e.nr, 'angelegt');
    lokalCommit();
    return Promise.resolve(e);
  }

  function update(nr, patch) {
    var alt = byNr(nr);
    if (!alt) return Promise.reject(new Error('Punkt ' + nr + ' nicht gefunden'));

    if (state.modus === 'server') {
      var sicherung = clone(alt);
      // Optimistisch: sofort anzeigen, der Server bestätigt gleich.
      var vorschau = normalizeEntry(Object.assign({}, alt, patch));
      vorschau.rev = alt.rev;
      state.entries[state.entries.indexOf(alt)] = vorschau;
      emit();

      return Api.update(nr, patch, sicherung.rev, state.user).then(function (res) {
        var bestaetigt = normalizeEntry(res.entry);
        var jetzigen = byNr(nr);
        if (jetzigen) state.entries[state.entries.indexOf(jetzigen)] = bestaetigt;
        state.rev = res.rev;
        emit();
        return bestaetigt;
      }).catch(function (err) {
        var aktuell = byNr(nr);
        if (err.status === 409 && err.daten && err.daten.entry) {
          // Jemand anderes war schneller – dessen Stand gewinnt.
          var fremd = normalizeEntry(err.daten.entry);
          if (aktuell) state.entries[state.entries.indexOf(aktuell)] = fremd;
          emit();
          info('Punkt #' + nr + ' wurde zwischenzeitlich von ' +
            (fremd.geaendertVon || 'jemand anderem') + ' geändert – aktueller Stand übernommen.');
          return fremd;
        }
        if (aktuell) state.entries[state.entries.indexOf(aktuell)] = sicherung;
        emit();
        if (err.status === 404) { vollNachladen(); fehler('Punkt #' + nr + ' existiert nicht mehr.'); }
        else fehler('Änderung nicht gespeichert: ' + err.message);
        throw err;
      });
    }

    Object.keys(patch).forEach(function (k) {
      if (alt[k] === patch[k]) return;
      if (k === 'bilder' || k === 'geaendertAm' || k === 'geaendertVon' || k === 'rev') {
        alt[k] = patch[k];
        return;
      }
      log(nr, k + ': "' + (alt[k] || '–') + '" → "' + (patch[k] || '–') + '"');
      alt[k] = patch[k];
    });
    Object.assign(alt, normalizeEntry(alt));
    alt.rev = (alt.rev || 0) + 1;
    alt.geaendertAm = jetzt();
    alt.geaendertVon = state.user || 'unbekannt';
    lokalCommit();
    return Promise.resolve(alt);
  }

  function remove(nr) {
    var alt = byNr(nr);
    if (!alt) return Promise.resolve(false);
    var i = state.entries.indexOf(alt);

    if (state.modus === 'server') {
      var sicherung = clone(alt);
      state.entries.splice(i, 1);
      emit();
      return Api.remove(nr, state.user).then(function (res) {
        state.rev = res.rev;
        return true;
      }).catch(function (err) {
        if (err.status !== 404) {
          state.entries.splice(i, 0, sicherung);
          emit();
          fehler('Löschen fehlgeschlagen: ' + err.message);
          throw err;
        }
        return true;
      });
    }

    state.entries.splice(i, 1);
    log(nr, 'gelöscht');
    lokalCommit();
    return Promise.resolve(true);
  }

  function cycle(nr, feld) {
    var e = byNr(nr);
    if (!e) return Promise.resolve();
    var liste = feld === 'prio' ? PRIOS : STATI;
    var patch = {};
    patch[feld] = liste[(liste.indexOf(e[feld]) + 1) % liste.length];
    return update(nr, patch).catch(function () { /* Meldung kam schon */ });
  }

  function setUser(name) {
    state.user = name || '';
    benutzerSchreiben(state.user);
    lokalSpeichern();
  }

  function applyImport(entries, modus) {
    if (state.modus === 'server') {
      return Api.importieren(entries, modus, state.user).then(function (res) {
        if (res.entries) state.entries = res.entries.map(normalizeEntry);
        state.rev = res.rev;
        emit();
        return { neu: res.neu, aktualisiert: res.aktualisiert };
      }).catch(function (err) {
        fehler('Import fehlgeschlagen: ' + err.message);
        throw err;
      });
    }

    var vorher = state.entries.length;
    var bilderProNr = {};
    state.entries.forEach(function (e) {
      if (e.bilder && e.bilder.length) bilderProNr[e.nr] = e.bilder;
    });

    var neu = 0;
    var aktualisiert = 0;
    if (modus === 'ersetzen') {
      state.entries = entries.map(function (e) {
        var n = normalizeEntry(e);
        // Bilder stehen nicht in der Excel – vorhandene je Nr erhalten.
        if (!n.bilder.length && bilderProNr[n.nr]) n.bilder = bilderProNr[n.nr];
        return n;
      });
      neu = state.entries.length;
      log(0, 'Excel-Import (ersetzen): ' + vorher + ' → ' + neu + ' Einträge');
    } else {
      entries.forEach(function (roh) {
        var n = normalizeEntry(roh);
        var vorhanden = byNr(n.nr);
        if (vorhanden) {
          if (!n.bilder.length) n.bilder = vorhanden.bilder;
          Object.assign(vorhanden, n, {
            geaendertAm: jetzt(), geaendertVon: state.user || 'Excel-Import'
          });
          aktualisiert++;
        } else {
          if (!n.bilder.length && bilderProNr[n.nr]) n.bilder = bilderProNr[n.nr];
          n.geaendertAm = jetzt();
          n.geaendertVon = state.user || 'Excel-Import';
          state.entries.push(n);
          neu++;
        }
      });
      log(0, 'Excel-Import (zusammenführen): ' + aktualisiert + ' aktualisiert, ' + neu + ' neu');
    }
    state.entries.sort(function (a, b) { return a.nr - b.nr; });
    lokalCommit();
    return Promise.resolve({ neu: neu, aktualisiert: aktualisiert });
  }

  function reset() {
    if (state.modus === 'server') {
      return Api.reset(state.user).then(function (res) {
        if (res.entries) state.entries = res.entries.map(normalizeEntry);
        state.rev = res.rev;
        emit();
      }).catch(function (err) {
        fehler('Zurücksetzen fehlgeschlagen: ' + err.message);
        throw err;
      });
    }
    state.entries = (global.OPL_SEED || []).map(normalizeEntry);
    state.log = [];
    lokalCommit();
    return Promise.resolve();
  }

  /** Bild ablegen: im Servermodus hochladen, sonst als Data-URL behalten. */
  function bildSpeichern(bild) {
    if (state.modus !== 'server') return Promise.resolve(bild);
    return fetch(bild.src).then(function (r) { return r.blob(); })
      .then(function (blob) { return Api.bildHochladen(blob, bild.name); })
      .then(function (res) { return { name: bild.name || res.name, src: res.url }; });
  }

  /** Protokoll holen – im Servermodus immer frisch vom Server. */
  function holeLog() {
    if (state.modus !== 'server') return Promise.resolve(state.log);
    return Api.state().then(function (d) {
      state.log = d.log || [];
      return state.log;
    }).catch(function () { return state.log; });
  }

  global.OPLStore = {
    BEREICHE: BEREICHE, PRIOS: PRIOS, STATI: STATI,
    state: state,
    init: init, subscribe: subscribe, onError: onError, onInfo: onInfo,
    add: add, update: update, remove: remove, cycle: cycle, byNr: byNr,
    setUser: setUser, applyImport: applyImport, reset: reset,
    bildSpeichern: bildSpeichern, holeLog: holeLog,
    istUeberfaellig: istUeberfaellig, heute: heute, clone: clone
  };
})(window);
