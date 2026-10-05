/*
 * roadmap.js – Release-Board auf Basis der OPL.
 *
 * Liest die OPL-Punkte (/api/entries) und Releases (/api/releases) und ordnet
 * Punkte per Drag & Drop einem Release zu. Die Zuordnung steht als Feld
 * "release" direkt am Punkt (PUT /api/entries/:nr) – damit ist die Roadmap
 * keine zweite Liste, sondern eine Sicht auf die OPL.
 *
 * Ohne Server (Datei lokal geoeffnet) laeuft die Seite als Demo mit den
 * Startdaten aus js/seed.js; Zuordnungen bleiben dann nur in diesem Browser.
 */
(function () {
  'use strict';

  var BEREICHE = ['Hardware/Mechanik', 'Elektrik/Elektronik', 'Simulation/Berechnung',
    'Montage/Fertigung', 'Design', 'Software', 'Advanced Development'];
  var BAUGRUPPEN = ['Kopf', 'Torso', 'Arm', 'Pelvis/Hüfte', 'Bein', 'Fuß', 'Übergreifend'];
  var PRIOS = ['Hoch', 'Mittel', 'Niedrig'];
  var STATI = ['Offen', 'In Arbeit', 'Erledigt'];
  var TEAMS = ['Advanced Development', 'Pre Series'];
  var RELEASE_STATI = ['Geplant', 'In Arbeit', 'Freigegeben'];
  var STANDARD_RELEASES = ['4.0.1', '4.0.2', '4.0.3'];
  var DEMO_KEY = 'opl.roadmap.demo.v1';
  var POLL_MS = 10000;

  var state = { entries: [], releases: [], user: '', modus: 'laden', stand: null };
  var dragNr = null;
  var bearbeitetesRelease = null;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/\s+/g, '-'); }
  function ddmmyyyy(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }
  function versionVergleich(a, b) {
    var x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  }

  var toastTimer = null;
  function toast(msg, fehler) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (fehler ? ' toast--error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, fehler ? 6000 : 2800);
  }

  function banner(html) {
    var b = $('#modeBanner');
    b.hidden = !html;
    b.innerHTML = html || '';
  }

  /* ------------------------------------------------------------ Datenquelle */

  function api(method, pfad, daten) {
    var opt = { method: method, headers: { 'content-type': 'application/json' } };
    if (daten !== undefined) opt.body = JSON.stringify(daten);
    return fetch(pfad, opt).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (e) {
        var err = new Error(e.error || r.statusText);
        err.status = r.status;
        throw err;
      });
      return r.json();
    });
  }

  function ladeServer() {
    var stand;
    return api('GET', '/api/stand').then(function (r) {
      stand = r.stand;
      return Promise.all([api('GET', '/api/entries'), api('GET', '/api/releases')]);
    }).then(function (res) {
      state.stand = stand;
      state.entries = res[0];
      state.releases = res[1];
    });
  }

  function demoLaden() {
    var gespeichert = {};
    try { gespeichert = JSON.parse(localStorage.getItem(DEMO_KEY) || '{}') || {}; } catch (e) {}
    var zuordnung = gespeichert.zuordnung || {};
    state.releases = gespeichert.releases || STANDARD_RELEASES.map(function (n) {
      return { name: n, ziel: '', status: 'Geplant', beschreibung: '' };
    });
    state.entries = (window.OPL_SEED || []).map(function (e) {
      return Object.assign({}, e, { release: zuordnung[e.nr] || '' });
    });
  }

  function demoSpeichern() {
    var zuordnung = {};
    state.entries.forEach(function (e) { if (e.release) zuordnung[e.nr] = e.release; });
    try { localStorage.setItem(DEMO_KEY, JSON.stringify({ releases: state.releases, zuordnung: zuordnung })); } catch (e) {}
  }

  function poll() {
    if (state.modus !== 'server' || document.hidden || dragNr != null || document.querySelector('dialog[open]')) return;
    api('GET', '/api/stand').then(function (r) {
      if (r.stand === state.stand) return;
      return ladeServer().then(render);
    }).catch(function () { /* naechster Versuch */ });
  }

  /* ------------------------------------------------------------ Aktionen */

  function byNr(nr) {
    for (var i = 0; i < state.entries.length; i++) if (state.entries[i].nr === nr) return state.entries[i];
    return null;
  }

  function zuordnen(nr, release) {
    var e = byNr(nr);
    if (!e || (e.release || '') === release) return;
    var vorher = e.release || '';
    e.release = release;
    e._speichert = true;
    render();
    var ziel = release ? 'Release ' + release : 'nicht eingeplant';

    if (state.modus === 'demo') {
      delete e._speichert;
      demoSpeichern();
      render();
      toast('#' + nr + ' → ' + ziel);
      return;
    }
    api('PUT', '/api/entries/' + nr, { release: release, user: state.user }).then(function (neu) {
      var i = state.entries.indexOf(e);
      if (i >= 0) state.entries[i] = neu;
      render();
      toast('#' + nr + ' → ' + ziel);
    }).catch(function (err) {
      e.release = vorher;
      delete e._speichert;
      render();
      toast('Speichern fehlgeschlagen: ' + err.message, true);
    });
  }

  function releaseSpeichern(daten) {
    if (state.modus === 'demo') {
      var alt = state.releases.filter(function (r) { return r.name === daten.name; })[0];
      if (alt) Object.assign(alt, daten); else state.releases.push(daten);
      demoSpeichern();
      render();
      return Promise.resolve();
    }
    return api('POST', '/api/releases', Object.assign({ user: state.user }, daten)).then(function (liste) {
      state.releases = liste;
      render();
    });
  }

  function releaseLoeschen(name) {
    if (state.modus === 'demo') {
      state.releases = state.releases.filter(function (r) { return r.name !== name; });
      state.entries.forEach(function (e) { if (e.release === name) e.release = ''; });
      demoSpeichern();
      render();
      return Promise.resolve();
    }
    return api('DELETE', '/api/releases/' + encodeURIComponent(name)).then(function () {
      return ladeServer();
    }).then(render);
  }

  /* ------------------------------------------------------------ Filter */

  function filterWerte() {
    return {
      q: $('#suche').value.trim().toLowerCase(),
      bereich: $('#fBereich').value,
      baugruppe: $('#fBaugruppe').value,
      prio: $('#fPrio').value,
      team: $('#fTeam').value,
      erledigt: $('#fErledigt').checked
    };
  }

  function passt(e, f) {
    if (f.bereich && e.bereich !== f.bereich) return false;
    if (f.baugruppe && e.baugruppe !== f.baugruppe) return false;
    if (f.prio && e.prio !== f.prio) return false;
    if (f.team && e.verantwortlichkeit !== f.team) return false;
    if (!f.erledigt && e.status === 'Erledigt') return false;
    if (f.q) {
      var text = ['#' + e.nr, e.thema, e.todo, e.verantwortlicher, e.bereich, e.baugruppe].join(' ').toLowerCase();
      if (text.indexOf(f.q) < 0) return false;
    }
    return true;
  }

  function filterAktiv(f) {
    return !!(f.q || f.bereich || f.baugruppe || f.prio || f.team || !f.erledigt);
  }

  // Offene zuerst, Erledigte ans Ende; innerhalb nach Prio, dann Nr
  function sortierung(a, b) {
    return ((a.status === 'Erledigt') - (b.status === 'Erledigt')) ||
      (PRIOS.indexOf(a.prio) - PRIOS.indexOf(b.prio)) || (a.nr - b.nr);
  }

  /* ------------------------------------------------------------ Rendering */

  // Releases in Versionsreihenfolge; Werte an Punkten ohne angelegtes Release
  // (z. B. nach dem Loeschen auf einem anderen Rechner) bekommen trotzdem eine Spalte.
  function spalten() {
    var bekannt = {};
    var liste = state.releases.map(function (r) { bekannt[r.name] = true; return r; });
    state.entries.forEach(function (e) {
      if (e.release && !bekannt[e.release]) {
        bekannt[e.release] = true;
        liste.push({ name: e.release, ziel: '', status: '', beschreibung: '', fehlt: true });
      }
    });
    return liste.sort(function (a, b) { return versionVergleich(a.name, b.name); });
  }

  function render() {
    var f = filterWerte();
    $('#btnFilterReset').hidden = !filterAktiv(f);
    renderKpis();

    var board = $('#board');
    board.innerHTML = '';
    board.appendChild(renderSpalte(null, f));
    spalten().forEach(function (r) { board.appendChild(renderSpalte(r, f)); });

    var n = state.entries.length;
    $('#standLine').textContent = 'Release-Planung aus der Open Point List · ' + n + ' Punkte' +
      (state.modus === 'demo' ? ' · Demo-Modus' : '');
  }

  function renderKpis() {
    var k = $('#kpis');
    k.innerHTML = '';
    var offen = state.entries.filter(function (e) { return e.status !== 'Erledigt'; });
    var ohne = offen.filter(function (e) { return !e.release; });
    var hochOhne = ohne.filter(function (e) { return e.prio === 'Hoch'; });
    [
      [offen.length - ohne.length, 'offen eingeplant', ''],
      [ohne.length, 'offen ohne Release', ''],
      [hochOhne.length, 'Prio hoch ohne Release', 'kpi--overdue' + (hochOhne.length ? ' has-overdue' : '')]
    ].forEach(function (w) {
      var b = el('div', 'kpi ' + w[2]);
      b.appendChild(el('span', 'kpi__value', String(w[0])));
      b.appendChild(el('span', 'kpi__label', w[1]));
      k.appendChild(b);
    });
  }

  function renderSpalte(r, f) {
    var name = r ? r.name : '';
    var col = el('section', 'rm-col' + (r ? '' : ' rm-col--backlog'));
    col.dataset.release = name;

    var alle = state.entries.filter(function (e) { return (e.release || '') === name; });
    var sichtbar = alle.filter(function (e) { return passt(e, f); }).sort(sortierung);

    var head = el('header', 'rm-col__head');
    var title = el('div', 'rm-col__title');
    title.appendChild(el('h2', null, r ? 'Release ' + r.name : 'Nicht eingeplant'));
    if (r && r.fehlt) {
      title.appendChild(el('span', 'rm-badge rm-badge--warn', 'nicht angelegt'));
    } else if (r) {
      title.appendChild(el('span', 'rm-badge rm-badge--' + slug(r.status), r.status || 'Geplant'));
    }
    if (r) {
      var edit = el('button', 'card__edit', '✎');
      edit.type = 'button';
      edit.title = 'Release bearbeiten';
      edit.addEventListener('click', function () { oeffneRelease(r); });
      title.appendChild(edit);
    }
    head.appendChild(title);

    var sub = [];
    if (r && r.ziel) sub.push('Ziel: ' + ddmmyyyy(r.ziel));
    var offen = alle.filter(function (e) { return e.status !== 'Erledigt'; }).length;
    sub.push(alle.length + ' Punkte · ' + offen + ' offen');
    var hoch = alle.filter(function (e) { return e.prio === 'Hoch' && e.status !== 'Erledigt'; }).length;
    if (hoch) sub.push(hoch + '× Prio hoch');
    if (sichtbar.length !== alle.length) sub.push(sichtbar.length + ' angezeigt');
    head.appendChild(el('p', 'rm-col__sub', sub.join(' · ')));
    if (r && r.beschreibung) head.appendChild(el('p', 'rm-col__desc', r.beschreibung));

    if (r && alle.length) {
      var stats = el('div', 'rm-col__stats');
      var bar = el('div', 'progress');
      [['Erledigt', 'erledigt'], ['In Arbeit', 'arbeit'], ['Offen', 'offen']].forEach(function (s) {
        var n = alle.filter(function (e) { return e.status === s[0]; }).length;
        var seg = el('div', 'progress__seg progress__seg--' + s[1]);
        seg.style.width = (100 * n / alle.length) + '%';
        seg.title = s[0] + ': ' + n;
        bar.appendChild(seg);
      });
      stats.appendChild(bar);
      var fertig = alle.filter(function (e) { return e.status === 'Erledigt'; }).length;
      stats.appendChild(el('span', null, Math.round(100 * fertig / alle.length) + ' % erledigt'));
      head.appendChild(stats);
    }
    col.appendChild(head);

    var body = el('div', 'rm-col__body');
    sichtbar.forEach(function (e) { body.appendChild(renderKarte(e)); });
    if (!sichtbar.length) {
      body.appendChild(el('div', 'rm-col__empty', alle.length ? 'Keine Punkte für diesen Filter' : 'Punkte hierher ziehen'));
    }
    col.appendChild(body);

    col.addEventListener('dragover', function (ev) {
      if (dragNr == null) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      col.classList.add('is-over');
    });
    col.addEventListener('dragleave', function (ev) {
      if (!col.contains(ev.relatedTarget)) col.classList.remove('is-over');
    });
    col.addEventListener('drop', function (ev) {
      ev.preventDefault();
      col.classList.remove('is-over');
      var nr = +(ev.dataTransfer.getData('text/plain') || dragNr);
      dragNr = null;
      if (nr) zuordnen(nr, name);
    });
    return col;
  }

  function renderKarte(e) {
    var c = el('article', 'rm-card rm-card--' + slug(e.prio) +
      (e.status === 'Erledigt' ? ' rm-card--erledigt' : '') + (e._speichert ? ' is-saving' : ''));
    c.draggable = true;
    c.dataset.nr = e.nr;

    var top = el('div', 'rm-card__top');
    top.appendChild(el('span', 'rm-card__nr', '#' + e.nr));
    top.appendChild(el('span', 'rm-card__thema', e.thema || '(ohne Thema)'));
    c.appendChild(top);
    if (e.todo) c.appendChild(el('p', 'rm-card__todo', e.todo));

    var meta = el('div', 'rm-card__meta');
    var prio = el('span', 'chip');
    prio.appendChild(el('span', 'chip__dot dot--' + slug(e.prio)));
    prio.appendChild(el('span', null, e.prio));
    meta.appendChild(prio);
    meta.appendChild(el('span', 'chip chip--status-' + slug(e.status), e.status));
    if (e.baugruppe) meta.appendChild(el('span', 'chip', '📍 ' + e.baugruppe));
    if (e.verantwortlicher) meta.appendChild(el('span', 'chip', '👤 ' + e.verantwortlicher));

    // Alternative zu Drag & Drop (Touch-Geraete, Tastatur)
    var sel = el('select', 'rm-card__move');
    sel.title = 'Release zuordnen';
    sel.setAttribute('aria-label', 'Release für Punkt ' + e.nr);
    sel.appendChild(new Option('– nicht eingeplant', ''));
    spalten().forEach(function (r) { sel.appendChild(new Option(r.name, r.name)); });
    sel.value = e.release || '';
    sel.addEventListener('change', function () { zuordnen(e.nr, sel.value); });
    meta.appendChild(sel);
    c.appendChild(meta);

    c.addEventListener('dragstart', function (ev) {
      if (ev.target.closest && ev.target.closest('select')) { ev.preventDefault(); return; }
      dragNr = e.nr;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(e.nr));
      c.classList.add('is-dragging');
    });
    c.addEventListener('dragend', function () {
      dragNr = null;
      c.classList.remove('is-dragging');
      Array.prototype.forEach.call(document.querySelectorAll('.rm-col.is-over'), function (x) { x.classList.remove('is-over'); });
    });
    return c;
  }

  /* ------------------------------------------------------------ Release-Dialog */

  function oeffneRelease(r) {
    bearbeitetesRelease = r && !r.fehlt ? r.name : null;
    var vorschlag = '';
    if (!r) {
      var letzte = spalten().map(function (x) { return x.name; }).pop() || '4.0.0';
      var p = letzte.split('.').map(Number);
      vorschlag = p[0] + '.' + p[1] + '.' + (p[2] + 1);
    }
    $('#dlgReleaseTitle').textContent = r ? 'Release ' + r.name : 'Neues Release';
    $('#rlName').value = r ? r.name : vorschlag;
    $('#rlName').readOnly = !!r;
    $('#rlStatus').value = r && r.status ? r.status : 'Geplant';
    $('#rlZiel').value = r ? r.ziel || '' : '';
    $('#rlBeschreibung').value = r ? r.beschreibung || '' : '';
    $('#btnReleaseDelete').hidden = !r;
    $('#dlgRelease').showModal();
  }

  /* ------------------------------------------------------------ Export */

  function releaseNotes() {
    var zeilen = ['# Roadmap 4NE1 Gen4', ''];
    spalten().forEach(function (r) {
      var punkte = state.entries.filter(function (e) { return e.release === r.name; }).sort(sortierung);
      zeilen.push('## ' + r.name + ' – ' + (r.status || 'Geplant') + (r.ziel ? ' (Ziel ' + ddmmyyyy(r.ziel) + ')' : ''));
      if (r.beschreibung) zeilen.push('', r.beschreibung);
      zeilen.push('');
      if (!punkte.length) zeilen.push('_keine Punkte_');
      punkte.forEach(function (e) {
        zeilen.push('- [' + (e.status === 'Erledigt' ? 'x' : ' ') + '] #' + e.nr + ' ' + (e.thema || '') +
          ' (' + e.prio + (e.baugruppe ? ', ' + e.baugruppe : '') + ') – ' + (e.todo || '').replace(/\s*\n\s*/g, ' '));
      });
      zeilen.push('');
    });
    return zeilen.join('\n');
  }

  function kopieren(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = el('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('Kopieren nicht möglich'));
  }

  function csvExport() {
    var feld = function (v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var kopf = ['Release', 'Nr', 'Bereich', 'Baugruppe', 'Thema', 'Prio', 'Status', 'Verantwortlicher', 'Bis wann', 'To Do'];
    var reihen = state.entries.slice().sort(function (a, b) {
      if (!a.release !== !b.release) return a.release ? -1 : 1;
      return (a.release && b.release ? versionVergleich(a.release, b.release) : 0) || sortierung(a, b);
    }).map(function (e) {
      return [e.release || 'nicht eingeplant', e.nr, e.bereich, e.baugruppe, e.thema, e.prio, e.status,
        e.verantwortlicher, ddmmyyyy(e.faellig), e.todo].map(feld).join(';');
    });
    var blob = new Blob(['﻿' + [kopf.join(';')].concat(reihen).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Roadmap_4NE1_Gen4_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ------------------------------------------------------------ Init */

  function optionen(sel, werte) {
    werte.forEach(function (w) { sel.appendChild(new Option(w, w)); });
  }

  function initUi() {
    optionen($('#fBereich'), BEREICHE);
    optionen($('#fBaugruppe'), BAUGRUPPEN);
    optionen($('#fPrio'), PRIOS);
    optionen($('#fTeam'), TEAMS);
    ['#suche', '#fBereich', '#fBaugruppe', '#fPrio', '#fTeam', '#fErledigt'].forEach(function (s) {
      $(s).addEventListener(s === '#suche' ? 'input' : 'change', render);
    });
    $('#btnFilterReset').addEventListener('click', function () {
      $('#suche').value = '';
      ['#fBereich', '#fBaugruppe', '#fPrio', '#fTeam'].forEach(function (s) { $(s).value = ''; });
      $('#fErledigt').checked = true;
      render();
    });

    $('#btnRelease').addEventListener('click', function () { oeffneRelease(null); });

    var form = $('#formRelease');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var daten = {
        name: $('#rlName').value.trim(),
        status: $('#rlStatus').value,
        ziel: $('#rlZiel').value,
        beschreibung: $('#rlBeschreibung').value.trim()
      };
      if (!bearbeitetesRelease && state.releases.some(function (r) { return r.name === daten.name; })) {
        toast('Release ' + daten.name + ' gibt es schon.', true);
        return;
      }
      releaseSpeichern(daten).then(function () {
        $('#dlgRelease').close();
        toast('Release ' + daten.name + ' gespeichert.');
      }).catch(function (err) { toast('Speichern fehlgeschlagen: ' + err.message, true); });
    });
    $('#btnReleaseDelete').addEventListener('click', function () {
      var name = $('#rlName').value;
      var n = state.entries.filter(function (e) { return e.release === name; }).length;
      if (!confirm('Release ' + name + ' löschen?' + (n ? '\n' + n + ' Punkte werden wieder „nicht eingeplant“.' : ''))) return;
      releaseLoeschen(name).then(function () {
        $('#dlgRelease').close();
        toast('Release ' + name + ' gelöscht.');
      }).catch(function (err) { toast('Löschen fehlgeschlagen: ' + err.message, true); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });

    var panel = $('#menuPanel');
    $('#btnMenu').addEventListener('click', function (ev) {
      ev.stopPropagation();
      panel.hidden = !panel.hidden;
      $('#btnMenu').setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', function () { panel.hidden = true; $('#btnMenu').setAttribute('aria-expanded', 'false'); });
    panel.addEventListener('click', function (ev) {
      var act = ev.target.dataset && ev.target.dataset.act;
      if (act === 'notes') {
        kopieren(releaseNotes()).then(function () { toast('Release-Notes in die Zwischenablage kopiert.'); })
          .catch(function (err) { toast(err.message, true); });
      } else if (act === 'csv') csvExport();
    });

    var dark = $('#btnDark');
    function istDunkel() {
      var t = document.documentElement.getAttribute('data-theme');
      return t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    dark.textContent = istDunkel() ? '☀' : '☾';
    dark.addEventListener('click', function () {
      var next = istDunkel() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('opl.theme', next); } catch (e) {}
      dark.textContent = istDunkel() ? '☀' : '☾';
    });
  }

  function demoStarten() {
    state.modus = 'demo';
    demoLaden();
    banner('Demo-Modus: keine Verbindung zur OPL. Angezeigt werden die Startdaten; Zuordnungen bleiben nur in diesem Browser.');
    render();
  }

  function start() {
    initUi();
    // Ohne Server (file://, statisches Hosting ohne Worker) → Demo-Modus
    fetch('/api/auth').then(function (r) {
      var typ = r.headers.get('content-type') || '';
      if (r.status === 401) {
        state.modus = 'gesperrt';
        banner('Nicht angemeldet – bitte zuerst <a href="./">in der OPL anmelden</a> und diese Seite dann neu laden.');
        $('#btnRelease').disabled = true;
        return;
      }
      if (!r.ok || typ.indexOf('application/json') < 0) return demoStarten();
      return r.json().then(function (auth) {
        state.user = auth.user || '';
        state.modus = 'server';
        return ladeServer().then(function () {
          render();
          setInterval(poll, POLL_MS);
          document.addEventListener('visibilitychange', poll);
        }, function (err) {
          banner('OPL-Daten konnten nicht geladen werden (' + err.message + '). Bitte Seite neu laden.');
        });
      });
    }, demoStarten);
  }

  start();
})();
