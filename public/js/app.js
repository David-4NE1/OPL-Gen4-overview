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

  // Auswahlfilter sind Listen (Mehrfachauswahl), leere Liste = alle
  var FILTER_FELDER = [['#fBereich', 'bereich'], ['#fThema', 'thema'], ['#fPrio', 'prio'], ['#fStatus', 'status'],
    ['#fVerant', 'verant'], ['#fTeam', 'team'], ['#fBaugruppe', 'baugruppe'], ['#fNacharbeit', 'nacharbeit'],
    ['#fZielRelease', 'zielRelease'], ['#fUnterthema', 'unterthema']];
  function leererFilter() {
    return { suche: '', bereich: [], thema: [], prio: [], status: [], verant: [], team: [], baugruppe: [], nacharbeit: [], zielRelease: [], unterthema: [] };
  }
  var filter = leererFilter();

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
    if (!trifft(filter.bereich, e.bereich)) return false;
    if (!trifft(filter.thema, Store.istThema(e.thema) ? e.thema : '(offen)')) return false;
    if (!trifft(filter.prio, e.prio)) return false;
    if (!trifft(filter.status, e.status)) return false;
    if (!trifft(filter.verant, e.verantwortlicher || '(offen)')) return false;
    if (!trifft(filter.team, e.verantwortlichkeit || '(offen)')) return false;
    if (!trifft(filter.baugruppe, e.baugruppe || '(offen)')) return false;
    if (!trifft(filter.zielRelease, e.zielRelease || '(offen)')) return false;
    if (!trifft(filter.unterthema, e.unterthema || '(offen)')) return false;
    // "Re-Milling + Modification" erscheint unter beiden Filterwerten
    if (filter.nacharbeit.length && !filter.nacharbeit.some(function (v) {
      return v === '(keine)' ? !e.nacharbeit : (e.nacharbeit || '').indexOf(v) >= 0;
    })) return false;
    if (quick === 'offen' && e.status === 'Erledigt') return false;
    if (quick === 'erledigt' && e.status !== 'Erledigt') return false;
    if (quick === 'hoch' && !(e.prio === 'Hoch' && e.status !== 'Erledigt')) return false;
    if (quick === 'mittel' && !(e.prio === 'Mittel' && e.status !== 'Erledigt')) return false;
    if (quick === 'niedrig' && !(e.prio === 'Niedrig' && e.status !== 'Erledigt')) return false;
    if (quick === 'ueberfaellig' && !Store.istUeberfaellig(e)) return false;
    if (filter.suche) {
      var hay = [e.nr, e.thema, e.todo, e.verantwortlicher, e.verantwortlichkeit, e.baugruppe, e.nacharbeit, e.zielRelease, e.unterthema, e.lhTitel, e.anforderung, e.bereich, e.notiz,
        TR[e.thema], TR[e.todo], TR[e.notiz], T(e.bereich), T(e.status), T(e.prio)]
        .join(' ').toLowerCase();
      if (hay.indexOf(filter.suche) < 0) return false;
    }
    return true;
  }

  function trifft(liste, wert) {
    return !liste.length || liste.indexOf(wert) >= 0;
  }

  function filterAktiv() {
    return !!(filter.suche || quick || FILTER_FELDER.some(function (f) { return filter[f[1]].length; }));
  }

  // Vorbelegung fuer neue Karten: nur wenn genau ein Wert gefiltert ist
  function einzigerFilter(key) {
    var l = filter[key];
    return l.length === 1 && l[0] !== '(offen)' ? l[0] : '';
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
    mselFesteOptionen();
    fuelleThemaFilter(alle);
    fuelleVerantFilter(alle);
    var istAktiv = filterAktiv();
    $('#btnFilterReset').hidden = !istAktiv;
    // Smartphone: Zahl der aktiven Auswahlfilter am Knopf "Filter"
    var nAuswahl = FILTER_FELDER.filter(function (f) { return filter[f[1]].length; }).length;
    $('#filterZahl').textContent = nAuswahl;
    $('#filterZahl').hidden = !nAuswahl;

    var liste = alle.filter(sichtbar);

    var banner = $('#filterBanner');
    if (istAktiv) {
      var teile = [];
      if (quick) {
        var ql = { offen: 'Offen', erledigt: 'Erledigt', hoch: 'Prio Hoch', mittel: 'Prio Mittel', niedrig: 'Prio Niedrig', ueberfaellig: 'Überfällig' };
        teile.push(T(ql[quick] || quick));
      }
      var werte = function (key) {
        return filter[key].map(function (v) {
          return key === 'thema' && v === '(offen)' ? T('(nicht zugeordnet)') : T(v);
        }).join(' / ');
      };
      if (filter.bereich.length) teile.push(T('Bereich: {v}', { v: werte('bereich') }));
      if (filter.thema.length) teile.push(T('Thema: {v}', { v: werte('thema') }));
      if (filter.prio.length) teile.push(T('Prio: {v}', { v: werte('prio') }));
      if (filter.status.length) teile.push(T('Status: {v}', { v: werte('status') }));
      if (filter.verant.length) teile.push(T('Verantwortlich: {v}', { v: werte('verant') }));
      if (filter.team.length) teile.push(T('Verantwortlichkeit: {v}', { v: werte('team') }));
      if (filter.baugruppe.length) teile.push(T('Baugruppe: {v}', { v: werte('baugruppe') }));
      if (filter.nacharbeit.length) teile.push(T('Nacharbeit: {v}', { v: werte('nacharbeit') }));
      if (filter.zielRelease.length) teile.push(T('Ziel-Release: {v}', { v: werte('zielRelease') }));
      if (filter.unterthema.length) teile.push(T('Unterthema: {v}', { v: werte('unterthema') }));
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
    if (view === 'lastenheft') {
      if (!lhZiele) lhZieleLaden();
      if (!lhForderungen) lhForderungenLaden();
      content.appendChild(window.OPLLastenheft.render(liste, {
        gesamt: alle.length, filterAktiv: istAktiv, aktionen: lastenheftAktionen(),
        ziele: lhZiele || {}, offen: lhOffen, darfBearbeiten: Store.darf('bearbeiten'),
        forderungen: lhForderungen || [], modus: lhModus,
        setModus: function (m) { lhModus = m; try { localStorage.setItem('opl_lh_modus', m); } catch (e) { /* egal */ } render(); },
        forderungBearbeiten: forderungBearbeiten,
        exportKategorie: lastenheftExportKategorie,
        fokus: lhFokus, fokusUmschalten: fokusUmschalten,
        umschalten: function (key, wert) { lhOffen[key] = wert === undefined ? !lhOffen[key] : wert; render(); },
        bearbeiten: zielBearbeiten,
        oeffnen: function (nr) { oeffneEdit(nr, 'anforderung'); }
      }));
      return;
    }

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
    var themaBox = el('span', 'card__thema', e.thema ? (Store.istThema(e.thema) ? T(e.thema) : tx(e.thema)) : T('(ohne Thema)'));
    if (e.unterthema) themaBox.appendChild(el('span', 'card__unterthema', T(e.unterthema)));
    top.appendChild(themaBox);
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

    if (e.zielRelease) {
      var zr = el('button', 'chip chip--ziel', '🎯 ' + e.zielRelease);
      zr.type = 'button';
      zr.title = T('Ziel-Release');
      zr.addEventListener('click', function () { oeffneEdit(e.nr, 'zielRelease'); });
      meta.appendChild(zr);
    }

    if (e.nacharbeit) {
      var na = el('button', 'chip chip--nacharbeit', '🛠 ' + T(e.nacharbeit));
      na.type = 'button';
      na.title = T('Nacharbeit am Teil');
      na.addEventListener('click', function () { oeffneEdit(e.nr, 'nacharbeit'); });
      meta.appendChild(na);
    }

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
    { feld: 'unterthema', label: 'Unterthema' },
    { feld: 'baugruppe', label: 'Baugruppe' },
    { feld: 'nacharbeit', label: 'Nacharbeit' },
    { feld: 'zielRelease', label: 'Ziel-Release' },
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
      row.appendChild(el('td', null, e.unterthema ? T(e.unterthema) : '–'));
      row.appendChild(el('td', null, e.baugruppe ? T(e.baugruppe) : '–'));
      row.appendChild(el('td', null, e.nacharbeit ? T(e.nacharbeit) : '–'));
      row.appendChild(el('td', null, e.zielRelease || '–'));

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
    var namen = {};
    alle.forEach(function (e) { namen[e.verantwortlicher || '(offen)'] = true; });
    var liste = Object.keys(namen).sort();
    mselOptionen('#fVerant', 'verant', liste.map(function (n) { return [n, T(n)]; }));

    var dl = $('#personen');
    dl.textContent = '';
    liste.filter(function (n) { return n !== '(offen)'; })
      .forEach(function (n) { dl.appendChild(new Option(n)); });
  }

  function fuelleThemaFilter(alle) {
    var ohne = alle.filter(function (e) { return !Store.istThema(e.thema); }).length;
    var opts = Store.THEMEN.map(function (t) { return [t, T(t)]; });
    if (ohne) opts.push(['(offen)', T('(nicht zugeordnet)') + ' · ' + ohne]);
    mselOptionen('#fThema', 'thema', opts);
  }

  /* ------------------------------------------------- Mehrfachauswahl */

  // Filter-Dropdown mit Haekchen. Die Auswahl steht in filter[key].
  function mselBauen(id, key) {
    var box = $(id);
    var btn = el('button', 'select msel__btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    var panel = el('div', 'msel__panel');
    panel.hidden = true;
    var liste = el('div', 'msel__liste');
    var leeren = el('button', 'msel__leeren', T('Auswahl aufheben'));
    leeren.type = 'button';
    panel.appendChild(liste);
    panel.appendChild(leeren);
    box.textContent = '';
    box.appendChild(btn);
    box.appendChild(panel);
    box.dataset.key = key;

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var auf = panel.hidden;
      mselAlleZu();
      panel.hidden = !auf;
      btn.setAttribute('aria-expanded', String(auf));
    });
    panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    liste.addEventListener('change', function () {
      filter[key] = $$('input:checked', liste).map(function (c) { return c.value; });
      render();
    });
    leeren.addEventListener('click', function () {
      filter[key] = [];
      render();
    });
  }

  function mselAlleZu() {
    $$('.msel__panel').forEach(function (p) { p.hidden = true; });
    $$('.msel__btn').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }

  // optionen: [[wert, anzeige], ...]; Auswahlen, die es nicht mehr gibt, fallen weg
  function mselOptionen(id, key, optionen) {
    var box = $(id);
    var liste = $('.msel__liste', box);
    var werte = optionen.map(function (o) { return o[0]; });
    filter[key] = filter[key].filter(function (v) { return werte.indexOf(v) >= 0; });
    var sig = JSON.stringify(optionen);
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      liste.textContent = '';
      optionen.forEach(function (o) {
        var lab = el('label', 'msel__opt');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o[0];
        lab.appendChild(cb);
        lab.appendChild(el('span', null, o[1]));
        liste.appendChild(lab);
      });
    }
    $$('input', liste).forEach(function (cb) { cb.checked = filter[key].indexOf(cb.value) >= 0; });
    var gewaehlt = optionen.filter(function (o) { return filter[key].indexOf(o[0]) >= 0; });
    var btn = $('.msel__btn', box);
    btn.textContent = !gewaehlt.length ? T(box.dataset.alle)
      : gewaehlt[0][1] + (gewaehlt.length > 1 ? ' +' + (gewaehlt.length - 1) : '');
    btn.classList.toggle('is-active', gewaehlt.length > 0);
    btn.title = gewaehlt.map(function (o) { return o[1]; }).join(', ');
    $('.msel__leeren', box).hidden = !gewaehlt.length;
  }

  function mselFesteOptionen() {
    mselOptionen('#fBereich', 'bereich', Store.BEREICHE.map(function (b) { return [b, T(b)]; }));
    mselOptionen('#fPrio', 'prio', Store.PRIOS.map(function (p) { return [p, T(p)]; }));
    mselOptionen('#fStatus', 'status', Store.STATI.map(function (p) { return [p, T(p)]; }));
    mselOptionen('#fTeam', 'team', Store.VERANTWORTLICHKEITEN.map(function (v) { return [v, T(v)]; })
      .concat([['(offen)', T('(offen)')]]));
    mselOptionen('#fBaugruppe', 'baugruppe', Store.BAUGRUPPEN.map(function (v) { return [v, T(v)]; })
      .concat([['(offen)', T('(offen)')]]));
    mselOptionen('#fNacharbeit', 'nacharbeit', [['Re-Milling', T('Re-Milling')], ['Modification', T('Modification')],
      ['(keine)', T('(keine Nacharbeit)')]]);
    mselOptionen('#fZielRelease', 'zielRelease', Store.ZIEL_RELEASES.map(function (v) { return [v, v]; })
      .concat([['(offen)', T('(offen)')]]));
    // Unterthemen: bei gefilterten Kategorien nur deren Unterthemen
    var themen = filter.thema.filter(Store.istThema);
    var unter = [];
    (themen.length ? themen : Store.THEMEN).forEach(function (t) {
      Store.unterthemenVon(t).forEach(function (u) { unter.push([u, T(u)]); });
    });
    mselOptionen('#fUnterthema', 'unterthema', unter.concat([['(offen)', T('(offen)')]]));
  }

  // Auswahl im Dialog passend zur gewaehlten Kategorie
  function unterthemaAuswahl(wert) {
    var sel = $('#fmUnterthema');
    var liste = Store.unterthemenVon($('#fmThema').value);
    sel.textContent = '';
    sel.appendChild(new Option(liste.length ? T('– offen –') : T('– erst Thema wählen –'), ''));
    liste.forEach(function (u) { sel.appendChild(new Option(T(u), u)); });
    sel.value = liste.indexOf(wert) >= 0 ? wert : '';
    sel.disabled = !liste.length || !Store.darf('bearbeiten');
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
    if (nr == null && !Store.darf('bearbeiten')) return;
    editNr = nr == null ? null : nr;
    var e = nr == null ? null : Store.byNr(nr);
    $('#fmBereich').value = e ? e.bereich : (einzigerFilter('bereich') || Store.BEREICHE[0]);
    themaAuswahl(e ? e.thema : einzigerFilter('thema'));
    unterthemaAuswahl(e ? e.unterthema : einzigerFilter('unterthema'));
    $('#fmPrio').value = e ? e.prio : 'Mittel';
    $('#fmStatus').value = e ? e.status : 'Offen';
    $('#fmVerant').value = e ? e.verantwortlicher : (Store.state.user || '');
    $('#fmTeam').value = e ? e.verantwortlichkeit : einzigerFilter('team');
    $('#fmBaugruppe').value = e ? (e.baugruppe || '') : einzigerFilter('baugruppe');
    $('#fmSeite').value = e ? (e.seite || '') : '';
    $('#fmNacharbeit').value = e ? (e.nacharbeit || '') : '';
    $('#fmZielRelease').value = e ? (e.zielRelease || '') : einzigerFilter('zielRelease');
    $('#fmLhTitel').value = e ? (e.lhTitel || '') : '';
    $('#fmAnforderung').value = e ? (e.anforderung || '') : '';
    $('#fmFaellig').value = e ? e.faellig : '';
    $('#fmTodo').value = e ? e.todo : '';
    $('#fmNotiz').value = e ? e.notiz : '';
    $('#fmBilder').value = '';
    $('#fmLangHint').hidden = !EN;
    aktualisiereEditTitel();
    editBilder = e ? Store.clone(e.bilder) : [];
    renderEditBilder();
    $('#btnDelete').hidden = !e;
    // Nur Lesezugriff: Felder sperren, Bilder bleiben per Klick vergroesserbar
    var nurLesen = !Store.darf('bearbeiten');
    $$('#formEdit input, #formEdit select, #formEdit textarea').forEach(function (f) { f.disabled = nurLesen; });
    unterthemaAuswahl($('#fmUnterthema').value); // Sperre je nach Thema wiederherstellen
    $('#fmBilder').closest('label').hidden = nurLesen;

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
      else if (fokus === 'nacharbeit') $('#fmNacharbeit').focus();
      else if (fokus === 'zielRelease') $('#fmZielRelease').focus();
      else if (fokus === 'anforderung') $('#fmAnforderung').focus();
      else $('#fmThema').focus();
    }, 30);
  }

  function editSpeichern() {
    var data = {
      bereich: $('#fmBereich').value,
      thema: $('#fmThema').value,
      unterthema: $('#fmUnterthema').value,
      prio: $('#fmPrio').value,
      status: $('#fmStatus').value,
      verantwortlicher: $('#fmVerant').value.trim(),
      verantwortlichkeit: $('#fmTeam').value || Store.teamStandard($('#fmVerant').value),
      baugruppe: $('#fmBaugruppe').value,
      seite: $('#fmSeite').value,
      nacharbeit: $('#fmNacharbeit').value,
      zielRelease: $('#fmZielRelease').value,
      lhTitel: $('#fmLhTitel').value.trim(),
      anforderung: $('#fmAnforderung').value.trim(),
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
      var x = el('button', 'nur-bearbeiten', '✕');
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

  /* --------------------------------------------------------- Lastenheft */

  function lastenheftAktionen() {
    var box = el('div', 'lh__aktionen');
    function knopf(text, titel, fn, cls) {
      var b = el('button', 'btn btn--ghost lh__knopf' + (cls ? ' ' + cls : ''), text);
      b.type = 'button';
      b.title = titel;
      b.addEventListener('click', fn);
      box.appendChild(b);
      return b;
    }
    // Export als Auswahlmenue
    var menu = el('div', 'menu lh__export');
    var auf = el('button', 'btn btn--ghost lh__knopf', T('⬇ Export ▾'));
    auf.type = 'button';
    auf.setAttribute('aria-haspopup', 'true');
    auf.setAttribute('aria-expanded', 'false');
    var panel = el('div', 'menu__panel lh__exportpanel');
    panel.hidden = true;
    [['kategorie', T('🎯 Word – eine Kategorie …'), T('Forderungen einer Kategorie, darunter Beispiele aus der OPL')],
      ['kurz', T('📄 Word – Management-Kurzfassung'), T('2–3 Seiten: Kennzahlen, Anforderung/Ziel je Kategorie, Steuerungsbedarf, offene Prio-Hoch-Punkte')],
      ['docx', T('📘 Word – Lastenheft vollständig'), T('Alle Anforderungen je Kategorie und Unterthema (.docx)')],
      ['xlsx', T('📊 Excel – Lastenheft'), T('Lastenheft als Excel-Tabelle')],
      ['druck', T('🖨 Drucken / PDF'), T('Über den Druckdialog auch als PDF speichern')]].forEach(function (a) {
      var b = el('button', 'lh__exportwahl', a[1]);
      b.type = 'button';
      b.title = a[2];
      b.dataset.art = a[0];
      panel.appendChild(b);
    });
    function zu() { panel.hidden = true; auf.setAttribute('aria-expanded', 'false'); }
    auf.addEventListener('click', function (ev) {
      ev.stopPropagation();
      panel.hidden = !panel.hidden;
      auf.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) document.addEventListener('click', zu, { once: true });
    });
    panel.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var art = ev.target.dataset && ev.target.dataset.art;
      if (!art) return;
      zu();
      if (art === 'druck') window.print();
      else if (art === 'kategorie') kategorieWaehlen();
      else lastenheftExport(art);
    });
    menu.appendChild(auf);
    menu.appendChild(panel);
    box.appendChild(menu);
    knopf(T('⬆ Aus Excel übernehmen'), T('Anforderungstexte und/oder Unterthemen aus einer Excel übernehmen (Spalten „OPL-Nr“ und „Anforderung“, „Titel“ bzw. „Unterthema“)'),
      function () { $('#lhDatei').click(); }, 'nur-bearbeiten');
    return box;
  }

  // Anforderung/Ziel je Kategorie bzw. Unterthema (Tabelle lastenheft_ziele)
  var lhZiele = null;          // { schluessel: { anforderung, ziel } }, null = noch nicht geladen
  var lhZieleLaedt = false;
  var lhOffen = {};            // aufgeklappte Unterthemen

  function lhZieleLaden() {
    if (lhZieleLaedt) return Promise.resolve();
    lhZieleLaedt = true;
    return fetch('/api/ziele').then(function (r) { return r.ok ? r.json() : []; }).then(function (liste) {
      lhZiele = {};
      liste.forEach(function (z) { lhZiele[z.schluessel] = z; });
    }).catch(function () { lhZiele = lhZiele || {}; }).then(function () {
      lhZieleLaedt = false;
      if (view === 'lastenheft') render();
    });
  }

  // Management-Forderungen je Kategorie (Tabelle forderungen)
  var lhForderungen = null;    // [{ id, kategorie, text, detail, beispiele }], null = noch nicht geladen
  var lhForderungenLaedt = false;
  var lhModus = (function () { try { return localStorage.getItem('opl_lh_modus') || 'forderungen'; } catch (e) { return 'forderungen'; } })();

  var lhFokus = [];             // Fokus-Kategorien (fuer alle oben)

  function lhForderungenLaden() {
    if (lhForderungenLaedt) return Promise.resolve();
    lhForderungenLaedt = true;
    return Promise.all([
      fetch('/api/forderungen').then(function (r) { return r.ok ? r.json() : []; }),
      fetch('/api/forderungen/fokus').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return lhFokus; })
    ]).then(function (x) {
      lhForderungen = x[0];
      lhFokus = x[1];
    }).catch(function () { lhForderungen = lhForderungen || []; }).then(function () {
      lhForderungenLaedt = false;
      if (view === 'lastenheft') render();
    });
  }

  function fokusUmschalten(kategorie) {
    var neu = lhFokus.indexOf(kategorie) >= 0
      ? lhFokus.filter(function (k) { return k !== kategorie; })
      : lhFokus.concat([kategorie]);
    forderungAnfrage('PUT', '/fokus', { kategorien: neu }).then(function (r) {
      lhFokus = r.kategorien;
      toast(neu.indexOf(kategorie) >= 0 ? T('„{k}“ steht jetzt als Fokus oben.', { k: T(kategorie) }) : T('Fokus für „{k}“ entfernt.', { k: T(kategorie) }));
      render();
    }).catch(function (err) { toast(err.message, true); });
  }

  function forderungAnfrage(method, pfad, body) {
    return fetch('/api/forderungen' + (pfad || ''), {
      method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(T(d.error || 'Fehler'));
        return d;
      });
    });
  }

  function forderungBearbeiten(kategorie, f) {
    var d = $('#dlgForderung');
    $('#foTitel').textContent = T(kategorie);
    $('#foFrage').textContent = window.OPLLastenheft.frage(kategorie);
    $('#foText').value = f ? f.text : '';
    $('#foDetail').value = f ? f.detail || '' : '';
    $('#foBeispiele').value = f ? String(f.beispiele || '').split(',').filter(Boolean).join(', ') : '';
    $('#btnFoLoeschen').hidden = !f;
    d.dataset.kategorie = kategorie;
    d.dataset.id = f ? f.id : '';
    vorAuf = {};
    vorschlaegeZeigen();
    d.showModal();
    $('#foText').focus();
  }

  // Passende OPL-Punkte zum Text der Forderung (Stichwortsuche, ohne KI); anhaken = als Beispiel uebernehmen
  function beispielNrsImFeld() {
    return ($('#foBeispiele').value.match(/\d+/g) || []).map(Number);
  }

  var vorAuf = {};   // aufgeklappte Vorschlaege (OPL-Nr)

  function vorschlaegeZeigen() {
    var box = $('#foVorschlaege');
    box.textContent = '';
    var text = $('#foText').value, detail = $('#foDetail').value;
    var dlg = $('#dlgForderung');
    var kategorie = dlg.dataset.kategorie;
    // Punkte, die schon bei einer anderen Forderung als Beispiel haengen (eigene Kategorie zuerst nennen)
    var belegt = {};
    (lhForderungen || []).filter(function (f) { return String(f.id) !== dlg.dataset.id; })
      .sort(function (a, b) { return (b.kategorie === kategorie) - (a.kategorie === kategorie); })
      .forEach(function (f) {
        String(f.beispiele || '').split(',').map(Number).filter(Boolean).forEach(function (n) {
          (belegt[n] = belegt[n] || []).push(f.kategorie === kategorie ? f.text : T(f.kategorie) + ': ' + f.text);
        });
      });
    var liste = window.OPLLastenheft.vorschlaege(Store.state.entries, kategorie, text, detail, 25);
    if (!text.trim() && !detail.trim()) return;
    // Reihenfolge: offen und noch nicht zugeordnet, dann schon zugeordnet, zuletzt erledigt
    var offen = function (v) { return v.e.status !== 'Erledigt'; };
    var frei = liste.filter(function (v) { return offen(v) && !belegt[v.e.nr]; });
    var schon = liste.filter(function (v) { return offen(v) && belegt[v.e.nr]; });
    var erledigt = liste.filter(function (v) { return !offen(v); });
    liste = frei.slice(0, 10).concat(schon.slice(0, 8), erledigt.slice(0, 4));
    box.appendChild(el('div', 'fovor__kopf', T('Vorschläge aus der OPL – anhaken, um sie als Beispiel zu übernehmen') +
      (schon.length ? ' · ' + T('noch nicht zugeordnete zuerst') : '')));
    if (!liste.length) { box.appendChild(el('p', 'fovor__leer', T('Keine passenden Punkte gefunden – andere Begriffe probieren.'))); return; }
    var drin = beispielNrsImFeld();
    liste.forEach(function (v) {
      var e = v.e;
      var zeile = el('label', 'fovor__zeile' + (e.status === 'Erledigt' ? ' is-erledigt' : '') + (belegt[e.nr] ? ' is-belegt' : ''));
      var cb = el('input');
      cb.type = 'checkbox';
      cb.value = e.nr;
      cb.checked = drin.indexOf(e.nr) >= 0;
      cb.addEventListener('change', function () {
        var nrs = beispielNrsImFeld().filter(function (n) { return n !== e.nr; });
        if (cb.checked) nrs.push(e.nr);
        $('#foBeispiele').value = nrs.join(', ');
      });
      zeile.appendChild(cb);
      zeile.appendChild(el('b', 'fovor__nr', '#' + e.nr));
      zeile.appendChild(el('span', 'pill pill--' + String(e.prio).toLowerCase(), T(e.prio)));
      var txt = el('span', 'fovor__text', window.OPLLastenheft.kurztext(e, 120));
      txt.appendChild(el('small', null, ' · ' + T(e.thema) + (e.status === 'Erledigt' ? ' · ' + T('erledigt') : '') +
        ' · ' + T('Treffer: {w}', { w: v.treffer.join(', ') })));
      // Aufklappen: vollstaendiger Text, Status, Verantwortlich, Bilder
      var auf = el('button', 'fovor__auf', vorAuf[e.nr] ? '▾' : '▸');
      auf.type = 'button';
      auf.title = vorAuf[e.nr] ? T('Zuklappen') : T('Vollständig anzeigen');
      auf.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        vorAuf[e.nr] = !vorAuf[e.nr];
        vorschlaegeZeigen();
      });
      if (belegt[e.nr]) {
        var hinweis = belegt[e.nr];
        txt.appendChild(el('span', 'fovor__belegt', T('schon bei: {f}', { f: '„' + hinweis.slice(0, 2).join('“, „') + '“' + (hinweis.length > 2 ? ' +' + (hinweis.length - 2) : '') })));
      }
      if (vorAuf[e.nr]) {
        var voll = el('div', 'fovor__voll');
        if (e.lhTitel) voll.appendChild(el('b', null, e.lhTitel));
        voll.appendChild(el('p', 'fovor__volltext', e.todo || ''));
        if (e.notiz) voll.appendChild(el('p', 'fovor__notiz', T('Notiz') + ': ' + e.notiz));
        voll.appendChild(el('p', 'fovor__meta', [T(e.status), e.verantwortlicher, e.verantwortlichkeit, e.baugruppe,
          e.faellig ? T('bis {d}', { d: Xlsx.ddmmyyyy(e.faellig) }) : '', e.zielRelease ? '🎯 ' + e.zielRelease : '']
          .filter(Boolean).join(' · ')));
        var bilder = (e.bilder || []).filter(function (b) { return b && b.src; });
        if (bilder.length) {
          var reihe = el('div', 'fovor__bilder');
          bilder.forEach(function (b, i) {
            var img = el('img');
            img.src = b.src;
            img.alt = b.name || '';
            img.loading = 'lazy';
            img.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); zeigeLightbox(bilder, i); });
            reihe.appendChild(img);
          });
          voll.appendChild(reihe);
        }
        voll.addEventListener('click', function (ev) { ev.preventDefault(); });
        txt.appendChild(voll);
      }
      zeile.appendChild(txt);
      zeile.appendChild(auf);
      box.appendChild(zeile);
    });
  }

  function forderungSpeichern() {
    var d = $('#dlgForderung');
    var nrs = ($('#foBeispiele').value.match(/\d+/g) || []).map(Number);
    var fremd = nrs.filter(function (n) { return !Store.byNr(n); });
    if (fremd.length) { toast(T('Unbekannte OPL-Nummern: {l}', { l: fremd.join(', ') }), true); return; }
    var body = { kategorie: d.dataset.kategorie, text: $('#foText').value.trim(), detail: $('#foDetail').value.trim(), beispiele: nrs };
    (d.dataset.id ? forderungAnfrage('PUT', '/' + d.dataset.id, body) : forderungAnfrage('POST', '', body)).then(function () {
      d.close();
      toast(T('Gespeichert.'));
      return lhForderungenLaden();
    }).catch(function (err) { toast(err.message, true); });
  }

  function forderungLoeschen() {
    var d = $('#dlgForderung');
    if (!d.dataset.id || !confirm(T('Diese Forderung löschen?'))) return;
    forderungAnfrage('DELETE', '/' + d.dataset.id).then(function () {
      d.close();
      toast(T('Forderung gelöscht.'));
      return lhForderungenLaden();
    }).catch(function (err) { toast(err.message, true); });
  }

  function forderungenUebernehmen(liste) {
    var unbekannt = liste.filter(function (f) { return !Store.istThema(f.kategorie); }).length;
    var gueltig = liste.filter(function (f) { return Store.istThema(f.kategorie); });
    if (!gueltig.length) { toast(T('Forderungen: keine gültige Kategorie gefunden.'), true); return Promise.resolve(true); }
    var kat = {};
    gueltig.forEach(function (f) { kat[f.kategorie] = true; });
    if (!confirm(T('{n} Forderungen für {k} Kategorien ergänzen?', { n: gueltig.length, k: Object.keys(kat).length }) + '\n' +
      T('Neue Forderungen kommen dazu; bei gleichem Text werden Beispiele ergänzt und das Detail übernommen. Es wird nichts gelöscht.') +
      (unbekannt ? '\n' + T('{n} Zeilen mit unbekannter Kategorie werden übersprungen.', { n: unbekannt }) : ''))) return Promise.resolve(true);
    return forderungAnfrage('POST', '/import', { liste: gueltig }).then(function (r) {
      toast(T('Forderungen ergänzt: {n} neu, {a} aktualisiert, {g} unverändert.', { n: r.neu, a: r.aktualisiert, g: r.gleich }));
      return lhForderungenLaden();
    }).then(function () { return true; });
  }

  function zielSpeichern(kategorie, unterthema, anforderung, ziel) {
    var key = window.OPLLastenheft.schluessel(kategorie, unterthema);
    return fetch('/api/ziele', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schluessel: key, anforderung: anforderung, ziel: ziel })
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (e) { throw new Error(T(e.error || 'Fehler')); });
      lhZiele = lhZiele || {};
      lhZiele[key] = { schluessel: key, anforderung: anforderung, ziel: ziel };
    });
  }

  function zielBearbeiten(kategorie, unterthema) {
    var key = window.OPLLastenheft.schluessel(kategorie, unterthema);
    var z = (lhZiele || {})[key] || {};
    $('#zielTitel').textContent = unterthema ? T(kategorie) + ' › ' + T(unterthema) : T(kategorie);
    $('#zielAnforderung').value = z.anforderung || '';
    $('#zielZiel').value = z.ziel || '';
    var d = $('#dlgZiel');
    d.dataset.kategorie = kategorie;
    d.dataset.unterthema = unterthema || '';
    d.showModal();
    $('#zielAnforderung').focus();
  }

  function kategorieWaehlen() {
    var sel = $('#katExportWahl');
    var vorher = sel.value;
    sel.textContent = '';
    Store.THEMEN.forEach(function (t) {
      var n = Store.state.entries.filter(function (e) { return e.thema === t && e.status !== 'Erledigt'; }).length;
      var fo = (lhForderungen || []).filter(function (f) { return f.kategorie === t; }).length;
      var o = el('option', null, T(t) + ' – ' + T('{o} offen', { o: n }) + ', ' + T('{n} Forderungen', { n: fo }));
      o.value = t;
      sel.appendChild(o);
    });
    if (vorher) sel.value = vorher;
    $('#dlgKatExport').showModal();
  }

  // Bild (URL oder data-URL) laden und als JPEG (max. 1000 px) mit Groesse liefern
  function bildAlsJpeg(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var f = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * f)), h = Math.max(1, Math.round(img.naturalHeight * f));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        c.toBlob(function (blob) {
          if (!blob) { resolve(null); return; }
          blob.arrayBuffer().then(function (buf) { resolve({ data: new Uint8Array(buf), w: w, h: h }); }, function () { resolve(null); });
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  // { nr: [{ data, w, h }] } fuer die angegebenen Punkte, je Punkt hoechstens 2 Bilder
  function bilderFuerWord(nrs) {
    var map = {}, jobs = [];
    nrs.forEach(function (nr) {
      var e = Store.byNr(nr);
      ((e && e.bilder) || []).filter(function (b) { return b && b.src; }).slice(0, 2).forEach(function (b, i) {
        jobs.push(bildAlsJpeg(b.src).then(function (r) {
          if (r) (map[nr] = map[nr] || [])[i] = r;
        }));
      });
    });
    return Promise.all(jobs).then(function () {
      Object.keys(map).forEach(function (nr) { map[nr] = map[nr].filter(Boolean); });
      return map;
    });
  }

  function lastenheftExportKategorie(kategorie) {
    var stand = Xlsx.ddmmyyyy(Store.heute());
    var name = '4NE1_Gen4_Forderungen_' + kategorie.replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '-').replace(/^-|-$/g, '') + '_' + dateiStempel() + '.docx';
    toast(T('Word wird erstellt, Bilder werden geladen …'));
    var nrs = window.OPLLastenheft.kategorieNrs(Store.state.entries, kategorie, lhForderungen || []);
    bilderFuerWord(nrs).then(function (bilder) {
      download(window.OPLLastenheft.exportKategorie(Store.state.entries, kategorie, stand,
        { ziele: lhZiele || {}, forderungen: lhForderungen || [], bilder: bilder }), name);
      toast(T('Word für „{k}“ exportiert.', { k: T(kategorie) }));
    }).catch(function (err) { toast(T('Export fehlgeschlagen: {msg}', { msg: err.message }), true); });
  }

  function lastenheftExport(art) {
    var auswahl = exportEintraege();
    if (!auswahl.length) { toast(T('Keine Punkte im aktuellen Filter – nichts zu exportieren.'), true); return; }
    var stand = Xlsx.ddmmyyyy(Store.heute());
    var hinweis = filterAktiv() ? T('Gefilterter Auszug: {n} von {g} OPL-Punkten.', { n: auswahl.length, g: Store.state.entries.length }) : '';
    if (art === 'kurz') {
      download(window.OPLLastenheft.exportKurzfassung(auswahl, stand, { ziele: lhZiele || {}, forderungen: lhForderungen || [], filterHinweis: hinweis, heute: Store.heute() }),
        '4NE1_Gen4_Management-Kurzfassung_' + dateiStempel() + (filterAktiv() ? '_gefiltert' : '') + '.docx');
      toast(T('Management-Kurzfassung exportiert.') + exportHinweis());
      return;
    }
    var name = '4NE1_Gen4_Lastenheft_' + dateiStempel() + (filterAktiv() ? '_gefiltert' : '') + '.' + art;
    var blob = art === 'docx'
      ? window.OPLLastenheft.exportDocx(auswahl, stand, { ziele: lhZiele || {}, filterHinweis: hinweis })
      : window.OPLLastenheft.exportXlsx(auswahl, stand, lhZiele || {}, lhForderungen || []);
    download(blob, name);
    toast(T('Lastenheft exportiert ({n} Anforderungen).', { n: auswahl.length }) + exportHinweis());
  }

  // Aus Excel uebernehmen: Tabelle "Auf einen Blick" (Kategorie/Unterthema/Anforderung/Ziel)
  // und/oder Tabelle je OPL-Punkt (OPL-Nr + Anforderung/Titel/Unterthema)
  function lastenheftTexteUebernehmen(datei) {
    datei.arrayBuffer().then(function (buf) {
      return Xlsx.importForderungen(buf).then(function (fo) {
        return fo.length ? forderungenUebernehmen(fo) : false;
      }).then(function (hatteFo) {
        return Xlsx.importZiele(buf).then(function (ziele) { return { ziele: ziele, hatteFo: hatteFo }; });
      }).then(function (x) {
        var ziele = x.ziele;
        return (ziele.length ? zieleUebernehmen(ziele) : Promise.resolve(false)).then(function (hatteZiele) {
          return Xlsx.importAnforderungen(buf).then(punkteUebernehmen, function (err) {
            if (!hatteZiele && !x.hatteFo) throw err; // weder Forderungen, Ziele noch Punkte in der Datei
          });
        });
      });
    }).catch(function (err) {
      toast(T('Datei konnte nicht gelesen werden: {msg}', { msg: err.message }), true);
    });
  }

  function zieleUebernehmen(ziele) {
    var ungueltig = 0, gleich = 0;
    var neu = ziele.filter(function (z) {
      var ok = Store.istThema(z.kategorie) && (!z.unterthema || Store.unterthemenVon(z.kategorie).indexOf(z.unterthema) >= 0);
      if (!ok) { ungueltig++; return false; }
      var alt = (lhZiele || {})[window.OPLLastenheft.schluessel(z.kategorie, z.unterthema)] || {};
      if ((alt.anforderung || '') === z.anforderung && (alt.ziel || '') === z.ziel) { gleich++; return false; }
      return true;
    });
    if (!neu.length) {
      toast(T('Anforderung/Ziel: nichts Neues ({g} unverändert, {u} unbekannte Kategorien/Unterthemen).', { g: gleich, u: ungueltig }));
      return Promise.resolve(true);
    }
    if (!confirm(T('Anforderung und Ziel für {n} Kategorien/Unterthemen übernehmen?', { n: neu.length }) +
      (ungueltig ? '\n' + T('{n} Zeilen mit unbekannter Kategorie bzw. Unterthema werden übersprungen.', { n: ungueltig }) : ''))) return Promise.resolve(true);
    return neu.reduce(function (kette, z) {
      return kette.then(function () { return zielSpeichern(z.kategorie, z.unterthema, z.anforderung, z.ziel); });
    }, Promise.resolve()).then(function () {
      toast(T('Anforderung und Ziel für {n} Kategorien/Unterthemen übernommen.', { n: neu.length }));
      render();
      return true;
    });
  }

  function punkteUebernehmen(zeilen) {
    return Promise.resolve(zeilen).then(function (zeilen) {
      var unbekannt = 0, gleich = 0, ueberschreibt = 0, unpassend = 0;
      var patches = [];
      zeilen.forEach(function (z) {
        var e = Store.byNr(z.nr);
        if (!e) { unbekannt++; return; }
        var patch = {};
        if (z.anforderung && z.anforderung !== e.anforderung) patch.anforderung = z.anforderung;
        if (z.titel && z.titel !== e.lhTitel) patch.lhTitel = z.titel;
        if (z.unterthema && z.unterthema !== e.unterthema) {
          // nur Unterthemen, die zur Kategorie der Karte gehoeren
          if (Store.unterthemenVon(e.thema).indexOf(z.unterthema) >= 0) patch.unterthema = z.unterthema;
          else unpassend++;
        }
        if (!Object.keys(patch).length) { gleich++; return; }
        if (e.anforderung && patch.anforderung) ueberschreibt++;
        patches.push({ nr: z.nr, patch: patch });
      });
      if (!patches.length) {
        toast(T('Nichts zu übernehmen: {g} Texte sind schon aktuell, {u} OPL-Nummern unbekannt.', { g: gleich, u: unbekannt }));
        return;
      }
      var nUt = patches.filter(function (x) { return x.patch.unterthema; }).length;
      var nAnf = patches.filter(function (x) { return x.patch.anforderung || x.patch.lhTitel; }).length;
      var frage = T('{n} Karten aktualisieren? ({a} mit Anforderungstext, {u} mit Unterthema)', { n: patches.length, a: nAnf, u: nUt }) +
        (unpassend ? '\n' + T('{n} Unterthemen passen nicht zur Kategorie der Karte – werden übersprungen.', { n: unpassend }) : '') +
        (ueberschreibt ? '\n' + T('Davon überschreiben {n} bereits vorhandene Texte.', { n: ueberschreibt }) : '') +
        (unbekannt ? '\n' + T('{n} OPL-Nummern aus der Datei gibt es im Board nicht – werden übersprungen.', { n: unbekannt }) : '');
      if (!confirm(frage)) return;
      toast(T('Übernehme Texte … {f} von {n}', { f: 0, n: patches.length }));
      Store.updateNacheinander(patches, function (fertig, gesamt) {
        if (fertig % 10 === 0 || fertig === gesamt) toast(T('Übernehme Texte … {f} von {n}', { f: fertig, n: gesamt }));
      }).then(function (n) {
        toast(T('{n} Karten aktualisiert.', { n: n }));
        render();
      });
    });
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
        baugruppen: Store.BAUGRUPPEN,
        nacharbeit: Store.NACHARBEIT,
        zielReleases: Store.ZIEL_RELEASES
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
                'Bis wann', 'Status', 'To Do', 'Bild', 'Erstellt am', 'Verantwortlichkeit', 'Baugruppe', 'Nacharbeit', 'Ziel-Release', 'Unterthema'];
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
        e.baugruppe,
        e.nacharbeit,
        e.zielRelease,
        e.unterthema
      ].map(q).join(';'));
    });
    // BOM, damit Excel UTF-8 erkennt
    var blob = new Blob(['﻿' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    download(blob, exportName('csv'));
    toast(T('CSV exportiert.') + exportHinweis());
  }

  // Bilder aus der Excel kommen in Originalgroesse (Handyfotos mehrere MB). Die
  // Datenbank nimmt je Punkt hoechstens ca. 2 MB an, sonst scheitert der ganze
  // Import. Darum: jedes Bild wie beim Hochladen auf max. 1400 px / JPEG bringen
  // und je Punkt ein Gesamtbudget einhalten (notfalls in Stufen kleiner rechnen).
  var BILD_BUDGET = 1500000; // Zeichen data-URL je Punkt

  function bildNeuKodieren(src, max, qualitaet) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * scale)); cv.height = Math.max(1, Math.round(img.height * scale));
        var g = cv.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        var neu = cv.toDataURL('image/jpeg', qualitaet);
        resolve({ src: neu.length < src.length || scale < 1 ? neu : src, gross: Math.max(img.width, img.height) });
      };
      img.onerror = function () { resolve({ src: src, gross: 0 }); };
      img.src = src;
    });
  }

  function importBilderVerkleinern(entries) {
    var anzahl = 0;
    var summe = function (e) { return e.bilder.reduce(function (n, b) { return n + (b.src || '').length; }, 0); };
    return Promise.all(entries.map(function (e) {
      var bilder = (e.bilder || []).filter(function (b) { return b.src && b.src.indexOf('data:') === 0; });
      anzahl += (e.bilder || []).length;
      if (!bilder.length) return null;
      // 1. Stufe: grosse Bilder auf 1400 px, kleine JPEGs (z. B. aus unserem Export) bleiben
      return Promise.all(bilder.map(function (b) {
        if (b.src.length < 600000 && /^data:image\/jpe?g/.test(b.src)) return null;
        return bildNeuKodieren(b.src, 1400, 0.82).then(function (r) { b.src = r.src; });
      })).then(function () {
        // 2. Stufe: Punkt insgesamt zu gross -> alle Bilder schrittweise kleiner
        var stufen = [[1200, 0.75], [1000, 0.7], [800, 0.65], [640, 0.6]];
        var naechste = function (i) {
          if (summe(e) <= BILD_BUDGET || i >= stufen.length) return null;
          return Promise.all(bilder.map(function (b) {
            return bildNeuKodieren(b.src, stufen[i][0], stufen[i][1]).then(function (r) { b.src = r.src; });
          })).then(function () { return naechste(i + 1); });
        };
        return naechste(0);
      });
    })).then(function () { return anzahl; });
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
      box.textContent = T('Bilder werden vorbereitet …');
      return importBilderVerkleinern(res.entries).then(function (anzahl) { res.bilderGesamt = anzahl; return res; });
    }).then(function (res) {
      importPuffer = res.entries;
      box.textContent = '';
      var vorhandene = {};
      Store.state.entries.forEach(function (e) { vorhandene[e.nr] = e; });
      var treffer = res.entries.filter(function (e) { return vorhandene[e.nr]; }).length;
      box.appendChild(el('div', null,
        T('✓ {n} Zeilen gelesen · {treffer} bestehende Punkte werden aktualisiert · {neu} neue Punkte',
          { n: res.entries.length, treffer: treffer, neu: res.entries.length - treffer }) +
        (res.bilderGesamt ? ' · ' + T('{b} Bilder in der Datei', { b: res.bilderGesamt }) : '')));
      // Bildaenderungen je Punkt sichtbar machen (Anzahl im Board -> in der Datei).
      // Beim Zusammenfuehren ersetzt die Datei die Bilder eines Punkts, sofern sie dort welche hat.
      var bildDiff = res.entries.filter(function (e) {
        var alt = vorhandene[e.nr];
        return alt && e.bilder.length && e.bilder.length !== (alt.bilder || []).length;
      });
      var mehr = bildDiff.filter(function (e) { return e.bilder.length > vorhandene[e.nr].bilder.length; });
      var weniger = bildDiff.filter(function (e) { return e.bilder.length < vorhandene[e.nr].bilder.length; });
      var neuMitBild = res.entries.filter(function (e) { return !vorhandene[e.nr] && e.bilder.length; });
      if (bildDiff.length || neuMitBild.length) {
        box.appendChild(el('div', 'imp-bilder', T('🖼 Bilder: {m} Punkte mit zusätzlichen Bildern, {w} mit weniger Bildern, {n} neue Punkte mit Bildern',
          { m: mehr.length, w: weniger.length, n: neuMitBild.length })));
        var bl = el('ul');
        bildDiff.slice(0, 15).forEach(function (e) {
          bl.appendChild(el('li', null, '#' + e.nr + ': ' + T('{a} → {b} Bilder', { a: vorhandene[e.nr].bilder.length, b: e.bilder.length }) +
            (e.bilder.length < vorhandene[e.nr].bilder.length ? ' ' + T('(fehlende werden entfernt)') : '')));
        });
        if (bildDiff.length > 15) bl.appendChild(el('li', null, '…'));
        box.appendChild(bl);
      } else if (res.bilderGesamt) {
        box.appendChild(el('div', 'imp-bilder', T('🖼 Bilder: keine Änderung an der Anzahl je Punkt')));
      }
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

  var ROLLEN_ANZEIGE = { lesen: 'Lesen', bearbeiten: 'Bearbeiten', admin: 'Admin' };

  function adminAnfrage(method, pfad, daten) {
    return fetch(pfad, {
      method: method,
      headers: daten ? { 'content-type': 'application/json' } : undefined,
      body: daten ? JSON.stringify(daten) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var msg = T(d.error || 'unbekannter Fehler');
          if (d.ungueltig && d.ungueltig.length) msg += ': ' + d.ungueltig.join(', ');
          var err = new Error(msg);
          err.status = r.status;
          err.body = d;
          throw err;
        }
        return d;
      });
    });
  }

  function ladeAdminListe() {
    var box = $('#adminEmailListe');
    box.textContent = T('Lade …');
    adminAnfrage('GET', '/api/admin/emails').then(zeigeAdminListe).catch(function (err) {
      box.textContent = T('Konnte Liste nicht laden: {msg}', { msg: err.message });
    });
  }

  function zeigeAdminListe(liste) {
    var box = $('#adminEmailListe');
    box.textContent = '';
    var je = { lesen: 0, bearbeiten: 0, admin: 0 };
    liste.forEach(function (z) {
      je[z.rolle]++;
      var row = el('div', 'adminzeile');
      var mail = el('span', 'adminzeile__mail', z.email);
      if (z.extern) {
        var ext = el('span', 'adminzeile__extern', T('extern'));
        ext.title = T('Adresse außerhalb von NEURA');
        mail.appendChild(ext);
      }
      row.appendChild(mail);
      var sel = document.createElement('select');
      Object.keys(ROLLEN_ANZEIGE).forEach(function (r) { sel.appendChild(new Option(T(ROLLEN_ANZEIGE[r]), r)); });
      sel.value = z.rolle;
      var istHaupt = z.email === 'david.rybinski@neura-robotics.com';
      sel.disabled = istHaupt;
      sel.title = istHaupt ? T('Haupt-Admin, nicht änderbar') : T('Rolle ändern');
      sel.addEventListener('change', function () {
        adminAnfrage('POST', '/api/admin/emails', { email: z.email, rolle: sel.value })
          .then(function (l) { zeigeAdminListe(l); toast(T('{email}: Rolle {rolle}.', { email: z.email, rolle: T(ROLLEN_ANZEIGE[sel.value]) })); })
          .catch(function (err) { toast(err.message, true); ladeAdminListe(); });
      });
      row.appendChild(sel);
      if (!istHaupt) {
        var del = el('button', 'btn btn--ghost', T('✕ entfernen'));
        del.type = 'button';
        del.addEventListener('click', function () {
          if (!confirm(T('{email} den Zugang entziehen?', { email: z.email }))) return;
          adminAnfrage('DELETE', '/api/admin/emails/' + encodeURIComponent(z.email))
            .then(function (l) { zeigeAdminListe(l); toast(T('{email} entfernt.', { email: z.email })); })
            .catch(function () { toast(T('Entfernen fehlgeschlagen.'), true); });
        });
        row.appendChild(del);
      } else {
        row.appendChild(el('span', 'adminzeile__platz'));
      }
      box.appendChild(row);
    });
    $('#adminZaehler').textContent = T('{n} Zugänge · {l} Lesen · {b} Bearbeiten · {a} Admin',
      { n: liste.length, l: je.lesen, b: je.bearbeiten, a: je.admin });
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
    FILTER_FELDER.forEach(function (f) { mselBauen(f[0], f[1]); });
    $('#fmTeam').appendChild(new Option(T('– offen –'), ''));
    Store.VERANTWORTLICHKEITEN.forEach(function (v) {
      $('#fmTeam').appendChild(new Option(T(v), v));
    });
    $('#fmBaugruppe').appendChild(new Option(T('– offen –'), ''));
    Store.BAUGRUPPEN.forEach(function (v) {
      $('#fmBaugruppe').appendChild(new Option(T(v), v));
    });
    $('#fmSeite').appendChild(new Option('–', ''));
    Store.SEITEN.forEach(function (v) { $('#fmSeite').appendChild(new Option(T(v), v)); });
    $('#fmNacharbeit').appendChild(new Option(T('– keine –'), ''));
    Store.NACHARBEIT.forEach(function (v) { $('#fmNacharbeit').appendChild(new Option(T(v), v)); });
    $('#fmZielRelease').appendChild(new Option(T('– offen –'), ''));
    Store.ZIEL_RELEASES.forEach(function (v) { $('#fmZielRelease').appendChild(new Option(v, v)); });

    Store.onError(function (msg) { toast(msg, true); });
    Store.onStatus(function (ok) { $('#offlineBanner').hidden = ok; });
    Store.load();
    if (window.__OPL_LOGIN_USER) {
      Store.setUser(window.__OPL_LOGIN_USER);
    }
    Store.setRolle(window.__OPL_ROLLE);
    document.body.dataset.rolle = window.__OPL_ROLLE || 'bearbeiten';
    Store.subscribe(render);
    $('#userName').value = Store.state.user || '';

    // Filter
    var t;
    $('#suche').addEventListener('input', function (ev) {
      clearTimeout(t);
      var v = ev.target.value.trim().toLowerCase();
      t = setTimeout(function () { filter.suche = v; render(); }, 120);
    });
    document.addEventListener('click', mselAlleZu);
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var offen = $$('.msel__panel').filter(function (p) { return !p.hidden; })[0];
      if (offen) offen.parentNode.querySelector('.msel__btn').focus();
      mselAlleZu();
    });
    function resetFilter() {
      filter = leererFilter();
      quick = null;
      $('#suche').value = '';
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
        if (view === 'lastenheft') lhZieleLaden(); // Aenderungen anderer mitnehmen
        $$('.viewswitch button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        render();
      });
    });


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

    if (Store.darf('admin')) {
      $('#btnAdminMenu').hidden = false;
      $('#adminMenuDivider').hidden = false;
    }

    $('#formAdminAdd').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var input = $('#adminNeueEmail');
      // Nur die Adressen herausziehen – so geht auch eine kopierte Outlook-Liste
      // wie "Vorname Nachname <adresse>; ..."; Doppelte zaehlen einmal
      var emails = (input.value.toLowerCase().match(/[^\s<>,;:"'()\[\]]+@[^\s<>,;:"'()\[\]]+/g) || [])
        .filter(function (m, i, l) { return l.indexOf(m) === i; });
      if (!emails.length) return;
      var rolle = $('#adminNeueRolle').value;
      function senden(extern) {
        return adminAnfrage('POST', '/api/admin/emails', { emails: emails, rolle: rolle, extern: extern });
      }
      senden(false).catch(function (err) {
        // Externe Adressen (nicht @neura-robotics.com) nur nach ausdruecklicher Bestaetigung
        if (err.status !== 409 || !err.body || !err.body.extern) throw err;
        var ok = confirm(T('Externe Adresse(n) – nicht @neura-robotics.com:\n\n{liste}\n\nDiese Person(en) sehen dann alle OPL-Punkte inkl. Bilder. Wirklich freischalten?',
          { liste: err.body.extern.join('\n') }));
        if (!ok) { var abbruch = new Error(T('Abgebrochen – nichts freigeschaltet.')); abbruch.still = true; throw abbruch; }
        return senden(true);
      }).then(function (l) {
        input.value = '';
        zeigeAdminListe(l);
        toast(T('{n} Adresse(n) mit Rolle {rolle} freigeschaltet.', { n: emails.length, rolle: T(ROLLEN_ANZEIGE[rolle]) }));
      }).catch(function (err) {
        toast(err.message, !err.still);
      });
    });

    // Neuer Punkt (oben bzw. runder Knopf auf dem Smartphone)
    $('#btnNeu').addEventListener('click', function () { oeffneEdit(null); });
    $('#btnNeuFab').addEventListener('click', function () { oeffneEdit(null); });

    // Smartphone: Auswahlfilter auf- und zuklappen
    $('#btnFilterToggle').addEventListener('click', function () {
      var bar = $('.filterbar');
      var auf = !bar.classList.contains('is-offen');
      bar.classList.toggle('is-offen', auf);
      this.setAttribute('aria-expanded', String(auf));
      if (!auf) mselAlleZu();
    });

    // Edit-Dialog
    $('#fmThema').addEventListener('change', aktualisiereEditTitel);
    $('#fmThema').addEventListener('change', function () { unterthemaAuswahl($('#fmUnterthema').value); });
    // Verantwortlichkeit nach Person vorbelegen, solange sie leer ist
    // Erledigt ohne Ziel-Release → 4.1.1 vorschlagen (der Server setzt es ohnehin)
    $('#fmStatus').addEventListener('change', function () {
      if ($('#fmStatus').value === 'Erledigt' && !$('#fmZielRelease').value) $('#fmZielRelease').value = '4.1.1';
    });
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
    $('#formZiel').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var d = $('#dlgZiel');
      zielSpeichern(d.dataset.kategorie, d.dataset.unterthema, $('#zielAnforderung').value.trim(), $('#zielZiel').value.trim())
        .then(function () { d.close(); toast(T('Gespeichert.')); render(); })
        .catch(function (err) { toast(err.message, true); });
    });
    $('#formKatExport').addEventListener('submit', function (ev) {
      ev.preventDefault();
      $('#dlgKatExport').close();
      lastenheftExportKategorie($('#katExportWahl').value);
    });
    $('#formForderung').addEventListener('submit', function (ev) { ev.preventDefault(); forderungSpeichern(); });
    $('#btnFoLoeschen').addEventListener('click', forderungLoeschen);
    var vorTimer = null;
    ['#foText', '#foDetail'].forEach(function (sel) {
      $(sel).addEventListener('input', function () { clearTimeout(vorTimer); vorTimer = setTimeout(vorschlaegeZeigen, 300); });
    });
    $('#foBeispiele').addEventListener('input', function () {
      var drin = beispielNrsImFeld();
      $$('#foVorschlaege input[type=checkbox]').forEach(function (cb) { cb.checked = drin.indexOf(+cb.value) >= 0; });
    });
    $('#lhDatei').addEventListener('change', function (ev) {
      var f = ev.target.files[0];
      ev.target.value = '';
      if (f) lastenheftTexteUebernehmen(f);
    });
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
        : T('Import fertig: {a} Punkte aktualisiert, {n} neue Punkte.', { a: res.aktualisiert, n: res.neu }) +
          (res.bilderNeu ? ' ' + T('{b} zusätzliche Bilder.', { b: res.bilderNeu }) : ''));
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
