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

  var SEITEN = ['Links', 'Rechts', 'Beidseitig'];
  var PAARIG = ['Arm', 'Bein', 'Fuß'];

  // Koerperzonen auf assets/img/4ne1-gen4-front.png (550 × 881 px, Frontansicht):
  // die rechte Seite des Roboters liegt im Bild links.
  var ZONEN = [
    { key: 'Kopf', bg: 'Kopf', seite: '', label: 'Kopf', at: [288, 112], form: '<ellipse cx="288" cy="112" rx="48" ry="64"/>' },
    { key: 'Torso', bg: 'Torso', seite: '', label: 'Torso', at: [288, 300], form: '<rect x="203" y="178" width="170" height="222" rx="34"/>' },
    { key: 'Arm|Rechts', bg: 'Arm', seite: 'Rechts', label: 'Arm rechts', at: [160, 330], form: '<polygon points="196,196 224,244 172,462 112,452 146,226"/>' },
    { key: 'Arm|Links', bg: 'Arm', seite: 'Links', label: 'Arm links', at: [416, 330], form: '<polygon points="380,196 352,244 404,462 464,452 430,226"/>' },
    { key: 'Pelvis/Hüfte', bg: 'Pelvis/Hüfte', seite: '', label: 'Pelvis/Hüfte', at: [288, 452], form: '<rect x="198" y="404" width="180" height="108" rx="26"/>' },
    { key: 'Bein|Rechts', bg: 'Bein', seite: 'Rechts', label: 'Bein rechts', at: [238, 640], form: '<rect x="196" y="516" width="86" height="262" rx="30"/>' },
    { key: 'Bein|Links', bg: 'Bein', seite: 'Links', label: 'Bein links', at: [338, 640], form: '<rect x="294" y="516" width="86" height="262" rx="30"/>' },
    { key: 'Fuß|Rechts', bg: 'Fuß', seite: 'Rechts', label: 'Fuß rechts', at: [238, 808], form: '<rect x="200" y="782" width="78" height="56" rx="22"/>' },
    { key: 'Fuß|Links', bg: 'Fuß', seite: 'Links', label: 'Fuß links', at: [338, 808], form: '<rect x="298" y="782" width="78" height="56" rx="22"/>' }
  ];
  var ZONEN_EXTRA = [
    { key: 'Übergreifend', bg: 'Übergreifend', seite: '', label: 'Übergreifend' },
    { key: '(ohne)', bg: '', seite: '', label: 'Ohne Baugruppe' }
  ];

  var state = { entries: [], releases: [], user: '', modus: 'laden', stand: null,
    ansicht: 'board', zone: null, koerperRelease: '*' };
  var dragNr = null;
  var bearbeitetesRelease = null;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function punkte(n) { return n + (n === 1 ? ' Punkt' : ' Punkte'); }
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
    var seiten = gespeichert.seiten || {};
    state.releases = gespeichert.releases || STANDARD_RELEASES.map(function (n) {
      return { name: n, ziel: '', status: 'Geplant', beschreibung: '' };
    });
    state.entries = (window.OPL_SEED || []).map(function (e) {
      return Object.assign({}, e, { release: zuordnung[e.nr] || '', seite: seiten[e.nr] || '' });
    });
  }

  function demoSpeichern() {
    var zuordnung = {}, seiten = {};
    state.entries.forEach(function (e) {
      if (e.release) zuordnung[e.nr] = e.release;
      if (e.seite) seiten[e.nr] = e.seite;
    });
    try { localStorage.setItem(DEMO_KEY, JSON.stringify({ releases: state.releases, zuordnung: zuordnung, seiten: seiten })); } catch (e) {}
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
    aendern(nr, 'release', release, release ? 'Release ' + release : 'nicht eingeplant');
  }

  function aendern(nr, feld, wert, meldung) {
    var e = byNr(nr);
    if (!e || (e[feld] || '') === wert) return;
    var vorher = e[feld] || '';
    e[feld] = wert;
    e._speichert = true;
    render();

    if (state.modus === 'demo') {
      delete e._speichert;
      demoSpeichern();
      render();
      toast('#' + nr + ' → ' + meldung);
      return;
    }
    var patch = { user: state.user };
    patch[feld] = wert;
    api('PUT', '/api/entries/' + nr, patch).then(function (neu) {
      var i = state.entries.indexOf(e);
      if (i >= 0) state.entries[i] = neu;
      render();
      toast('#' + nr + ' → ' + meldung);
    }).catch(function (err) {
      e[feld] = vorher;
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
      erledigt: $('#fErledigt').checked,
      zone: state.ansicht === 'board' ? state.zone : null
    };
  }

  function passt(e, f) {
    if (f.bereich && e.bereich !== f.bereich) return false;
    if (f.baugruppe && e.baugruppe !== f.baugruppe) return false;
    if (f.prio && e.prio !== f.prio) return false;
    if (f.team && e.verantwortlichkeit !== f.team) return false;
    if (!f.erledigt && e.status === 'Erledigt') return false;
    if (f.zone && !inZone(e, f.zone)) return false;
    if (f.q) {
      var text = ['#' + e.nr, e.thema, e.todo, e.verantwortlicher, e.bereich, e.baugruppe, e.seite].join(' ').toLowerCase();
      if (text.indexOf(f.q) < 0) return false;
    }
    return true;
  }

  function filterAktiv(f) {
    return !!(f.q || f.bereich || f.baugruppe || f.prio || f.team || !f.erledigt || f.zone);
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

    var zone = state.zone && zoneNach(state.zone);
    $('#btnZone').hidden = !(zone && state.ansicht === 'board');
    if (zone) $('#btnZone').textContent = '📍 ' + zone.label + ' ✕';
    $('#board').hidden = $('#boardHint').hidden = state.ansicht !== 'board';
    $('#koerper').hidden = state.ansicht !== 'koerper';

    if (state.ansicht === 'koerper') {
      renderKoerper(f);
    } else {
      var board = $('#board');
      board.innerHTML = '';
      board.appendChild(renderSpalte(null, f));
      spalten().forEach(function (r) { board.appendChild(renderSpalte(r, f)); });
    }

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
    sub.push(punkte(alle.length) + ' · ' + offen + ' offen');
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
    if (e.baugruppe) meta.appendChild(el('span', 'chip', '📍 ' + e.baugruppe + (e.seite ? ' · ' + e.seite : '')));
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

  /* ------------------------------------------------------------ Koerperansicht */

  function ansicht(name) {
    state.ansicht = name;
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) {
      b.classList.toggle('is-active', b.dataset.view === name);
    });
    render();
  }

  function zoneNach(key) {
    return ZONEN.concat(ZONEN_EXTRA).filter(function (z) { return z.key === key; })[0] || null;
  }

  // Punkte ohne Seite (oder beidseitig) gehoeren zu beiden Seiten einer paarigen Baugruppe
  function inZone(e, key) {
    var z = zoneNach(key);
    if (!z) return true;
    if ((e.baugruppe || '') !== z.bg) return false;
    return !z.seite || !e.seite || e.seite === 'Beidseitig' || e.seite === z.seite;
  }

  function releasePasst(e) {
    return state.koerperRelease === '*' || (e.release || '') === state.koerperRelease;
  }

  function zonenWerte(z, f) {
    var punkte = state.entries.filter(function (e) { return passt(e, f) && releasePasst(e) && inZone(e, z.key); });
    return {
      punkte: punkte,
      hoch: punkte.filter(function (e) { return e.prio === 'Hoch' && e.status !== 'Erledigt'; }).length
    };
  }

  function renderKoerper(f) {
    // Release-Auswahl
    var sel = $('#relSel');
    sel.innerHTML = '';
    [['*', 'Alle']].concat([['', 'Nicht eingeplant']], spalten().map(function (r) { return [r.name, r.name]; }))
      .forEach(function (o) {
        var b = el('button', state.koerperRelease === o[0] ? 'is-active' : '', o[1]);
        b.type = 'button';
        b.addEventListener('click', function () { state.koerperRelease = o[0]; render(); });
        sel.appendChild(b);
      });

    var werte = {};
    var max = 1;
    ZONEN.concat(ZONEN_EXTRA).forEach(function (z) {
      werte[z.key] = zonenWerte(z, f);
      max = Math.max(max, werte[z.key].punkte.length);
    });

    // Zonen als SVG ueber dem Bild
    var svg = '<text x="150" y="168" class="rm-side">R</text><text x="426" y="168" class="rm-side">L</text>';
    ZONEN.forEach(function (z) {
      var w = werte[z.key], n = w.punkte.length;
      var deckung = n ? (0.14 + 0.46 * n / max).toFixed(2) : 0;
      svg += '<g class="rm-zone' + (n ? '' : ' is-leer') + (state.zone === z.key ? ' is-sel' : '') +
        '" data-zone="' + z.key + '" tabindex="0" role="button" aria-label="' + z.label + ': ' + punkte(n) + '">' +
        '<title>' + z.label + ': ' + punkte(n) + (w.hoch ? ', ' + w.hoch + '× Prio hoch offen' : '') + '</title>' +
        z.form.replace('/>', ' class="rm-zone__form" style="fill-opacity:' + deckung + '"/>') +
        (n ? '<circle cx="' + z.at[0] + '" cy="' + z.at[1] + '" r="17" class="rm-zone__badge' + (w.hoch ? ' is-hoch' : '') + '"/>' +
          '<text x="' + z.at[0] + '" y="' + (z.at[1] + 5) + '" class="rm-zone__count">' + n + '</text>' : '') +
        '</g>';
    });
    var fig = $('#figSvg');
    fig.innerHTML = svg;
    Array.prototype.forEach.call(fig.querySelectorAll('.rm-zone'), function (g) {
      var waehle = function () { state.zone = state.zone === g.dataset.zone ? null : g.dataset.zone; render(); };
      g.addEventListener('click', waehle);
      g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); waehle(); } });
    });

    var extra = $('#figExtra');
    extra.innerHTML = '';
    ZONEN_EXTRA.forEach(function (z) {
      var w = werte[z.key];
      var b = el('button', 'chip' + (state.zone === z.key ? ' is-sel' : '') + (w.hoch ? ' chip--warn' : ''), z.label + ': ' + w.punkte.length);
      b.type = 'button';
      b.addEventListener('click', function () { state.zone = state.zone === z.key ? null : z.key; render(); });
      extra.appendChild(b);
    });

    renderZonenPanel(f, werte);
  }

  function renderZonenPanel(f, werte) {
    var panel = $('#zoneDetail');
    panel.innerHTML = '';
    var z = state.zone && zoneNach(state.zone);

    if (!z) {
      // Uebersicht: Zone × Release
      panel.appendChild(el('h2', null, 'Wo ändert sich was?'));
      panel.appendChild(el('p', 'rm-col__sub', 'Punkte je Körperzone und Release (Filter oben gelten). Zone im Bild oder in der Tabelle anklicken.'));
      var rel = spalten();
      var tab = el('table', 'rm-matrix');
      var kopf = el('tr');
      kopf.appendChild(el('th', null, 'Zone'));
      kopf.appendChild(el('th', null, '–'));
      rel.forEach(function (r) { kopf.appendChild(el('th', null, r.name)); });
      kopf.appendChild(el('th', null, 'Σ'));
      tab.appendChild(kopf);
      ZONEN.concat(ZONEN_EXTRA).forEach(function (zz) {
        var tr = el('tr');
        var th = el('th');
        var link = el('button', 'rm-link', zz.label);
        link.type = 'button';
        link.addEventListener('click', function () { state.zone = zz.key; render(); });
        th.appendChild(link);
        tr.appendChild(th);
        var punkte = state.entries.filter(function (e) { return passt(e, f) && inZone(e, zz.key); });
        [''].concat(rel.map(function (r) { return r.name; })).forEach(function (name) {
          var n = punkte.filter(function (e) { return (e.release || '') === name; }).length;
          var td = el('td', n ? 'has-n' : '', n ? String(n) : '·');
          if (n) {
            td.title = zz.label + ' · ' + (name ? 'Release ' + name : 'nicht eingeplant');
            td.addEventListener('click', function () { state.zone = zz.key; state.koerperRelease = name; render(); });
          }
          tr.appendChild(td);
        });
        tr.appendChild(el('td', 'rm-matrix__sum', String(punkte.length)));
        tab.appendChild(tr);
      });
      panel.appendChild(tab);
      return;
    }

    var w = werte[z.key];
    var head = el('div', 'rm-panel__head');
    head.appendChild(el('h2', null, z.label));
    var zuBoard = el('button', 'btn', 'Im Board zeigen');
    zuBoard.type = 'button';
    zuBoard.addEventListener('click', function () { ansicht('board'); });
    head.appendChild(zuBoard);
    var zu = el('button', 'card__edit', '✕');
    zu.type = 'button';
    zu.title = 'Zur Übersicht';
    zu.addEventListener('click', function () { state.zone = null; render(); });
    head.appendChild(zu);
    panel.appendChild(head);
    panel.appendChild(el('p', 'rm-col__sub', punkte(w.punkte.length) + ' · ' +
      (state.koerperRelease === '*' ? 'alle Releases' : state.koerperRelease ? 'Release ' + state.koerperRelease : 'nicht eingeplant') +
      (z.seite ? ' · inkl. Punkte ohne Seite' : '')));

    var liste = el('div', 'rm-panel__list');
    w.punkte.slice().sort(sortierung).forEach(function (e) {
      var k = renderKarte(e);
      k.draggable = false;
      if (PAARIG.indexOf(e.baugruppe) >= 0) {
        var s = el('select', 'rm-card__move');
        s.title = 'Seite (aus Sicht des Roboters)';
        s.setAttribute('aria-label', 'Seite für Punkt ' + e.nr);
        s.appendChild(new Option('Seite offen', ''));
        SEITEN.forEach(function (v) { s.appendChild(new Option(v, v)); });
        s.value = e.seite || '';
        s.addEventListener('change', function () { aendern(e.nr, 'seite', s.value, s.value ? 'Seite ' + s.value : 'Seite offen'); });
        k.querySelector('.rm-card__meta').insertBefore(s, k.querySelector('.rm-card__meta select'));
      }
      liste.appendChild(k);
    });
    if (!w.punkte.length) liste.appendChild(el('div', 'rm-col__empty', 'Keine Punkte in dieser Auswahl'));
    panel.appendChild(liste);
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
      state.zone = null;
      render();
    });
    $('#btnZone').addEventListener('click', function () { state.zone = null; render(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) {
      b.addEventListener('click', function () { ansicht(b.dataset.view); });
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
