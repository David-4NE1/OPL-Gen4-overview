/*
 * api.js – Verbindung zum OPL-Server.
 *
 * Erkennt beim Start, ob ein Backend erreichbar ist. Wenn ja: gemeinsamer
 * Live-Stand über HTTP + Server-Sent-Events. Wenn nein (z. B. index.html per
 * Doppelklick geöffnet): lokaler Modus, der Store nutzt dann den localStorage.
 */
(function (global) {
  'use strict';

  function jsonFetch(pfad, optionen) {
    var opt = Object.assign({ headers: {} }, optionen || {});
    if (opt.body !== undefined && typeof opt.body !== 'string') {
      opt.body = JSON.stringify(opt.body);
      opt.headers['Content-Type'] = 'application/json';
    }
    return fetch(pfad, opt).then(function (r) {
      return r.text().then(function (txt) {
        var daten = null;
        try { daten = txt ? JSON.parse(txt) : null; } catch (err) { daten = null; }
        if (!r.ok) {
          var fehler = new Error((daten && daten.fehler) || ('HTTP ' + r.status));
          fehler.status = r.status;
          fehler.daten = daten;
          throw fehler;
        }
        return daten;
      });
    });
  }

  var Api = {
    /** Prüft in <timeout> ms, ob ein Backend antwortet. */
    verfuegbar: function (timeout) {
      if (global.location.protocol === 'file:') return Promise.resolve(false);
      if (typeof AbortController === 'undefined') return Promise.resolve(false);
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, timeout || 2500);
      return fetch('api/health', { signal: ctrl.signal })
        .then(function (r) { return r.ok; })
        .catch(function () { return false; })
        .then(function (ok) { clearTimeout(t); return ok; });
    },

    state: function () { return jsonFetch('api/state'); },

    add: function (entry, user) {
      return jsonFetch('api/entries', { method: 'POST', body: { entry: entry, user: user } });
    },

    update: function (nr, patch, rev, user) {
      return jsonFetch('api/entries/' + nr, {
        method: 'PATCH', body: { patch: patch, rev: rev, user: user }
      });
    },

    remove: function (nr, user) {
      // Nutzer als Query-Parameter, nicht als Body – siehe Hinweis im Server.
      return jsonFetch('api/entries/' + nr + '?user=' + encodeURIComponent(user || ''),
        { method: 'DELETE' });
    },

    importieren: function (entries, modus, user) {
      return jsonFetch('api/import', {
        method: 'POST', body: { entries: entries, modus: modus, user: user }
      });
    },

    reset: function (user) {
      return jsonFetch('api/reset', { method: 'POST', body: { user: user } });
    },

    /** Lädt ein Bild hoch und liefert {url, name}. */
    bildHochladen: function (blob, dateiname) {
      return fetch('api/images', {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'image/jpeg',
          'X-Filename': encodeURIComponent(dateiname || '')
        },
        body: blob
      }).then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            throw new Error(d.fehler || ('Upload fehlgeschlagen (HTTP ' + r.status + ')'));
          });
        }
        return r.json();
      });
    },

    /**
     * Öffnet den Live-Kanal.
     * @param {Function} onChange  bekommt die Änderungs-Payload
     * @param {Function} onStatus  true = verbunden, false = getrennt
     * @returns {Function} zum Schließen
     */
    live: function (onChange, onStatus) {
      if (typeof EventSource === 'undefined') { onStatus(false); return function () {}; }
      var es = new EventSource('api/events');
      es.onopen = function () { onStatus(true); };
      es.onerror = function () { onStatus(false); };  // EventSource verbindet selbst neu
      es.onmessage = function (ev) {
        var daten;
        try { daten = JSON.parse(ev.data); } catch (err) { return; }
        if (daten.typ === 'hallo') { onStatus(true); }
        onChange(daten);
      };
      return function () { es.close(); };
    }
  };

  global.OPLApi = Api;
})(window);
