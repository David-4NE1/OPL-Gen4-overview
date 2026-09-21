/*
 * store.js – Datenhaltung, Persistenz und Änderungsprotokoll.
 *
 * Persistiert wird sofort nach jeder Änderung im localStorage.
 * Der Abgleich zwischen mehreren Bearbeitern läuft über
 * Excel-Export/-Import (siehe README).
 */
(function (global) {
  'use strict';

  var KEY = 'opl.4ne1.gen4.v1';

  var BEREICHE = [
    'Hardware/Mechanik', 'Elektrik/Elektronik', 'Simulation/Berechnung',
    'Montage/Fertigung', 'Design', 'Software', 'Advanced Development'
  ];
  var PRIOS = ['Hoch', 'Mittel', 'Niedrig'];
  var STATI = ['Offen', 'In Arbeit', 'Erledigt'];

  var state = { entries: [], log: [], user: '' };
  var listeners = [];

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
      geaendertVon: e.geaendertVon || ''
    };
  }

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (err) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        state.entries = (parsed.entries || []).map(normalizeEntry);
        state.log = parsed.log || [];
        state.user = parsed.user || '';
        if (state.entries.length) return;
      } catch (err) {
        console.warn('Gespeicherter Stand unlesbar, starte mit Seed-Daten.', err);
      }
    }
    state.entries = (global.OPL_SEED || []).map(normalizeEntry);
    state.log = [];
    save();
  }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify({
        entries: state.entries, log: state.log.slice(-500), user: state.user
      }));
      return true;
    } catch (err) {
      console.error('Speichern fehlgeschlagen', err);
      notifyError('Speichern fehlgeschlagen – vermutlich ist der lokale Speicher voll ' +
        '(zu viele/zu große Bilder). Bitte exportieren und Bilder verkleinern.');
      return false;
    }
  }

  var errorHandler = null;
  function onError(fn) { errorHandler = fn; }
  function notifyError(msg) { if (errorHandler) errorHandler(msg); }

  function subscribe(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function log(nr, text) {
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
    e.geaendertAm = jetzt();
    e.geaendertVon = state.user || 'unbekannt';
    state.entries.push(e);
    log(e.nr, 'angelegt');
    commit();
    return e;
  }

  function update(nr, patch) {
    var e = byNr(nr);
    if (!e) return null;
    Object.keys(patch).forEach(function (k) {
      if (e[k] === patch[k]) return;
      if (k === 'bilder' || k === 'geaendertAm' || k === 'geaendertVon') { e[k] = patch[k]; return; }
      log(nr, k + ': "' + (e[k] || '–') + '" → "' + (patch[k] || '–') + '"');
      e[k] = patch[k];
    });
    Object.assign(e, normalizeEntry(e));
    e.geaendertAm = jetzt();
    e.geaendertVon = state.user || 'unbekannt';
    commit();
    return e;
  }

  function remove(nr) {
    var i = state.entries.findIndex(function (e) { return e.nr === nr; });
    if (i < 0) return false;
    state.entries.splice(i, 1);
    log(nr, 'gelöscht');
    commit();
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

  /**
   * Import: ersetzt entweder alles oder führt per Nr zusammen.
   * @param {Array} entries  eingelesene Einträge
   * @param {string} modus   'ersetzen' | 'zusammenfuehren'
   */
  function applyImport(entries, modus) {
    var vorher = state.entries.length;
    var bilderProNr = {};
    state.entries.forEach(function (e) {
      if (e.bilder && e.bilder.length) bilderProNr[e.nr] = e.bilder;
    });

    var neu = 0, aktualisiert = 0;
    if (modus === 'ersetzen') {
      state.entries = entries.map(function (e) {
        var n = normalizeEntry(e);
        // Bilder liegen nicht in der Excel – lokal vorhandene je Nr erhalten
        if (!n.bilder.length && bilderProNr[n.nr]) n.bilder = bilderProNr[n.nr];
        return n;
      });
      neu = state.entries.length;
      log(0, 'Excel-Import (ersetzen): ' + vorher + ' → ' + neu + ' Einträge');
    } else {
      entries.forEach(function (raw) {
        var n = normalizeEntry(raw);
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
    commit();
    return { neu: neu, aktualisiert: aktualisiert };
  }

  function reset() {
    state.entries = (global.OPL_SEED || []).map(normalizeEntry);
    state.log = [];
    commit();
  }

  function istUeberfaellig(e) {
    return e.status !== 'Erledigt' && !!e.faellig && e.faellig < heute();
  }

  global.OPLStore = {
    BEREICHE: BEREICHE, PRIOS: PRIOS, STATI: STATI,
    state: state,
    load: load, subscribe: subscribe, onError: onError,
    add: add, update: update, remove: remove, cycle: cycle, byNr: byNr,
    setUser: setUser, applyImport: applyImport, reset: reset,
    istUeberfaellig: istUeberfaellig, heute: heute, clone: clone
  };
})(window);
