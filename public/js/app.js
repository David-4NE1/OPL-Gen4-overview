/*
 * app.js – Oberfläche des OPL-Tools.
 */
(function () {
  'use strict';

  var Store = window.OPLStore;
  var Xlsx = window.OPLXlsx;
  var I18N = window.OPLi18n;
  var T = I18N.T;
  var EN = I18N.isEn();

  var view = 'karten';
  var sort = { feld: 'nr', richtung: 1 };
  var quick = null;                 // KPI-Schnellfilter
  var zugeklappt = {};              // Bereich -> true, wenn eingeklappt
  var erledigtOffen = false;
  var importPuffer = null;

  var filter = { suche: '', bereich: '', thema: '', prio: '', status: '', verant: '', team: '', baugruppe: '' };

  var PRIO_RANK = { 'Hoch': 0, 'Mittel': 1, 'Niedrig': 2 };
  var STATUS_RANK = { 'Offen': 0, 'In Arbeit': 1, 'Erledigt': 2 };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------------------------- Maschinelle Uebersetzung (EN) */

  // Karteninhalte (Thema, To Do, Notiz) bleiben auf Deutsch gespeichert. Im
  // englischen Modus werden sie ueber /api/translate (Cloudflare Workers AI,
  // serverseitig in D1 zwischengespeichert) uebersetzt und markiert.
  var TR = {};
  var TR_CACHE_KEY = 'opl.tr.en.v1';
  var trOffen = {};
  var trLaeuft = false;
  var trFehler = false;
  var trFehlerSeit = 0;

  if (EN) {
    try { TR = JSON.parse(localStorage.getItem(TR_CACHE_KEY) || '{}') || {}; } catch (e) { TR = {}; }
  }

  function tx(text) {
    if (!EN || !text) return text;
    if (TR[text] != null) return TR[text];
    trOffen[text] = true;
    return text;
  }

  function istUebersetzt(e) {
    return EN && [e.thema, e.todo, e.notiz].some(function (v) {
      return v && TR[v] != null && TR[v] !== v;
    });
  }

  function original(node, text) {
    if (EN && text && TR[text] != null && TR[text] !== text) {
      node.title = T('Original (Deutsch): {text}', { text: text });
    }
    return node;
  }

  function trCacheSpeichern() {
    var keys = Object.keys(TR);
    if (keys.length > 2000) {
      keys.slice(0, keys.length - 2000).forEach(function (k) { delete TR[k]; });
    }
    try { localStorage.setItem(TR_CACHE_KEY, JSON.stringify(TR)); } catch (e) { /* voll */ }
  }

  function trBanner() {
    var b = $('#trBanner');
    if (!b) return;
    if (!EN) { b.hidden = true; return; }
    b.className = 'tr-banner' + (trFehler ? ' tr-banner--warn' : '');
    if (trFehler) {
      b.textContent = T('⚠ Automatische Übersetzung derzeit nicht verfügbar – Karteninhalte werden auf Deutsch angezeigt.');
    } else if (trLaeuft || Object.keys(trOffen).length) {
      b.textContent = T('🌐 Karteninhalte werden übersetzt …');
    } else {
      b.textContent = T('🌐 Karteninhalte wurden maschinell aus dem Deutschen übersetzt (Cloudflare Workers AI) und können ungenau sein. Gespeichert wird auf Deutsch – der Bearbeiten-Dialog zeigt den Originaltext.');
    }
    b.hidden = false;
  }

  function trNachladen() {
    if (!EN || trLaeuft) return;
    // Nach einem Fehler erst nach 5 Minuten erneut versuchen
    if (trFehler && Date.now() - trFehlerSeit < 300000) { trBanner(); return; }
    var texte = Object.keys(trOffen).slice(0, 25);
    if (!texte.length) { trBanner(); return; }
    trLaeuft = true;
    trBanner();
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: texte, target: 'en' })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      var neu = res.translations || [];
      var treffer = 0;
      texte.forEach(function (src, i) {
        delete trOffen[src];
        if (typeof neu[i] === 'string' && neu[i]) { TR[src] = neu[i]; treffer++; }
      });
      if (!treffer && texte.length) throw new Error('keine Uebersetzung erhalten');
      trFehler = false;
      trCacheSpeichern();
    }).catch(function (err) {
      console.warn('Uebersetzung fehlgeschlagen:', err.message);
      trFehler = true;
      trFehlerSeit = Date.now();
      trOffen = {};
    }).then(function () {
      trLaeuft = false;
      render();
    });
  }

  /* ------------------------------------------------------------ Helfer */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' toast--error' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, isError ? 7000 : 3200);
  }

  function tageBis(iso) {
    if (!iso) return null;
    var a = new Date(Store.heute() + 'T00:00:00');
    var b = new Date(iso + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function datumLabel(iso) {
    if (!iso) return T('kein Datum');
    var d = tageBis(iso);
    var txt = Xlsx.ddmmyyyy(iso);
    if (d === 0) return T('{datum} · heute', { datum: txt });
    if (d < 0) return T('{datum} · {n} T überfällig', { datum: txt, n: Math.abs(d) });
    if (d <= 7) return T('{datum} · in {n} T', { datum: txt, n: d });
    return txt;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function dateiStempel() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ------------------------------------------------------- Filter/Sort */

  function sichtbar(e) {
    if (filter.bereich && e.bereich !== filter.bereich) return false;
    if (filter.thema === '(offen)' ? Store.istThema(e.thema) : (filter.thema && e.thema !== filter.thema)) return false;
    if (filter.prio && e.prio !== filter.prio) return false;
    if (filter.status && e.status !== filter.status) return false;
    if (filter.verant) {
      var v = e.verantwortlicher || '(offen)';
      if (v !== filter.verant) return false;
    }
    if (filter.team && (e.verantwortlichkeit || '(offen)') !== filter.team) return false;
    if (filter.baugruppe && (e.baugruppe || '(offen)') !== filter.baugruppe) return false;
    if (quick === 'offen' && e.status === 'Erledigt') return false;
    if (quick === 'erledigt' && e.status !== 'Erledigt') return false;
    if (quick === 'hoch' && !(e.prio === 'Hoch' && e.status !== 'Erledigt')) return false;
    if (quick === 'mittel' && !(e.prio === 'Mittel' && e.status !== 'Erledigt')) return false;
    if (quick === 'niedrig' && !(e.prio === 'Niedrig' && e.status !== 'Erledigt')) return false;
    if (quick === 'ueberfaellig' && !Store.istUeberfaellig(e)) return false;
    if (filter.suche) {
      var hay = [e.nr, e.thema, e.todo, e.verantwortlicher, e.verantwortlichkeit, e.baugruppe, e.bereich, e.notiz,
        TR[e.thema], TR[e.todo], TR[e.notiz], T(e.bereich), T(e.status), T(e.prio)]
        .join(' ').toLowerCase();
      if (hay.indexOf(filter.suche) < 0) return false;
    }
    return true;
  }

  function filterAktiv() {
    return !!(filter.suche || filter.bereich || filter.thema || filter.prio || filter.status || filter.verant || filter.team || filter.baugruppe || quick);
  }

  function sortiereKarten(a, b) {
    var pa = PRIO_RANK[a.prio], pb = PRIO_RANK[b.prio];
    if (pa !== pb) return pa - pb;
    // ohne Datum ans Ende
    var da = a.faellig || '9999-99-99', db = b.faellig || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return a.nr - b.nr;
  }

  function sortiereTabelle(a, b) {
    var f = sort.feld, va, vb;
    if (f === 'prio') { va = PRIO_RANK[a.prio]; vb = PRIO_RANK[b.prio]; }
    else if (f === 'status') { va = STATUS_RANK[a.status]; vb = STATUS_RANK[b.status]; }
    else if (f === 'nr') { va = a.nr; vb = b.nr; }
    else if (f === 'faellig') { va = a.faellig || '9999-99-99'; vb = b.faellig || '9999-99-99'; }
    else { va = String(a[f] || '').toLowerCase(); vb = String(b[f] || '').toLowerCase(); }
    if (va < vb) return -1 * sort.richtung;
    if (va > vb) return 1 * sort.richtung;
    return a.nr - b.nr;
  }

  /* ------------------------------------------------------------ Render */

  function render() {
    renderInhalt();
    if (EN) { trBanner(); trNachladen(); }
  }

  function renderInhalt() {
    var alle = Store.state.entries;
    renderKpis(alle);
    fuelleThemaFilter(alle);
    fuelleVerantFilter(alle);
    var istAktiv = filterAktiv();
    $('#btnFilterReset').hidden = !istAktiv;

    var liste = alle.filter(sichtbar);

    var banner = $('#filterBanner');
    if (istAktiv) {
      var teile = [];
      if (quick) {
        var ql = { offen: 'Offen', erledigt: 'Erledigt', hoch: 'Prio Hoch', mittel: 'Prio Mittel', niedrig: 'Prio Niedrig', ueberfaellig: 'Überfällig' };
        teile.push(T(ql[quick] || quick));
      }
      if (filter.bereich) teile.push(T('Bereich: {v}', { v: T(filter.bereich) }));
      if (filter.thema) teile.push(T('Thema: {v}', { v: filter.thema === '(offen)' ? T('(nicht zugeordnet)') : T(filter.thema) }));
      if (filter.prio) teile.push(T('Prio: {v}', { v: T(filter.prio) }));
      if (filter.status) teile.push(T('Status: {v}', { v: T(filter.status) }));
      if (filter.verant) teile.push(T('Verantwortlich: {v}', { v: T(filter.verant) }));
      if (filter.team) teile.push(T('Verantwortlichkeit: {v}', { v: T(filter.team) }));
      if (filter.baugruppe) teile.push(T('Baugruppe: {v}', { v: T(filter.baugruppe) }));
      if (filter.suche) teile.push(T('Suche: "{v}"', { v: filter.suche }));
      $('#filterBannerText').textContent = T('Zeige {n} von {gesamt} Punkten — {teile}',
        { n: liste.length, gesamt: alle.length, teile: teile.join(', ') });
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    var content = $('#content');
    content.textContent = '';

    if (!liste.length) {
      var leer = el('div', 'empty');
      leer.appendChild(el('p', null, alle.length
        ? T('Keine Punkte passen zu Filter und Suche.')
        : T('Noch keine Punkte – lege den ersten an oder importiere eine Excel.')));
      content.appendChild(leer);
      return;
    }

    if (view === 'tabelle') { content.appendChild(renderTabelle(liste)); return; }

    var offeneListe = liste.filter(function (e) { return e.status !== 'Erledigt'; });
    var erledigt = liste.filter(function (e) { return e.status === 'Erledigt'; });

    var gruppen = {};
    offeneListe.forEach(function (e) { (gruppen[e.bereich] = gruppen[e.bereich] || []).push(e); });

    Store.BEREICHE.forEach(function (bereich) {
      if (!gruppen[bereich]) return;
      content.appendChild(renderGruppe(bereich, gruppen[bereich].sort(sortiereKarten), false));
    });
    // Bereiche, die nicht in der Standardliste stehen (z. B. aus Alt-Import)
    Object.keys(gruppen).forEach(function (bereich) {
      if (Store.BEREICHE.indexOf(bereich) >= 0) return;
      content.appendChild(renderGruppe(bereich, gruppen[bereich].sort(sortiereKarten), false));
    });

    if (erledigt.length) {
      content.appendChild(renderGruppe('Erledigt', erledigt.sort(sortiereKarten), true));
    }
  }

  function renderGruppe(titel, eintraege, istErledigtGruppe) {
    var offen = istErledigtGruppe ? erledigtOffen : !zugeklappt[titel];
    var g = el('section', 'group' + (offen ? ' is-open' : ''));

    var head = el('button', 'group__head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(offen));
    head.appendChild(el('span', 'group__chev', '▶'));
    head.appendChild(el('h2', null, istErledigtGruppe ? T('✓ Erledigt') : T(titel)));

    if (!istErledigtGruppe) {
      ['Hoch', 'Mittel', 'Niedrig'].forEach(function (p) {
        var n = eintraege.filter(function (e) { return e.prio === p; }).length;
        if (n) head.appendChild(el('span', 'pill pill--' + slug(p), n + '×' + T(p)[0]));
      });
      var ueber = eintraege.filter(Store.istUeberfaellig).length;
      if (ueber) head.appendChild(el('span', 'pill pill--hoch', T('⚠ {n} überfällig', { n: ueber })));

      var alleImBereich = Store.state.entries.filter(function (e) { return e.bereich === titel; });
      var total = alleImBereich.length;
      if (total) {
        var nErl = alleImBereich.filter(function (e) { return e.status === 'Erledigt'; }).length;
        var nArb = alleImBereich.filter(function (e) { return e.status === 'In Arbeit'; }).length;
        var nOff = total - nErl - nArb;
        var bar = el('span', 'progress');
        var s1 = el('span', 'progress__seg progress__seg--erledigt');
        s1.style.width = (nErl / total * 100) + '%';
        var s2 = el('span', 'progress__seg progress__seg--arbeit');
        s2.style.width = (nArb / total * 100) + '%';
        var s3 = el('span', 'progress__seg progress__seg--offen');
        s3.style.width = (nOff / total * 100) + '%';
        bar.appendChild(s1); bar.appendChild(s2); bar.appendChild(s3);
        bar.title = T('{a} erledigt, {b} in Arbeit, {c} offen', { a: nErl, b: nArb, c: nOff });
        head.appendChild(bar);
      }
    }
    head.appendChild(el('span', 'group__count', eintraege.length === 1 ? T('1 Punkt') : T('{n} Punkte', { n: eintraege.length })));

    head.addEventListener('click', function () {
      if (istErledigtGruppe) erledigtOffen = !erledigtOffen;
      else zugeklappt[titel] = !zugeklappt[titel];
      render();
    });
    g.appendChild(head);

    var body = el('div', 'group__body');
    var cards = el('div', 'cards');
    eintraege.forEach(function (e) { cards.appendChild(renderCard(e)); });
    body.appendChild(cards);
    g.appendChild(body);
    return g;
  }

  function renderCard(e) {
    var c = el('article', 'card card--' + slug(e.prio) + (e.status === 'Erledigt' ? ' card--erledigt' : ''));

    var top = el('div', 'card__top');
    top.appendChild(el('span', 'card__nr', '#' + e.nr));
    top.appendChild(el('span', 'card__thema', e.thema ? (Store.istThema(e.thema) ? T(e.thema) : tx(e.thema)) : T('(ohne Thema)')));
    var edit = el('button', 'card__edit', '✎');
    edit.type = 'button';
    edit.title = T('Bearbeiten');
    edit.setAttribute('aria-label', T('Punkt {nr} bearbeiten', { nr: e.nr }));
    edit.addEventListener('click', function () { oeffneEdit(e.nr); });
    top.appendChild(edit);
    c.appendChild(top);

    if (e.erstelltAm || istUebersetzt(e)) {
      var created = el('p', 'card__created', e.erstelltAm ? T('Erstellt: {datum}', { datum: Xlsx.ddmmyyyy(e.erstelltAm) }) : '');
      if (istUebersetzt(e)) created.appendChild(el('span', 'tr-tag', T('🌐 übersetzt')));
      c.appendChild(created);
    }

    if (e.todo) c.appendChild(original(el('p', 'card__todo', tx(e.todo)), e.todo));

    var meta = el('div', 'card__meta');

    var prio = el('button', 'chip');
    prio.type = 'button';
    prio.title = T('Klick: Prio wechseln (Hoch → Mittel → Niedrig)');
    prio.appendChild(el('span', 'chip__dot dot--' + slug(e.prio)));
    prio.appendChild(el('span', null, T(e.prio)));
    prio.addEventListener('click', function () { Store.cycle(e.nr, 'prio'); });
    meta.appendChild(prio);

    var st = el('button', 'chip chip--status-' + slug(e.status), T(e.status));
    st.type = 'button';
    st.title = T('Klick: Status wechseln (Offen → In Arbeit → Erledigt)');
    st.addEventListener('click', function () { Store.cycle(e.nr, 'status'); });
    meta.appendChild(st);

    var ueberfaellig = Store.istUeberfaellig(e);
    var tage = tageBis(e.faellig);
    var due = el('button', 'chip chip--due' +
      (ueberfaellig ? ' is-overdue' : (tage != null && tage >= 0 && tage <= 7 && e.status !== 'Erledigt' ? ' is-soon' : '')) +
      (e.faellig ? '' : ' chip--none'), (ueberfaellig ? '⚠ ' : '📅 ') + datumLabel(e.faellig));
    due.type = 'button';
    due.title = T('Fälligkeit ändern');
    due.addEventListener('click', function () { oeffneEdit(e.nr, 'faellig'); });
    meta.appendChild(due);

    var vn = el('button', 'chip' + (e.verantwortlicher ? '' : ' chip--none'),
      '👤 ' + (e.verantwortlicher || T('offen')));
    vn.type = 'button';
    vn.title = T('Verantwortlichen setzen');
    vn.addEventListener('click', function () { oeffneEdit(e.nr, 'verant'); });
    meta.appendChild(vn);

    var tm = el('button', 'chip' + (e.verantwortlichkeit ? '' : ' chip--none'),
      '🏷 ' + (e.verantwortlichkeit ? T(e.verantwortlichkeit) : T('Verantwortlichkeit offen')));
    tm.type = 'button';
    tm.title = T('Verantwortlichkeit setzen (Advanced Development / Pre Series)');
    tm.addEventListener('click', function () { oeffneEdit(e.nr, 'team'); });
    meta.appendChild(tm);

    var bg = el('button', 'chip' + (e.baugruppe ? '' : ' chip--none'),
      '📍 ' + (e.baugruppe ? T(e.baugruppe) + (e.seite ? ' · ' + T(e.seite) : '') : T('Baugruppe offen')));
    bg.type = 'button';
    bg.title = T('Baugruppe setzen');
    bg.addEventListener('click', function () { oeffneEdit(e.nr, 'baugruppe'); });
    meta.appendChild(bg);

    if (e.release) {
      var rl = el('a', 'chip', '🚀 ' + e.release);
      rl.href = 'roadmap.html';
      rl.title = T('Release-Zuordnung in der Roadmap ändern');
      meta.appendChild(rl);
    }

    if (!Store.istThema(e.thema)) {
      var th = el('button', 'chip chip--warn', '⚠ ' + T('Thema zuordnen'));
      th.type = 'button';
      th.title = T('Thema aus der Liste wählen');
      th.addEventListener('click', function () { oeffneEdit(e.nr, 'thema'); });
      meta.appendChild(th);
    }

    c.appendChild(meta);

    if (e.bilder && e.bilder.length) {
      var row = el('div', 'thumbrow');
      e.bilder.forEach(function (b, i) {
        var img = new Image();
        img.className = 'thumb';
        img.src = b.src;
        img.alt = b.name || T('Bild zu Punkt {nr}', { nr: e.nr });
        img.loading = 'lazy';
        img.addEventListener('click', function () { zeigeLightbox(e.bilder, i); });
        row.appendChild(img);
      });
      c.appendChild(row);
    } else if (e.notiz) {
      c.appendChild(original(el('div', 'card__meta', '🖼 ' + tx(e.notiz)), e.notiz));
    }

    // Doppelklick auf die Karte oeffnet sie (nicht auf Chips, Bilder, Buttons)
    c.addEventListener('dblclick', function (ev) {
      if (ev.target.closest('button, img, a')) return;
      oeffneEdit(e.nr);
    });

    return c;
  }

  var SPALTEN = [
    { feld: 'nr', label: 'Nr' },
    { feld: 'bereich', label: 'Bereich' },
    { feld: 'thema', label: 'Thema' },
    { feld: 'baugruppe', label: 'Baugruppe' },
    { feld: 'prio', label: 'Prio' },
    { feld: 'verantwortlicher', label: 'Verantwortlicher' },
    { feld: 'verantwortlichkeit', label: 'Verantwortlichkeit' },
    { feld: 'faellig', label: 'Bis wann' },
    { feld: 'status', label: 'Status' },
    { feld: 'todo', label: 'To Do' },
    { feld: 'notiz', label: 'Bild' }
  ];

  function renderTabelle(liste) {
    var wrap = el('div', 'tablewrap');
    var t = el('table', 'opl');
    var thead = el('thead');
    var tr = el('tr');
    SPALTEN.forEach(function (s) {
      var th = el('th', null, T(s.label));
      if (sort.feld === s.feld) {
        th.appendChild(el('span', 'sort-ind', sort.richtung > 0 ? ' ▲' : ' ▼'));
      }
      th.addEventListener('click', function () {
        if (sort.feld === s.feld) sort.richtung *= -1;
        else { sort.feld = s.feld; sort.richtung = 1; }
        render();
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);

    var tbody = el('tbody');
    liste.slice().sort(sortiereTabelle).forEach(function (e) {
      var row = el('tr', e.status === 'Erledigt' ? 'is-erledigt' : '');
      row.appendChild(el('td', null, String(e.nr)));
      row.appendChild(el('td', null, T(e.bereich)));
      row.appendChild(el('td', Store.istThema(e.thema) ? null : 'is-warn', Store.istThema(e.thema) ? T(e.thema) : (e.thema ? '⚠ ' + tx(e.thema) : '⚠')));
      row.appendChild(el('td', null, e.baugruppe ? T(e.baugruppe) : '–'));

      var tdP = el('td');
      var p = el('button', 'chip');
      p.type = 'button';
      p.appendChild(el('span', 'chip__dot dot--' + slug(e.prio)));
      p.appendChild(el('span', null, T(e.prio)));
      p.addEventListener('click', function () { Store.cycle(e.nr, 'prio'); });
      tdP.appendChild(p);
      row.appendChild(tdP);

      row.appendChild(el('td', null, e.verantwortlicher || '–'));
      row.appendChild(el('td', null, e.verantwortlichkeit ? T(e.verantwortlichkeit) : '–'));

      var tdD = el('td', null, e.faellig ? Xlsx.ddmmyyyy(e.faellig) : '–');
      if (Store.istUeberfaellig(e)) { tdD.style.color = 'var(--hoch)'; tdD.style.fontWeight = '700'; }
      row.appendChild(tdD);

      var tdS = el('td');
      var s = el('button', 'chip chip--status-' + slug(e.status), T(e.status));
      s.type = 'button';
      s.addEventListener('click', function () { Store.cycle(e.nr, 'status'); });
      tdS.appendChild(s);
      row.appendChild(tdS);

      row.appendChild(original(el('td', 'col-todo', tx(e.todo)), e.todo));
      row.appendChild(original(el('td', null, e.notiz ? tx(e.notiz) : (e.bilder.length ? T('{n} Bild(er)', { n: e.bilder.length }) : '')), e.notiz));

      row.addEventListener('dblclick', function () { oeffneEdit(e.nr); });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function renderKpis(alle) {
    var offen = alle.filter(function (e) { return e.status !== 'Erledigt'; });
    $('#kpiOffen').textContent = offen.length;
    $('#kpiHoch').textContent = offen.filter(function (e) { return e.prio === 'Hoch'; }).length;
    $('#kpiMittel').textContent = offen.filter(function (e) { return e.prio === 'Mittel'; }).length;
    $('#kpiNiedrig').textContent = offen.filter(function (e) { return e.prio === 'Niedrig'; }).length;
    $('#kpiErledigt').textContent = alle.length - offen.length;
    var ueber = alle.filter(Store.istUeberfaellig).length;
    $('#kpiOverdue').textContent = ueber;
    $('#kpiOverdueBox').classList.toggle('has-overdue', ueber > 0);
    $$('.kpi').forEach(function (b) {
      b.classList.toggle('is-active', quick === b.dataset.quick);
    });
    $('#standLine').textContent = T('Open Point List · {n} Punkte · Stand {datum}',
      { n: alle.length, datum: Xlsx.ddmmyyyy(Store.heute()) });
  }

  function fuelleVerantFilter(alle) {
    var sel = $('#fVerant');
    var namen = {};
    alle.forEach(function (e) { namen[e.verantwortlicher || '(offen)'] = true; });
    var liste = Object.keys(namen).sort();
    var aktuell = filter.verant;
    sel.textContent = '';
    sel.appendChild(new Option(T('Alle Verantwortlichen'), ''));
    liste.forEach(function (n) { sel.appendChild(new Option(T(n), n)); });
    sel.value = liste.indexOf(aktuell) >= 0 ? aktuell : '';
    if (sel.value !== aktuell) filter.verant = sel.value;

    var dl = $('#personen');
    dl.textContent = '';
    liste.filter(function (n) { return n !== '(offen)'; })
      .forEach(function (n) { dl.appendChild(new Option(n)); });
  }

  function fuelleThemaFilter(alle) {
    var sel = $('#fThema');
    var aktuell = filter.thema;
    var ohne = alle.filter(function (e) { return !Store.istThema(e.thema); }).length;
    sel.textContent = '';
    sel.appendChild(new Option(T('Alle Themen'), ''));
    Store.THEMEN.forEach(function (t) { sel.appendChild(new Option(T(t), t)); });
    if (ohne) sel.appendChild(new Option(T('(nicht zugeordnet)') + ' · ' + ohne, '(offen)'));
    sel.value = aktuell;
    if (sel.value !== aktuell) { sel.value = ''; filter.thema = ''; }
  }

  /* ---------------------------------------------------------- Lightbox */

  // Kopie der Bildliste: Aenderungen im Bearbeiten-Dialog wirken nicht auf die offene Ansicht
  var lbBilder = [], lbIndex = 0;

  function zeigeLightbox(bilder, index) {
    lbBilder = (bilder || []).slice();
    if (!lbBilder.length) return;
    lbIndex = index || 0;
    lbZeige();
    var d = $('#lightbox');
    if (!d.open) d.showModal();
  }

  function lbZeige() {
    var b = lbBilder[lbIndex];
    var mehrere = lbBilder.length > 1;
    $('#lightboxImg').src = b.src;
    $('#lightboxImg').alt = b.name || '';
    $('#lightboxPrev').hidden = !mehrere;
    $('#lightboxNext').hidden = !mehrere;
    $('#lightboxInfo').textContent = (mehrere ? (lbIndex + 1) + ' / ' + lbBilder.length : '') +
      (b.name ? (mehrere ? ' · ' : '') + b.name : '');
  }

  function lbBlaettern(d) {
    if (lbBilder.length < 2) return;
    lbIndex = (lbIndex + d + lbBilder.length) % lbBilder.length;
    lbZeige();
  }

  /* ------------------------------------------------------ Edit-Dialog */

  var editNr = null;
  var editBilder = [];
  var editListe = [];

  // Thema-Auswahl; ein altes Freitext-Thema wird als Hinweis angezeigt,
  // ist aber nicht speicherbar (Pflicht: Thema aus der Liste)
  function themaAuswahl(wert) {
    var sel = $('#fmThema');
    sel.textContent = '';
    sel.appendChild(new Option(T('– bitte wählen –'), ''));
    Store.THEMEN.forEach(function (t) { sel.appendChild(new Option(T(t), t)); });
    if (wert && !Store.istThema(wert)) {
      var alt = new Option(T('bisher: {t} (bitte neu wählen)', { t: wert }), '');
      alt.disabled = true;
      sel.appendChild(alt);
    }
    sel.value = Store.istThema(wert) ? wert : '';
  }

  function fuelleSelect(sel, werte) {
    sel.textContent = '';
    werte.forEach(function (w) { sel.appendChild(new Option(T(w), w)); });
  }

  function aktualisiereEditTitel() {
    var thema = $('#fmThema').value ? T($('#fmThema').value) : '';
    var bereich = $('#fmBereich').value;
    $('#dlgEditTitle').textContent = thema || (editNr == null ? T('Neuer Punkt') : T('Punkt #{nr}', { nr: editNr }));
    var sub = $('#dlgEditSub');
    if (editNr == null) {
      sub.textContent = T(bereich);
      sub.hidden = false;
    } else {
      sub.textContent = '#' + editNr + ' · ' + T(bereich);
      sub.hidden = false;
    }
  }

  function oeffneEdit(nr, fokus) {
    editNr = nr == null ? null : nr;
    var e = nr == null ? null : Store.byNr(nr);
    $('#fmBereich').value = e ? e.bereich : (filter.bereich || Store.BEREICHE[0]);
    themaAuswahl(e ? e.thema : (Store.istThema(filter.thema) ? filter.thema : ''));
    $('#fmPrio').value = e ? e.prio : 'Mittel';
    $('#fmStatus').value = e ? e.status : 'Offen';
    $('#fmVerant').value = e ? e.verantwortlicher : (Store.state.user || '');
    $('#fmTeam').value = e ? e.verantwortlichkeit : (filter.team && filter.team !== '(offen)' ? filter.team : '');
    $('#fmBaugruppe').value = e ? (e.baugruppe || '') : (filter.baugruppe && filter.baugruppe !== '(offen)' ? filter.baugruppe : '');
    $('#fmSeite').value = e ? (e.seite || '') : '';
    $('#fmFaellig').value = e ? e.faellig : '';
    $('#fmTodo').value = e ? e.todo : '';
    $('#fmNotiz').value = e ? e.notiz : '';
    $('#fmBilder').value = '';
    $('#fmLangHint').hidden = !EN;
    aktualisiereEditTitel();
    editBilder = e ? Store.clone(e.bilder) : [];
    renderEditBilder();
    $('#btnDelete').hidden = !e;

    // Liste neu bilden, wenn sie fehlt oder veraltet ist (Karte nicht enthalten)
    if (e && editListe.indexOf(nr) < 0) {
      editListe = Store.state.entries.filter(sichtbar).map(function (x) { return x.nr; });
    }
    var hasNav = e && editListe.length > 1;
    $('#editNav').hidden = !hasNav;
    $('#btnSaveNext').hidden = !hasNav;
    if (hasNav) {
      var idx = editListe.indexOf(nr);
      $('#editPos').textContent = T('{a} von {b}', { a: idx + 1, b: editListe.length });
    }

    if (!$('#dlgEdit').open) $('#dlgEdit').showModal();
    setTimeout(function () {
      if (fokus === 'faellig') $('#fmFaellig').focus();
      else if (fokus === 'verant') $('#fmVerant').focus();
      else if (fokus === 'team') $('#fmTeam').focus();
      else if (fokus === 'baugruppe') $('#fmBaugruppe').focus();
      else $('#fmThema').focus();
    }, 30);
  }

  function editSpeichern() {
    var data = {
      bereich: $('#fmBereich').value,
      thema: $('#fmThema').value,
      prio: $('#fmPrio').value,
      status: $('#fmStatus').value,
      verantwortlicher: $('#fmVerant').value.trim(),
      verantwortlichkeit: $('#fmTeam').value || Store.teamStandard($('#fmVerant').value),
      baugruppe: $('#fmBaugruppe').value,
      seite: $('#fmSeite').value,
      faellig: $('#fmFaellig').value,
      todo: $('#fmTodo').value.trim(),
      notiz: $('#fmNotiz').value.trim(),
      bilder: editBilder
    };
    if (!Store.istThema(data.thema)) { toast(T('Bitte ein Thema aus der Liste wählen.'), true); $('#fmThema').focus(); return false; }
    // altes Freitext-Thema nicht verlieren: wandert vor das To Do
    var vorher = editNr == null ? null : Store.byNr(editNr);
    if (vorher && !Store.istThema(vorher.thema)) data.todo = Store.altesThemaInsTodo(vorher.thema, data.todo);
    if (editNr == null) {
      var neu = Store.add(data);
      toast(T('Punkt #{nr} angelegt.', { nr: neu.nr }));
    } else {
      Store.update(editNr, data);
    }
    return true;
  }

  function editNavigiere(richtung) {
    if (!editListe.length) return;
    var idx = editListe.indexOf(editNr);
    var next = idx + richtung;
    if (next < 0) next = editListe.length - 1;
    if (next >= editListe.length) next = 0;
    oeffneEdit(editListe[next]);
  }

  function renderEditBilder() {
    var box = $('#fmBilderListe');
    box.textContent = '';
    editBilder.forEach(function (b, i) {
      var w = el('span', 'thumbwrap');
      var img = new Image();
      img.className = 'thumb';
      img.src = b.src;
      img.alt = b.name || '';
      img.addEventListener('click', function () { zeigeLightbox(editBilder, i); });
      var x = el('button', null, '✕');
      x.type = 'button';
      x.title = T('Bild entfernen');
      x.addEventListener('click', function () { editBilder.splice(i, 1); renderEditBilder(); });
      w.appendChild(img);
      w.appendChild(x);
      box.appendChild(w);
    });
  }

  /** Verkleinert Bilder vor dem Speichern – localStorage ist knapp. */
  function ladeBild(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error(T('Datei nicht lesbar: {name}', { name: file.name }))); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error(T('Kein gültiges Bild: {name}', { name: file.name }))); };
        img.onload = function () {
          var max = 1400;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var w = Math.round(img.width * scale);
          var h = Math.round(img.height * scale);
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve({ name: file.name, src: cv.toDataURL('image/jpeg', 0.82) });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ------------------------------------------------------ Export/Import */

  // Bilder kommen vom Server nur als Verweis (/api/bild/...); fuer den
  // Excel-Export werden sie hier einzeln als Daten nachgeladen.
  function mitBildDaten(entries) {
    var jobs = [];
    var stat = { ok: 0, fehler: 0 };
    var kopie = entries.map(function (e) {
      var c = Object.assign({}, e, {
        bilder: (e.bilder || []).map(function (b) { return Object.assign({}, b); })
      });
      c.bilder.forEach(function (b) {
        if (b.src && b.src.indexOf('data:') !== 0) {
          jobs.push(bildZuDataUrl(b.src).then(function (d) { b.src = d; stat.ok++; })
            .catch(function () { b.src = ''; stat.fehler++; }));
        } else if (b.src) {
          stat.ok++;
        }
      });
      return c;
    });
    return Promise.all(jobs).then(function () { kopie.bildStatistik = stat; return kopie; });
  }

  // Exportiert wird, was die aktiven Filter zeigen; ohne Filter alles.
  function exportEintraege() {
    var alle = Store.state.entries;
    if (!filterAktiv()) return alle;
    return alle.filter(sichtbar).sort(function (a, b) { return a.nr - b.nr; });
  }

  function exportName(endung) {
    return 'OPL_4NE1_Gen4_' + dateiStempel() + (filterAktiv() ? '_gefiltert' : '') + '.' + endung;
  }

  function exportHinweis() {
    return filterAktiv()
      ? ' ' + T('Filter aktiv: {n} von {g} Punkten.', { n: exportEintraege().length, g: Store.state.entries.length })
      : '';
  }

  function exportXlsx() {
    var auswahl = exportEintraege();
    if (!auswahl.length) { toast(T('Keine Punkte im aktuellen Filter – nichts zu exportieren.'), true); return; }
    toast(T('Excel wird erstellt …'));
    mitBildDaten(auswahl).then(function (entries) {
      var blob = Xlsx.exportWorkbook(entries, {
        stand: Xlsx.ddmmyyyy(Store.heute()),
        bereiche: Store.BEREICHE,
        themen: Store.THEMEN,
        baugruppen: Store.BAUGRUPPEN
      });
      download(blob, exportName('xlsx'));
      var st = entries.bildStatistik;
      if (st.fehler) {
        toast(T('Excel exportiert, aber {f} von {g} Bildern konnten nicht geladen werden.', { f: st.fehler, g: st.ok + st.fehler }) + exportHinweis(), true);
      } else {
        toast(T('Excel exportiert – {n} Bilder enthalten.', { n: st.ok }) + exportHinweis());
      }
    }).catch(function (err) {
      console.error(err);
      toast(T('Excel-Export fehlgeschlagen: {msg}', { msg: err.message }), true);
    });
  }

  function exportCsv() {
    var kopf = ['Nr', 'Bereich', 'Thema/Aufgabe', 'Prio', 'Verantwortlicher',
                'Bis wann', 'Status', 'To Do', 'Bild', 'Erstellt am', 'Verantwortlichkeit', 'Baugruppe'];
    function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    var zeilen = [kopf.map(q).join(';')];
    var auswahl = exportEintraege();
    if (!auswahl.length) { toast(T('Keine Punkte im aktuellen Filter – nichts zu exportieren.'), true); return; }
    auswahl.forEach(function (e) {
      zeilen.push([e.nr, e.bereich, e.thema, e.prio, e.verantwortlicher,
        Xlsx.ddmmyyyy(e.faellig), e.status, e.todo,
        e.notiz || (e.bilder.length ? e.bilder.length + ' Bild(er) im Tool' : ''),
        Xlsx.ddmmyyyy(e.erstelltAm),
        e.verantwortlichkeit,
        e.baugruppe
      ].map(q).join(';'));
    });
    // BOM, damit Excel UTF-8 erkennt
    var blob = new Blob(['﻿' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    download(blob, exportName('csv'));
    toast(T('CSV exportiert.') + exportHinweis());
  }

  function vorschauImport(file) {
    var box = $('#impVorschau');
    box.hidden = false;
    box.textContent = T('Datei wird gelesen …');
    $('#btnImportGo').disabled = true;
    importPuffer = null;

    file.arrayBuffer().then(function (buf) {
      return Xlsx.importWorkbook(buf);
    }).then(function (res) {
      importPuffer = res.entries;
      box.textContent = '';
      var vorhandene = {};
      Store.state.entries.forEach(function (e) { vorhandene[e.nr] = true; });
      var treffer = res.entries.filter(function (e) { return vorhandene[e.nr]; }).length;
      box.appendChild(el('div', null,
        T('✓ {n} Zeilen gelesen · {treffer} davon mit bekannter Nr · {neu} neu',
          { n: res.entries.length, treffer: treffer, neu: res.entries.length - treffer })));
      if (res.warnungen.length) {
        box.appendChild(el('div', null, T('⚠ {n} Hinweis(e):', { n: res.warnungen.length })));
        var ul = el('ul');
        res.warnungen.slice(0, 20).forEach(function (w) { ul.appendChild(el('li', null, w)); });
        if (res.warnungen.length > 20) ul.appendChild(el('li', null, '…'));
        box.appendChild(ul);
      }
      $('#btnImportGo').disabled = false;
    }).catch(function (err) {
      console.error(err);
      box.textContent = '✕ ' + err.message;
    });
  }

  /** Laedt ein Bild (auch per Weiterleitung) und liefert es als data-URL. */
  function bildZuDataUrl(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    });
  }

  /* --------------------------------------------------- Admin: Zugriff */

  function ladeAdminListe() {
    var box = $('#adminEmailListe');
    box.textContent = T('Lade …');
    fetch('/api/admin/emails').then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (e) {
          throw new Error('HTTP ' + r.status + ': ' + T(e.error || 'unbekannter Fehler'));
        });
      }
      return r.json();
    }).then(function (emails) {
      box.textContent = '';
      emails.forEach(function (email) {
        var row = el('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.appendChild(el('span', null, email));
        var spacer = el('span'); spacer.style.flex = '1';
        row.appendChild(spacer);
        if (email !== 'david.rybinski@neura-robotics.com') {
          var del = el('button', 'btn btn--ghost', T('✕ entfernen'));
          del.type = 'button';
          del.addEventListener('click', function () {
            if (!confirm(T('{email} den Zugang entziehen?', { email: email }))) return;
            fetch('/api/admin/emails/' + encodeURIComponent(email), { method: 'DELETE' })
              .then(function (r) { return r.json(); })
              .then(function () { ladeAdminListe(); toast(T('{email} entfernt.', { email: email })); })
              .catch(function () { toast(T('Entfernen fehlgeschlagen.'), true); });
          });
          row.appendChild(del);
        }
        box.appendChild(row);
      });
    }).catch(function (err) {
      box.textContent = T('Konnte Liste nicht laden: {msg}', { msg: err.message });
    });
  }

  function zeigeAdmin() {
    ladeAdminListe();
    $('#dlgAdmin').showModal();
  }

  /* ---------------------------------------------------------- Protokoll */

  function zeigeLog() {
    var box = $('#logList');
    box.textContent = '';
    box.appendChild(el('div', null, T('Lade …')));
    $('#dlgLog').showModal();

    fetch('/api/log').then(function (r) { return r.json(); }).then(function (eintraege) {
      box.textContent = '';
      if (!eintraege.length) {
        box.appendChild(el('div', null, T('Noch keine Änderungen protokolliert.')));
        return;
      }
      eintraege.forEach(function (l) {
        var d = el('div');
        var b = el('b', null, l.nr ? '#' + l.nr + ' ' : T('Liste '));
        d.appendChild(b);
        d.appendChild(document.createTextNode(l.text + ' '));
        d.appendChild(el('span', null, '— ' + (l.wer || T('unbekannt')) + ', ' +
          new Date(l.wann).toLocaleString(I18N.locale())));
        box.appendChild(d);
      });
    }).catch(function () {
      box.textContent = '';
      box.appendChild(el('div', null, T('Protokoll konnte nicht geladen werden.')));
    });
  }

  /* --------------------------------------------------------------- Init */

  function init() {
    fuelleSelect($('#fmBereich'), Store.BEREICHE);
    fuelleSelect($('#fmPrio'), Store.PRIOS);
    fuelleSelect($('#fmStatus'), Store.STATI);
    Store.BEREICHE.forEach(function (b) { $('#fBereich').appendChild(new Option(b, b)); });
    Store.PRIOS.forEach(function (p) { $('#fPrio').appendChild(new Option(p, p)); });
    Store.STATI.forEach(function (s) { $('#fStatus').appendChild(new Option(s, s)); });
    $('#fmTeam').appendChild(new Option(T('– offen –'), ''));
    Store.VERANTWORTLICHKEITEN.forEach(function (v) {
      $('#fmTeam').appendChild(new Option(T(v), v));
      $('#fTeam').appendChild(new Option(T(v), v));
    });
    $('#fTeam').appendChild(new Option(T('(offen)'), '(offen)'));
    $('#fmBaugruppe').appendChild(new Option(T('– offen –'), ''));
    Store.BAUGRUPPEN.forEach(function (v) {
      $('#fmBaugruppe').appendChild(new Option(T(v), v));
      $('#fBaugruppe').appendChild(new Option(T(v), v));
    });
    $('#fBaugruppe').appendChild(new Option(T('(offen)'), '(offen)'));
    $('#fmSeite').appendChild(new Option('–', ''));
    Store.SEITEN.forEach(function (v) { $('#fmSeite').appendChild(new Option(T(v), v)); });

    Store.onError(function (msg) { toast(msg, true); });
    Store.onStatus(function (ok) { $('#offlineBanner').hidden = ok; });
    Store.load();
    if (window.__OPL_LOGIN_USER) {
      Store.setUser(window.__OPL_LOGIN_USER);
    }
    Store.subscribe(render);
    $('#userName').value = Store.state.user || '';

    // Filter
    var t;
    $('#suche').addEventListener('input', function (ev) {
      clearTimeout(t);
      var v = ev.target.value.trim().toLowerCase();
      t = setTimeout(function () { filter.suche = v; render(); }, 120);
    });
    [['#fBereich', 'bereich'], ['#fThema', 'thema'], ['#fPrio', 'prio'], ['#fStatus', 'status'], ['#fVerant', 'verant'], ['#fTeam', 'team'], ['#fBaugruppe', 'baugruppe']]
      .forEach(function (pair) {
        $(pair[0]).addEventListener('change', function (ev) {
          filter[pair[1]] = ev.target.value;
          render();
        });
      });
    function resetFilter() {
      filter = { suche: '', bereich: '', thema: '', prio: '', status: '', verant: '', team: '', baugruppe: '' };
      quick = null;
      $('#suche').value = '';
      ['#fBereich', '#fThema', '#fPrio', '#fStatus', '#fVerant', '#fTeam', '#fBaugruppe'].forEach(function (s) { $(s).value = ''; });
      render();
    }
    $('#btnFilterReset').addEventListener('click', resetFilter);
    $('#filterBannerClose').addEventListener('click', resetFilter);

    $$('.kpi').forEach(function (b) {
      b.addEventListener('click', function () {
        quick = quick === b.dataset.quick ? null : b.dataset.quick;
        render();
      });
    });

    $$('.viewswitch button').forEach(function (b) {
      b.addEventListener('click', function () {
        view = b.dataset.view;
        $$('.viewswitch button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        render();
      });
    });

    $('#userName').addEventListener('change', function (ev) { Store.setUser(ev.target.value.trim()); });

    // Dark Mode
    (function () {
      var btn = $('#btnDark');
      var saved = null;
      try { saved = localStorage.getItem('opl.theme'); } catch (e) {}
      if (saved) document.documentElement.setAttribute('data-theme', saved);
      function updateIcon() {
        var theme = document.documentElement.getAttribute('data-theme');
        var isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
        btn.textContent = isDark ? '☀' : '☾';
      }
      updateIcon();
      btn.addEventListener('click', function () {
        var theme = document.documentElement.getAttribute('data-theme');
        var isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
        var next = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('opl.theme', next); } catch (e) {}
        updateIcon();
      });
    })();

    // Menü
    var panel = $('#menuPanel');
    $('#btnMenu').addEventListener('click', function (ev) {
      ev.stopPropagation();
      panel.hidden = !panel.hidden;
      $('#btnMenu').setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', function () {
      panel.hidden = true;
      $('#btnMenu').setAttribute('aria-expanded', 'false');
    });
    panel.addEventListener('click', function (ev) {
      var act = ev.target.dataset && ev.target.dataset.act;
      if (!act) return;
      panel.hidden = true;
      if (act === 'export-xlsx') exportXlsx();
      else if (act === 'export-csv') exportCsv();
      else if (act === 'import-xlsx') {
        $('#impFile').value = '';
        $('#impVorschau').hidden = true;
        $('#btnImportGo').disabled = true;
        importPuffer = null;
        $('#dlgImport').showModal();
      } else if (act === 'roadmap') location.href = 'roadmap.html';
      else if (act === 'log') zeigeLog();
      else if (act === 'admin') zeigeAdmin();
      else if (act === 'reset' && !Store.isOnline()) {
        toast(T('Keine Verbindung zum Server – Zurücksetzen ist gerade nicht möglich.'), true);
      }
      else if (act === 'reset') {
        if (confirm(T('Wirklich alle Änderungen verwerfen und den Excel-Startstand (29 Punkte, 21.09.2026) wiederherstellen?'))) {
          Store.reset();
          toast(T('Startstand wiederhergestellt.'));
        }
      } else if (act === 'logout') {
        fetch('/api/logout').then(function () { location.reload(); });
      }
    });

    if (window.__OPL_IS_ADMIN) {
      $('#btnAdminMenu').hidden = false;
      $('#adminMenuDivider').hidden = false;
    }

    $('#formAdminAdd').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var input = $('#adminNeueEmail');
      var email = input.value.trim().toLowerCase();
      if (!email) return;
      fetch('/api/admin/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(T(e.error || 'Fehler')); });
        return r.json();
      }).then(function () {
        input.value = '';
        ladeAdminListe();
        toast(T('{email} hinzugefügt.', { email: email }));
      }).catch(function (err) {
        toast(err.message, true);
      });
    });

    // Neuer Punkt
    $('#btnNeu').addEventListener('click', function () { oeffneEdit(null); });

    // Edit-Dialog
    $('#fmThema').addEventListener('change', aktualisiereEditTitel);
    // Verantwortlichkeit nach Person vorbelegen, solange sie leer ist
    $('#fmVerant').addEventListener('change', function () {
      if (!$('#fmTeam').value) $('#fmTeam').value = Store.teamStandard($('#fmVerant').value);
    });
    $('#fmBereich').addEventListener('change', aktualisiereEditTitel);

    $('#fmBilder').addEventListener('change', function (ev) {
      var files = Array.prototype.slice.call(ev.target.files);
      Promise.all(files.map(ladeBild)).then(function (bilder) {
        editBilder = editBilder.concat(bilder);
        renderEditBilder();
        ev.target.value = '';
      }).catch(function (err) { toast(err.message, true); });
    });

    $('#formEdit').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (editSpeichern()) {
        toast(T('Punkt #{nr} gespeichert.', { nr: editNr }));
        editListe = [];
        $('#dlgEdit').close();
      }
    });

    $('#btnSaveNext').addEventListener('click', function () {
      if (editSpeichern()) {
        editNavigiere(1);
      }
    });

    // Auch bei Abbrechen, Esc oder ✕ die Blätterliste verwerfen, damit der
    // nächste Aufruf den dann aktiven Filter verwendet
    $('#dlgEdit').addEventListener('close', function () { editListe = []; });

    $('#btnPrev').addEventListener('click', function () { editNavigiere(-1); });
    $('#btnNext').addEventListener('click', function () { editNavigiere(1); });

    $('#dlgEdit').addEventListener('keydown', function (ev) {
      var tag = document.activeElement.tagName;
      if (tag === 'TEXTAREA') return;
      if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); editNavigiere(-1); }
      if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); editNavigiere(1); }
    });

    $('#btnDelete').addEventListener('click', function () {
      if (editNr == null) return;
      if (!confirm(T('Punkt #{nr} wirklich löschen? Tipp: Status „Erledigt” behält die Historie.', { nr: editNr }))) return;
      Store.remove(editNr);
      editListe = [];
      $('#dlgEdit').close();
      toast(T('Punkt gelöscht.'));
    });

    // Import-Dialog
    $('#impFile').addEventListener('change', function (ev) {
      if (ev.target.files[0]) vorschauImport(ev.target.files[0]);
    });
    $('#btnImportGo').addEventListener('click', function () {
      if (!importPuffer) return;
      if (!Store.isOnline()) { toast(T('Keine Verbindung zum Server – Import ist gerade nicht möglich.'), true); return; }
      var modus = $$('input[name="impModus"]').filter(function (r) { return r.checked; })[0].value;
      if (modus === 'ersetzen') {
        var weg = Store.state.entries.length - importPuffer.length;
        var frage = T('Der aktuelle Stand ({n} Punkte) wird komplett ersetzt. Fortfahren?', { n: Store.state.entries.length });
        // z. B. ein gefilterter Export: alles, was nicht in der Datei steht, wuerde geloescht
        if (weg > 0) frage = T('Achtung: Die Datei enthält nur {i} von {n} Punkten. Beim Ersetzen werden {w} Punkte gelöscht. Wirklich fortfahren?', { i: importPuffer.length, n: Store.state.entries.length, w: weg });
        if (!confirm(frage)) return;
      }
      var res = Store.applyImport(importPuffer, modus);
      $('#dlgImport').close();
      toast(modus === 'ersetzen'
        ? T('Import fertig: Liste durch {n} Punkte aus der Excel ersetzt.', { n: res.neu })
        : T('Import fertig: {a} aktualisiert, {n} neu.', { a: res.aktualisiert, n: res.neu }));
    });

    // Dialoge schließen
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });

    // Lightbox
    // Klick irgendwo (ausser auf die Pfeile) schliesst; Esc schliesst nativ nur die Lightbox
    $('#lightbox').addEventListener('click', function () { $('#lightbox').close(); });
    $('#lightboxPrev').addEventListener('click', function (ev) { ev.stopPropagation(); lbBlaettern(-1); });
    $('#lightboxNext').addEventListener('click', function (ev) { ev.stopPropagation(); lbBlaettern(1); });
    $('#lightbox').addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); lbBlaettern(-1); }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); lbBlaettern(1); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'n' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
          !document.querySelector('dialog[open]')) {
        ev.preventDefault();
        oeffneEdit(null);
      }
    });

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
