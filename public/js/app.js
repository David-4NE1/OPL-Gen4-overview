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
    ['#fZielRelease', 'zielRelease'], ['#fUnterthema', 'unterthema'], ['#fErsteller', 'ersteller']];
  function leererFilter() {
    return { suche: '', bereich: [], thema: [], prio: [], status: [], verant: [], team: [], baugruppe: [], nacharbeit: [], zielRelease: [], unterthema: [], ersteller: [] };
  }
  var filter = leererFilter();

  var PRIO_RANK = { 'Hoch': 0, 'Mittel': 1, 'Niedrig': 2 };
  var STATUS_RANK = { 'Open': 0, 'Assigned': 1, 'In Progress': 2, 'In Review': 3, 'Closed': 4, 'Canceled': 5 };

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
    if (!trifft(filter.ersteller, erstellerBasis(e))) return false;
    // "Re-Milling + Modification" erscheint unter beiden Filterwerten
    if (filter.nacharbeit.length && !filter.nacharbeit.some(function (v) {
      return v === '(keine)' ? !e.nacharbeit : (e.nacharbeit || '').indexOf(v) >= 0;
    })) return false;
    if (quick === 'offen' && Store.istErledigt(e)) return false;
    if (quick === 'erledigt' && !Store.istErledigt(e)) return false;
    if (quick === 'hoch' && !(e.prio === 'Hoch' && !Store.istErledigt(e))) return false;
    if (quick === 'mittel' && !(e.prio === 'Mittel' && !Store.istErledigt(e))) return false;
    if (quick === 'niedrig' && !(e.prio === 'Niedrig' && !Store.istErledigt(e))) return false;
    if (quick === 'ueberfaellig' && !Store.istUeberfaellig(e)) return false;
    if (quick === 'ohnekomp' && (Store.istErledigt(e) || (e.komponenten || '').trim())) return false;
    if (filter.suche) {
      var hay = [e.nr, e.thema, e.todo, e.verantwortlicher, e.verantwortlichkeit, e.baugruppe, e.nacharbeit, e.zielRelease, e.unterthema, e.komponenten, e.lhTitel, e.anforderung, e.bereich, e.notiz, e.erstelltVon,
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
    renderRoadmapBand(alle);
    mselFesteOptionen();
    fuelleThemaFilter(alle);
    fuelleVerantFilter(alle);
    fuelleErstellerFilter(alle);
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
        var ql = { offen: 'Offen', erledigt: 'Erledigt', hoch: 'Prio Hoch', mittel: 'Prio Mittel', niedrig: 'Prio Niedrig', ueberfaellig: 'Überfällig', ohnekomp: 'Offen ohne Komponente' };
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
      if (filter.ersteller.length) teile.push(T('Erstellt von: {v}', { v: werte('ersteller') }));
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
    if (view === 'auswertung') { content.appendChild(renderAuswertung(liste)); return; }
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

    var offeneListe = liste.filter(function (e) { return !Store.istErledigt(e); });
    var erledigt = liste.filter(function (e) { return Store.istErledigt(e); });

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
        var nErl = alleImBereich.filter(function (e) { return Store.istErledigt(e); }).length;
        var nArb = alleImBereich.filter(function (e) { return !Store.istErledigt(e) && e.status !== 'Open'; }).length;
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
    var c = el('article', 'card card--' + slug(e.prio) + (Store.istErledigt(e) ? ' card--erledigt' : ''));

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
      var created = el('p', 'card__created', e.erstelltAm
        ? (e.erstelltVon ? T('Erstellt: {datum} von {name}', { datum: Xlsx.ddmmyyyy(e.erstelltAm), name: e.erstelltVon })
          : T('Erstellt: {datum}', { datum: Xlsx.ddmmyyyy(e.erstelltAm) }))
        : '');
      var vl = el('button', 'card__verlauf', T('🕓 Verlauf'));
      vl.type = 'button';
      vl.title = T('Wer hat wann was geändert?');
      vl.addEventListener('click', function () { zeigeVerlauf(e.nr); });
      created.appendChild(vl);
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
    st.title = T('Klick: Status wechseln (Open → Assigned → In Progress → In Review → Closed)');
    st.addEventListener('click', function () { Store.cycle(e.nr, 'status'); });
    meta.appendChild(st);

    var ueberfaellig = Store.istUeberfaellig(e);
    var tage = tageBis(e.faellig);
    var due = el('button', 'chip chip--due' +
      (ueberfaellig ? ' is-overdue' : (tage != null && tage >= 0 && tage <= 7 && !Store.istErledigt(e) ? ' is-soon' : '')) +
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

    if (e.komponenten) {
      var ko = el('button', 'chip chip--komp', '🔩 ' + e.komponenten);
      ko.type = 'button';
      ko.title = T('Komponenten');
      ko.addEventListener('click', function () { oeffneEdit(e.nr, 'komponenten'); });
      meta.appendChild(ko);
    }

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
    { feld: 'komponenten', label: 'Komponenten' },
    { feld: 'nacharbeit', label: 'Nacharbeit' },
    { feld: 'zielRelease', label: 'Ziel-Release' },
    { feld: 'prio', label: 'Prio' },
    { feld: 'verantwortlicher', label: 'Verantwortlicher' },
    { feld: 'verantwortlichkeit', label: 'Verantwortlichkeit' },
    { feld: 'erstelltVon', label: 'Erstellt von' },
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
      var row = el('tr', Store.istErledigt(e) ? 'is-erledigt' : '');
      row.appendChild(el('td', null, String(e.nr)));
      row.appendChild(el('td', null, T(e.bereich)));
      row.appendChild(el('td', Store.istThema(e.thema) ? null : 'is-warn', Store.istThema(e.thema) ? T(e.thema) : (e.thema ? '⚠ ' + tx(e.thema) : '⚠')));
      row.appendChild(el('td', null, e.unterthema ? T(e.unterthema) : '–'));
      row.appendChild(el('td', null, e.baugruppe ? T(e.baugruppe) : '–'));
      row.appendChild(el('td', 'td-komp', e.komponenten || '–'));
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
      row.appendChild(el('td', 'td-ersteller', e.erstelltVon || '–'));

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

  /* ------------------------------------------------------ Auswertung */

  // Burn-down, Verantwortliche × Status, Ersteller und offene Punkte ohne
  // Komponente. Alles bezieht sich auf die gerade gefilterten Punkte.
  var abschluss = null; // nr -> Datum des Abschlusses (aus dem Protokoll)
  var awAlleVerant = false; // Verantwortliche: alle Zeilen statt der ersten 12

  function abschlussLaden() {
    if (abschluss) return;
    abschluss = {};
    fetch('/api/abschluss', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (l) {
      (l || []).forEach(function (z) { abschluss[z.nr] = String(z.wann || '').slice(0, 10); });
      if (view === 'auswertung') render();
    }).catch(function () {});
  }

  function wechsleAnsicht(v) {
    view = v;
    $$('.viewswitch button').forEach(function (x) { x.classList.toggle('is-active', x.dataset.view === v); });
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function isoTag(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function tagPlus(iso, n) {
    var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoTag(d);
  }
  function kurzDatum(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.'; }

  // Mehrere Namen in einem Feld ("A, B", "A / B", "A + B") einzeln zaehlen
  function personen(wert) {
    var l = String(wert || '').split(/\s*,\s*|\s+\/\s+|\s+\+\s+|\s+und\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    return l.length ? l : ['(offen)'];
  }

  function aKarte(titel, info, extraCls) {
    var k = el('section', 'aw-karte' + (extraCls ? ' ' + extraCls : ''));
    var h = el('header', 'aw-karte__kopf');
    h.appendChild(el('h2', null, titel));
    if (info) h.appendChild(el('p', null, info));
    k.appendChild(h);
    return k;
  }

  function renderAuswertung(liste) {
    abschlussLaden();
    releasesLaden();
    var w = el('div', 'aw');
    w.appendChild(renderBurndown(liste));
    var reihe = el('div', 'aw-reihe');
    reihe.appendChild(renderVerantStatus(liste));
    reihe.appendChild(renderErsteller(liste));
    w.appendChild(reihe);
    w.appendChild(renderOhneKomponente(liste));
    return w;
  }

  /* Burn-down: offene Punkte je Tag (angelegt bis dahin, noch nicht abgeschlossen) */
  function renderBurndown(liste) {
    var heute = Store.heute();
    var schluss = function (e) {
      if (!Store.istErledigt(e)) return null;
      return (abschluss && abschluss[e.nr]) || String(e.geaendertAm || e.erstelltAm || heute).slice(0, 10);
    };
    var punkte = liste.map(function (e) {
      return { a: String(e.erstelltAm || '').slice(0, 10) || heute, z: schluss(e) };
    });
    var rel = filter.zielRelease.length === 1 ? filter.zielRelease[0] : '';
    var relInfo = rel && releaseInfo && releaseInfo[rel];
    var zielTag = relInfo && relInfo.ziel ? String(relInfo.ziel).slice(0, 10) : '';

    var karte = aKarte(T('Burn-down: offene Punkte'), rel
      ? T('Ziel-Release {r}{z} · alle anderen aktiven Filter gelten mit', { r: rel, z: zielTag ? ' · ' + T('Zieltermin') + ' ' + Xlsx.ddmmyyyy(zielTag) : '' })
      : T('Alle gefilterten Punkte · Ziel-Release wählen für Soll-Linie zum Zieltermin'), 'aw-karte--bd');

    // Auswahl Ziel-Release
    var wahl = el('div', 'aw-chips');
    [''].concat(Store.ZIEL_RELEASES).forEach(function (r) {
      var b = el('button', 'aw-chip' + (r === rel || (!r && !filter.zielRelease.length) ? ' is-active' : ''), r || T('Alle'));
      b.type = 'button';
      b.addEventListener('click', function () { filter.zielRelease = r ? [r] : []; render(); });
      wahl.appendChild(b);
    });
    karte.appendChild(wahl);

    if (!punkte.length) { karte.appendChild(el('p', 'aw-leer', T('Keine Punkte im Filter.'))); return karte; }

    var start = punkte.reduce(function (m, p) { return p.a < m ? p.a : m; }, heute);
    var ende = heute;
    if (zielTag && zielTag > ende) ende = zielTag;
    var tage = [];
    for (var t = start; t <= ende && tage.length < 800; t = tagPlus(t, 1)) tage.push(t);
    var offen = tage.map(function (d) {
      if (d > heute) return null;
      return punkte.filter(function (p) { return p.a <= d && (!p.z || p.z > d); }).length;
    });
    var neu = tage.map(function (d) { return punkte.filter(function (p) { return p.a === d; }).length; });
    var fertig = tage.map(function (d) { return punkte.filter(function (p) { return p.z === d; }).length; });
    var iHeute = tage.indexOf(heute);
    var jetzt = offen[iHeute];

    // Kennzahlen
    var summe = function (arr, von, bis) { var s = 0; for (var i = Math.max(0, von); i <= bis; i++) s += arr[i] || 0; return s; };
    var neu7 = summe(neu, iHeute - 6, iHeute), fertig7 = summe(fertig, iHeute - 6, iHeute);
    var tempo = summe(fertig, iHeute - 27, iHeute) / 4; // abgeschlossen je Woche (4 Wochen)
    var netto = (summe(fertig, iHeute - 27, iHeute) - summe(neu, iHeute - 27, iHeute)) / 4;
    var prognose = netto > 0 ? tagPlus(heute, Math.ceil(jetzt / netto * 7)) : '';
    var kz = el('div', 'aw-kz');
    var kachel = function (wert, text, cls) {
      var k = el('div', 'aw-kz__k' + (cls ? ' ' + cls : ''));
      k.appendChild(el('strong', null, wert));
      k.appendChild(el('span', null, text));
      kz.appendChild(k);
    };
    kachel(String(jetzt), T('offen heute'));
    kachel('+' + neu7 + ' / −' + fertig7, T('neu / abgeschlossen (7 Tage)'));
    kachel(tempo.toFixed(1).replace('.', ','), T('abgeschlossen je Woche (Ø 4 Wochen)'));
    var progText = !jetzt ? T('alles abgeschlossen') : prognose ? Xlsx.ddmmyyyy(prognose) : T('keine – es kommt mehr dazu als fertig wird');
    var progCls = zielTag && jetzt ? (!prognose || prognose > zielTag ? 'is-schlecht' : 'is-gut') : '';
    kachel(progText, zielTag ? T('Prognose „alles erledigt“ · Ziel {z}', { z: Xlsx.ddmmyyyy(zielTag) }) : T('Prognose „alles erledigt“ (bei aktuellem Netto-Tempo)'), progCls);
    karte.appendChild(kz);

    // Diagramm (SVG)
    var W = 960, H = 280, L = 44, R = 64, O = 16, U = 30;
    var max = Math.max.apply(null, offen.filter(function (v) { return v != null; }).concat([1]));
    var schritt = max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : max <= 150 ? 25 : 50;
    var yMax = Math.ceil(max / schritt) * schritt;
    var x = function (i) { return L + (tage.length > 1 ? i / (tage.length - 1) : 0) * (W - L - R); };
    var y = function (v) { return O + (1 - v / yMax) * (H - O - U); };
    var ns = 'http://www.w3.org/2000/svg';
    var mk = function (tag, attrs, text) {
      var n = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text != null) n.textContent = text;
      return n;
    };
    var box = el('div', 'aw-bd');
    var svg = mk('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'aw-bd__svg', role: 'img',
      'aria-label': T('Burn-down: offene Punkte je Tag') });
    for (var v = 0; v <= yMax; v += schritt) {
      svg.appendChild(mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'aw-bd__grid' }));
      svg.appendChild(mk('text', { x: L - 8, y: y(v) + 4, class: 'aw-bd__achse', 'text-anchor': 'end' }, String(v)));
    }
    // x-Achse: Montage
    var abstand = tage.length > 120 ? 28 : tage.length > 60 ? 14 : 7;
    tage.forEach(function (d, i) {
      if (new Date(d + 'T12:00:00').getDay() === 1 && Math.round((new Date(d) - new Date(start)) / 864e5) % abstand < 7) {
        svg.appendChild(mk('text', { x: x(i), y: H - 10, class: 'aw-bd__achse', 'text-anchor': 'middle' }, kurzDatum(d)));
      }
    });
    // Flaeche + Linie (treppenfoermig bis heute)
    var pfad = '', i0 = 0;
    for (var i = 0; i <= iHeute; i++) {
      pfad += (i === 0 ? 'M' : 'H' + x(i) + 'V') + (i === 0 ? x(i) + ' ' + y(offen[i]) : y(offen[i]));
    }
    svg.appendChild(mk('path', { d: pfad + 'V' + y(0) + 'H' + x(i0) + 'Z', class: 'aw-bd__flaeche' }));
    svg.appendChild(mk('path', { d: pfad, class: 'aw-bd__linie' }));
    // Soll-Linie ab heute bis Zieltermin
    if (zielTag && zielTag > heute && jetzt) {
      var iZiel = tage.indexOf(zielTag);
      svg.appendChild(mk('line', { x1: x(iHeute), y1: y(jetzt), x2: x(iZiel), y2: y(0), class: 'aw-bd__soll' }));
    }
    if (zielTag && tage.indexOf(zielTag) >= 0) {
      var iz = tage.indexOf(zielTag);
      svg.appendChild(mk('line', { x1: x(iz), x2: x(iz), y1: O, y2: H - U, class: 'aw-bd__ziel' }));
      svg.appendChild(mk('text', { x: x(iz) - 4, y: O + 10, class: 'aw-bd__marke', 'text-anchor': 'end' }, T('Ziel {r}', { r: rel })));
    }
    svg.appendChild(mk('line', { x1: x(iHeute), x2: x(iHeute), y1: O, y2: H - U, class: 'aw-bd__heute' }));
    svg.appendChild(mk('text', { x: x(iHeute) + 4, y: O + 10, class: 'aw-bd__marke' }, T('Heute')));
    svg.appendChild(mk('circle', { cx: x(iHeute), cy: y(jetzt), r: 5, class: 'aw-bd__punkt' }));
    // Hover
    var cross = mk('line', { x1: 0, x2: 0, y1: O, y2: H - U, class: 'aw-bd__cross', visibility: 'hidden' });
    var dot = mk('circle', { cx: 0, cy: 0, r: 5, class: 'aw-bd__punkt', visibility: 'hidden' });
    svg.appendChild(cross); svg.appendChild(dot);
    var tip = el('div', 'aw-bd__tip'); tip.hidden = true;
    var fang = mk('rect', { x: L, y: O, width: W - L - R, height: H - O - U, fill: 'transparent' });
    svg.appendChild(fang);
    var zeige = function (ev) {
      var r = svg.getBoundingClientRect();
      var px = (ev.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(iHeute, Math.round((px - L) / (W - L - R) * (tage.length - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(offen[i])); dot.setAttribute('visibility', 'visible');
      tip.textContent = '';
      tip.appendChild(el('strong', null, Xlsx.ddmmyyyy(tage[i])));
      tip.appendChild(el('span', null, T('{n} offen', { n: offen[i] })));
      if (neu[i] || fertig[i]) tip.appendChild(el('span', 'aw-bd__tip-leise', '+' + neu[i] + ' ' + T('neu') + ' · −' + fertig[i] + ' ' + T('abgeschlossen')));
      tip.hidden = false;
      var links = x(i) / W * r.width;
      tip.style.left = Math.min(r.width - 170, Math.max(0, links + 12)) + 'px';
      tip.style.top = (y(offen[i]) / H * r.height - 20) + 'px';
    };
    fang.addEventListener('mousemove', zeige);
    fang.addEventListener('mouseleave', function () {
      tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
    });
    box.appendChild(svg);
    box.appendChild(tip);
    karte.appendChild(box);
    var leg = el('div', 'aw-legende');
    var li = function (cls, text) { var s = el('span'); s.appendChild(el('i', cls)); s.appendChild(document.createTextNode(text)); leg.appendChild(s); };
    li('aw-leg--ist', T('offen (Ist)'));
    if (zielTag && zielTag > heute) li('aw-leg--soll', T('Soll bis Zieltermin'));
    karte.appendChild(leg);
    karte.appendChild(el('p', 'aw-fuss', T('Abschlussdatum aus dem Änderungsprotokoll; ältere Abschlüsse ohne Protokoll zählen mit dem Datum der letzten Änderung.')));
    return karte;
  }

  /* Verantwortliche × Status */
  function renderVerantStatus(liste) {
    var karte = aKarte(T('Verantwortliche × Status'), T('Klick auf eine Zahl zeigt die Karten dazu'), 'aw-karte--vs');
    var zeilen = {};
    liste.forEach(function (e) {
      personen(e.verantwortlicher).forEach(function (p) {
        var z = zeilen[p] || (zeilen[p] = { name: p, roh: {}, st: {}, offen: 0, ueber: 0, n: 0 });
        z.roh[e.verantwortlicher || '(offen)'] = true;
        z.st[e.status] = (z.st[e.status] || 0) + 1;
        z.n++;
        if (!Store.istErledigt(e)) z.offen++;
        if (Store.istUeberfaellig(e)) z.ueber++;
      });
    });
    var reihen = Object.keys(zeilen).map(function (k) { return zeilen[k]; })
      .sort(function (a, b) { return b.offen - a.offen || b.n - a.n || a.name.localeCompare(b.name); });
    var maxZ = 1;
    reihen.forEach(function (z) { Store.STATI.forEach(function (s) { maxZ = Math.max(maxZ, z.st[s] || 0); }); });

    var wrap = el('div', 'aw-tabwrap');
    var t = el('table', 'aw-tab aw-tab--matrix');
    var hr = el('tr');
    hr.appendChild(el('th', 'aw-tab__name', T('Verantwortlich')));
    Store.STATI.forEach(function (s) {
      var th = el('th', 'aw-tab__zahl');
      th.appendChild(el('span', 'chip chip--status-' + slug(s), T(s)));
      hr.appendChild(th);
    });
    hr.appendChild(el('th', 'aw-tab__zahl', T('Offen')));
    hr.appendChild(el('th', 'aw-tab__zahl', T('Überfällig')));
    hr.appendChild(el('th', 'aw-tab__balken', T('Erledigt')));
    var th = el('thead'); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');
    var zelle = function (n, klick, cls, titel) {
      var td = el('td', 'aw-tab__zahl' + (cls ? ' ' + cls : ''));
      if (!n) { td.appendChild(el('span', 'aw-null', '·')); return td; }
      var b = el('button', 'aw-zahl', String(n));
      b.type = 'button';
      if (titel) b.title = titel;
      b.addEventListener('click', klick);
      td.appendChild(b);
      return td;
    };
    var gehe = function (z, status) {
      return function () {
        filter.verant = Object.keys(z.roh);
        filter.status = status || [];
        quick = null;
        wechsleAnsicht('karten');
      };
    };
    var summe = { st: {}, offen: 0, ueber: 0, n: 0 };
    var MAXZ = 12;
    reihen.forEach(function (z, idx) {
      var tr = el('tr', !awAlleVerant && idx >= MAXZ ? 'aw-weg' : '');
      tr.appendChild(el('td', 'aw-tab__name', z.name === '(offen)' ? T('(nicht zugeordnet)') : z.name));
      Store.STATI.forEach(function (s) {
        var n = z.st[s] || 0;
        summe.st[s] = (summe.st[s] || 0) + n;
        var td = zelle(n, gehe(z, [s]), null, z.name + ' · ' + T(s) + ': ' + n);
        if (n) td.style.setProperty('--aw-st', Math.round(8 + 42 * n / maxZ) + '%');
        tr.appendChild(td);
      });
      var offenStati = Store.STATI.filter(function (s) { return !Store.istErledigt(s); });
      tr.appendChild(zelle(z.offen, gehe(z, offenStati), 'aw-tab__fett'));
      var tdU = zelle(z.ueber, function () { filter.verant = Object.keys(z.roh); filter.status = []; quick = 'ueberfaellig'; wechsleAnsicht('karten'); }, z.ueber ? 'aw-tab__warn' : '');
      tr.appendChild(tdU);
      var pz = Math.round((z.n - z.offen) / z.n * 100);
      var tdB = el('td', 'aw-tab__balken');
      var bar = el('div', 'aw-bar'); var fill = el('i'); fill.style.width = pz + '%'; bar.appendChild(fill);
      tdB.appendChild(bar); tdB.appendChild(el('span', 'aw-bar__text', pz + ' %'));
      tr.appendChild(tdB);
      summe.offen += z.offen; summe.ueber += z.ueber; summe.n += z.n;
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var tf = el('tfoot'); var fr = el('tr');
    fr.appendChild(el('td', 'aw-tab__name', T('Summe Zuordnungen')));
    Store.STATI.forEach(function (s) { fr.appendChild(el('td', 'aw-tab__zahl', String(summe.st[s] || 0))); });
    fr.appendChild(el('td', 'aw-tab__zahl', String(summe.offen)));
    fr.appendChild(el('td', 'aw-tab__zahl', String(summe.ueber)));
    fr.appendChild(el('td', 'aw-tab__balken', summe.n ? Math.round((summe.n - summe.offen) / summe.n * 100) + ' %' : ''));
    tf.appendChild(fr); t.appendChild(tf);
    wrap.appendChild(t);
    karte.appendChild(wrap);
    if (reihen.length > MAXZ) {
      var mehr = el('button', 'aw-mehr', awAlleVerant ? T('Weniger anzeigen') : T('Alle {n} Personen anzeigen', { n: reihen.length }));
      mehr.type = 'button';
      mehr.addEventListener('click', function () { awAlleVerant = !awAlleVerant; render(); });
      karte.appendChild(mehr);
    }
    karte.appendChild(el('p', 'aw-fuss', T('Punkte mit mehreren Namen („A, B“) zählen bei jeder Person.')));
    return karte;
  }

  /* Wer hat die Punkte angelegt? */
  function renderErsteller(liste) {
    var karte = aKarte(T('Erstellt von'), T('Wer hat die Punkte angelegt?'), 'aw-karte--er');
    var heute = Store.heute(), vor7 = tagPlus(heute, -6);
    var m = {};
    liste.forEach(function (e) {
      var k = erstellerBasis(e);
      var z = m[k] || (m[k] = { name: k, n: 0, imp: 0, offen: 0, neu: 0, letzter: '' });
      z.n++;
      if (/\(Excel-Import\)\s*$/.test(e.erstelltVon || '')) z.imp++;
      if (!Store.istErledigt(e)) z.offen++;
      var a = String(e.erstelltAm || '').slice(0, 10);
      if (a >= vor7) z.neu++;
      if (a > z.letzter) z.letzter = a;
    });
    var reihen = Object.keys(m).map(function (k) { return m[k]; })
      .sort(function (a, b) { return (a.name === '(unbekannt)') - (b.name === '(unbekannt)') || b.n - a.n; });
    var maxN = Math.max.apply(null, reihen.map(function (z) { return z.n; }).concat([1]));
    var t = el('table', 'aw-tab aw-tab--er');
    var hr = el('tr');
    [['Person', 'aw-tab__name'], ['Angelegt', 'aw-tab__balken'], ['davon offen', 'aw-tab__zahl'], ['7 Tage', 'aw-tab__zahl'], ['zuletzt', 'aw-tab__zahl']]
      .forEach(function (h) { hr.appendChild(el('th', h[1], T(h[0]))); });
    var th = el('thead'); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');
    reihen.forEach(function (z) {
      var tr = el('tr', 'aw-klick');
      tr.title = T('Karten dieser Person anzeigen');
      tr.appendChild(el('td', 'aw-tab__name', z.name === '(unbekannt)' ? T('(unbekannt – vor Protokoll)') : z.name));
      var tdB = el('td', 'aw-tab__balken');
      var bar = el('div', 'aw-bar aw-bar--neutral'); var fill = el('i'); fill.style.width = Math.round(z.n / maxN * 100) + '%'; bar.appendChild(fill);
      tdB.appendChild(bar); tdB.appendChild(el('span', 'aw-bar__text', String(z.n)));
      if (z.imp) tdB.title = T('davon {n} per Excel-Import', { n: z.imp });
      tr.appendChild(tdB);
      tr.appendChild(el('td', 'aw-tab__zahl', String(z.offen)));
      tr.appendChild(el('td', 'aw-tab__zahl', z.neu ? '+' + z.neu : '·'));
      tr.appendChild(el('td', 'aw-tab__zahl aw-tab__leise', z.letzter ? Xlsx.ddmmyyyy(z.letzter) : '–'));
      tr.addEventListener('click', function () { filter.ersteller = [z.name]; quick = null; wechsleAnsicht('karten'); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var wrap = el('div', 'aw-tabwrap'); wrap.appendChild(t);
    karte.appendChild(wrap);
    karte.appendChild(el('p', 'aw-fuss', T('Ersteller steht auch auf jeder Karte, als Spalte in der Liste und als Filter „Alle Ersteller“.')));
    return karte;
  }

  /* Offene Punkte ohne Komponente */
  function renderOhneKomponente(liste) {
    var offen = liste.filter(function (e) { return !Store.istErledigt(e); });
    var ohne = offen.filter(function (e) { return !(e.komponenten || '').trim(); })
      .sort(function (a, b) { return PRIO_RANK[a.prio] - PRIO_RANK[b.prio] || a.nr - b.nr; });
    var pz = offen.length ? Math.round(ohne.length / offen.length * 100) : 0;
    var karte = aKarte(T('Offene Punkte ohne Komponente'),
      T('{n} von {m} offenen Punkten ({p} %) ist noch keine Komponente zugeordnet', { n: ohne.length, m: offen.length, p: pz }), 'aw-karte--ok');
    if (!ohne.length) { karte.appendChild(el('p', 'aw-leer', T('Alle offenen Punkte haben eine Komponente. 👍'))); return karte; }

    // Verteilung nach Baugruppe
    var bg = {};
    ohne.forEach(function (e) { var k = e.baugruppe || '(offen)'; bg[k] = (bg[k] || 0) + 1; });
    var verteilung = el('div', 'aw-verteilung');
    Store.BAUGRUPPEN.concat(['(offen)']).forEach(function (k) {
      if (!bg[k]) return;
      var b = el('button', 'aw-verteilung__k');
      b.type = 'button';
      b.appendChild(el('strong', null, String(bg[k])));
      b.appendChild(el('span', null, k === '(offen)' ? T('ohne Baugruppe') : T(k)));
      b.title = T('Diese Punkte als Karten anzeigen');
      b.addEventListener('click', function () { filter.baugruppe = [k]; quick = 'ohnekomp'; wechsleAnsicht('karten'); });
      verteilung.appendChild(b);
    });
    karte.appendChild(verteilung);

    var t = el('table', 'aw-tab aw-tab--ok');
    var hr = el('tr');
    [['Nr', 'aw-tab__zahl'], ['Prio', ''], ['Baugruppe', ''], ['To Do', 'aw-tab__todo'], ['Verantwortlich', ''], ['Erstellt von', ''], ['', '']]
      .forEach(function (h) { hr.appendChild(el('th', h[1], T(h[0]))); });
    var th = el('thead'); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');
    var GRENZE = 12;
    ohne.slice(0, GRENZE).forEach(function (e) {
      var tr = el('tr', 'aw-klick');
      tr.appendChild(el('td', 'aw-tab__zahl aw-tab__leise', String(e.nr)));
      var tdP = el('td'); var p = el('span', 'chip chip--static'); p.appendChild(el('span', 'chip__dot dot--' + slug(e.prio))); p.appendChild(el('span', null, T(e.prio))); tdP.appendChild(p);
      tr.appendChild(tdP);
      tr.appendChild(el('td', null, e.baugruppe ? T(e.baugruppe) : '–'));
      tr.appendChild(el('td', 'aw-tab__todo', tx(String(e.todo || '').split('\n')[0])));
      tr.appendChild(el('td', null, e.verantwortlicher || '–'));
      tr.appendChild(el('td', 'aw-tab__leise', e.erstelltVon || '–'));
      var tdE = el('td'); var b = el('button', 'aw-mini', T('+ Komponente')); b.type = 'button'; tdE.appendChild(b);
      tr.appendChild(tdE);
      tr.title = T('Punkt {nr} öffnen und Komponente eintragen', { nr: e.nr });
      tr.addEventListener('click', function () { oeffneEdit(e.nr); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var wrap = el('div', 'aw-tabwrap'); wrap.appendChild(t);
    karte.appendChild(wrap);
    var fuss = el('div', 'aw-fussleiste');
    if (ohne.length > GRENZE) fuss.appendChild(el('span', 'aw-tab__leise', T('… und {n} weitere', { n: ohne.length - GRENZE })));
    var alle = el('button', 'pillbtn', T('Alle {n} als Karten anzeigen', { n: ohne.length }));
    alle.type = 'button';
    alle.addEventListener('click', function () { quick = 'ohnekomp'; wechsleAnsicht('karten'); });
    fuss.appendChild(alle);
    karte.appendChild(fuss);
    return karte;
  }

  /* ------------------------------------------------ Roadmap-Band */

  // Ziel-Releases als Ringe (Anteil Closed/Canceled) mit Zieltermin und Status
  // aus der Release-Tabelle; Klick filtert die Karten auf dieses Ziel-Release.
  var releaseInfo = null;
  function releasesLaden() {
    if (releaseInfo) return;
    releaseInfo = {};
    fetch('/api/releases').then(function (r) { return r.ok ? r.json() : []; }).then(function (liste) {
      (liste || []).forEach(function (r) { releaseInfo[r.name] = r; });
      renderRoadmapBand(Store.state.entries);
      if (view === 'auswertung') render();
    }).catch(function () {});
  }

  function ring(prozent, gross) {
    var r = gross ? 44 : 34, u = 2 * Math.PI * r, d = gross ? 104 : 80;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + d + ' ' + d);
    svg.setAttribute('class', 'rmband__ring');
    [['rmband__ring-bg', 0], ['rmband__ring-fg', prozent]].forEach(function (k) {
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', d / 2); c.setAttribute('cy', d / 2); c.setAttribute('r', r);
      c.setAttribute('class', k[0]);
      if (k[0] === 'rmband__ring-fg' && !k[1]) return; // 0 %: kein Punkt am Ringanfang
      if (k[0] === 'rmband__ring-fg') {
        c.setAttribute('stroke-dasharray', (u * k[1] / 100) + ' ' + u);
        c.setAttribute('transform', 'rotate(-90 ' + d / 2 + ' ' + d / 2 + ')');
      }
      svg.appendChild(c);
    });
    return svg;
  }

  function renderRoadmapBand(alle) {
    var band = $('#rmBand');
    if (!band) return;
    releasesLaden();
    var heute = Store.heute();
    var spalten = [{ key: '(offen)', name: T('ohne Ziel'), leer: true }].concat(Store.ZIEL_RELEASES.map(function (n) {
      return { key: n, name: n, info: (releaseInfo || {})[n] || {} };
    }));
    // "Heute" hinter dem letzten Release, dessen Zieltermin schon erreicht ist
    var heuteNach = 0;
    spalten.forEach(function (s, i) { if (s.info && s.info.ziel && s.info.ziel <= heute) heuteNach = i; });

    band.textContent = '';
    band.hidden = false;
    var kopf = el('div', 'rmband__kopf');
    kopf.appendChild(el('strong', null, T('Roadmap')));
    kopf.appendChild(el('span', 'rmband__legende', T('◯ erledigt von allen Punkten mit diesem Ziel · Klick filtert die Karten')));
    band.appendChild(kopf);
    var spur = el('div', 'rmband__spur');
    spalten.forEach(function (s, i) {
      var punkte = alle.filter(function (e) { return (e.zielRelease || '(offen)') === s.key; });
      var fertig = punkte.filter(Store.istErledigt).length;
      var offen = punkte.length - fertig;
      var prozent = punkte.length ? Math.round(100 * fertig / punkte.length) : 0;
      var aktiv = filter.zielRelease.length === 1 && filter.zielRelease[0] === s.key;
      var item = el('button', 'rmband__item' + (s.leer ? ' rmband__item--leer' : '') + (aktiv ? ' is-active' : ''));
      item.type = 'button';
      item.title = aktiv ? T('Filter aufheben') : T('Karten auf dieses Ziel-Release filtern');
      var r = el('div', 'rmband__ringbox');
      r.appendChild(ring(s.leer ? 0 : prozent, !s.leer));
      r.appendChild(el('span', 'rmband__name', s.name));
      item.appendChild(r);
      if (!s.leer) item.appendChild(el('span', 'rmband__proz', prozent + ' %'));
      var info = s.info || {};
      if (s.leer) {
        item.appendChild(el('span', 'rmband__datum', T('nicht eingeplant')));
      } else if (info.ziel) {
        var tage = tageBis(info.ziel);
        var verzug = tage < 0 && offen > 0;
        item.appendChild(el('span', 'rmband__datum' + (verzug ? ' is-verzug' : ''),
          (verzug ? '⚠ ' : '') + Xlsx.ddmmyyyy(info.ziel) + (tage < 0 ? ' · ' + T('vor {n} T', { n: -tage }) : tage === 0 ? ' · ' + T('heute') : ' · ' + T('in {n} T', { n: tage }))));
      } else {
        item.appendChild(el('span', 'rmband__datum', T('ohne Zieldatum')));
      }
      if (info.status) item.appendChild(el('span', 'rmband__status', T(info.status)));
      var zahl = el('span', 'rmband__zahl');
      zahl.appendChild(el('b', null, String(offen)));
      zahl.appendChild(document.createTextNode(' ' + T('offen') + ' · ' + fertig + ' ' + T('erledigt')));
      item.appendChild(zahl);
      var bar = el('span', 'rmband__bar');
      var seg = el('span', 'rmband__bar-erl');
      seg.style.width = (punkte.length ? 100 * fertig / punkte.length : 0) + '%';
      bar.appendChild(seg);
      item.appendChild(bar);
      item.addEventListener('click', function () {
        filter.zielRelease = aktiv ? [] : [s.key];
        render();
      });
      spur.appendChild(item);
      if (i === heuteNach && !s.leer) {
        var h = el('div', 'rmband__heute');
        h.appendChild(el('span', 'rmband__heute-linie'));
        h.appendChild(el('span', 'rmband__heute-text', T('Heute') + '\n' + Xlsx.ddmmyyyy(heute).slice(0, 6)));
        spur.appendChild(h);
      }
    });
    band.appendChild(spur);
  }

  function renderKpis(alle) {
    var offen = alle.filter(function (e) { return !Store.istErledigt(e); });
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

  // Ersteller fuer Filter und Statistik: "Name (Excel-Import)" zaehlt beim Namen
  function erstellerBasis(e) {
    return String(e.erstelltVon || '').replace(/\s*\(Excel-Import\)\s*$/, '').trim() || '(unbekannt)';
  }

  function fuelleErstellerFilter(alle) {
    var namen = {};
    alle.forEach(function (e) { namen[erstellerBasis(e)] = true; });
    mselOptionen('#fErsteller', 'ersteller', Object.keys(namen).sort().map(function (n) { return [n, T(n)]; }));
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

  // To Do waechst mit dem Text, damit er ohne inneres Scrollen lesbar ist
  // (Obergrenze: gut die Haelfte der Fensterhoehe)
  function todoHoeheAnpassen() {
    var t = $('#fmTodo');
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight + 4, Math.max(160, Math.round(window.innerHeight * 0.55))) + 'px';
  }

  function oeffneEdit(nr, fokus) {
    if (nr == null && !Store.darf('bearbeiten')) return;
    editNr = nr == null ? null : nr;
    var e = nr == null ? null : Store.byNr(nr);
    $('#fmBereich').value = e ? e.bereich : (einzigerFilter('bereich') || Store.BEREICHE[0]);
    themaAuswahl(e ? e.thema : einzigerFilter('thema'));
    unterthemaAuswahl(e ? e.unterthema : einzigerFilter('unterthema'));
    $('#fmPrio').value = e ? e.prio : 'Mittel';
    $('#fmStatus').value = e ? e.status : 'Open';
    $('#fmVerant').value = e ? e.verantwortlicher : (Store.state.user || '');
    $('#fmTeam').value = e ? e.verantwortlichkeit : einzigerFilter('team');
    $('#fmBaugruppe').value = e ? (e.baugruppe || '') : einzigerFilter('baugruppe');
    $('#fmSeite').value = e ? (e.seite || '') : '';
    $('#fmNacharbeit').value = e ? (e.nacharbeit || '') : '';
    $('#fmZielRelease').value = e ? (e.zielRelease || '') : einzigerFilter('zielRelease');
    $('#fmKomponenten').value = e ? (e.komponenten || '') : '';
    $('#fmLhTitel').value = e ? (e.lhTitel || '') : '';
    $('#fmAnforderung').value = e ? (e.anforderung || '') : '';
    $('#fmFaellig').value = e ? e.faellig : '';
    $('#fmTodo').value = e ? e.todo : '';
    setTimeout(todoHoeheAnpassen, 0);
    $('#fmNotiz').value = e ? e.notiz : '';
    $('#fmBilder').value = '';
    $('#fmLangHint').hidden = !EN;
    aktualisiereEditTitel();
    editBilder = e ? Store.clone(e.bilder) : [];
    renderEditBilder();
    $('#btnDelete').hidden = !e;
    $('#btnVerlauf').hidden = !e;
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
      else if (fokus === 'komponenten') $('#fmKomponenten').focus();
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
      komponenten: Store.komponentenNormalisieren($('#fmKomponenten').value),
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
    var offen = function (v) { return !Store.istErledigt(v.e); };
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
      var zeile = el('label', 'fovor__zeile' + (Store.istErledigt(e) ? ' is-erledigt' : '') + (belegt[e.nr] ? ' is-belegt' : ''));
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
      txt.appendChild(el('small', null, ' · ' + T(e.thema) + (Store.istErledigt(e) ? ' · ' + T('erledigt') : '') +
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
      var n = Store.state.entries.filter(function (e) { return e.thema === t && !Store.istErledigt(e); }).length;
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

  /* ------------------------------------------------ Datenpaket Umzug */

  // Admin: ZIP mit allem, was fuer einen Umzug der OPL noetig ist – alle
  // Tabellen als JSON (Rohspalten wie in der Datenbank), Bilder als Dateien,
  // Schema, ein Skript zum Einspielen in SQLite und die Excel-Liste zum Ansehen.
  var MIME_ENDUNG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

  function datenpaketUmzug() {
    var enc = new TextEncoder();
    var dateien = [];
    function datei(name, inhalt) {
      dateien.push({ name: name, data: typeof inhalt === 'string' ? enc.encode(inhalt) : inhalt });
    }
    function jsonText(o) { return JSON.stringify(o, null, 2) + '\n'; }

    toast(T('Datenpaket wird erstellt …'));
    var d, bildStat = { ok: 0, fehler: 0, bytes: 0 };
    fetch('/api/admin/umzug', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (daten) {
      d = daten;
      if (d.format !== 'opl-umzug') throw new Error(T('Unerwartete Antwort vom Server'));
      // Bilder nacheinander (4 parallel) als Dateien holen
      var jobs = [];
      d.tabellen.entries.forEach(function (e) {
        e.bilder.forEach(function (b, k) {
          jobs.push({ e: e, b: b, k: k });
        });
      });
      var gesamt = jobs.length, fertig = 0, pos = 0;
      function weiter() {
        if (pos >= jobs.length) return Promise.resolve();
        var j = jobs[pos++];
        return fetch(j.b.src).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(function (blob) {
          return blob.arrayBuffer().then(function (buf) {
            var mime = (blob.type || '').split(';')[0].toLowerCase();
            var name = 'bilder/OPL-' + j.e.nr + '_' + (j.k + 1) + '.' + (MIME_ENDUNG[mime] || 'bin');
            datei(name, new Uint8Array(buf));
            j.b.datei = name;
            j.b.mime = mime || 'application/octet-stream';
            bildStat.ok++;
            bildStat.bytes += buf.byteLength;
          });
        }).catch(function (err) {
          console.error(err);
          j.b.fehler = String(err.message || err);
          bildStat.fehler++;
        }).then(function () {
          fertig++;
          if (fertig % 10 === 0 || fertig === gesamt) {
            toast(T('Datenpaket: Bilder {n} von {g} …', { n: fertig, g: gesamt }));
          }
          return weiter();
        });
      }
      return Promise.all([weiter(), weiter(), weiter(), weiter()]);
    }).then(function () {
      var t = d.tabellen;
      // Bildverweise durch Dateinamen ersetzen (src wuerde auf die alte Adresse zeigen)
      var punkte = t.entries.map(function (e) {
        return Object.assign({}, e, {
          bilder: e.bilder.map(function (b) {
            return b.datei ? { name: b.name, datei: b.datei, mime: b.mime } : { name: b.name, fehler: b.fehler || 'nicht geladen' };
          })
        });
      });
      var schemaSql = '-- Schema der OPL-Datenbank (Cloudflare D1 = SQLite), Stand ' + d.exportiert_am + '\n\n' +
        d.schema.map(function (s) {
          return String(s.sql).replace(/^CREATE (UNIQUE )?(TABLE|INDEX) (?!IF NOT EXISTS)/i, 'CREATE $1$2 IF NOT EXISTS ') + ';';
        }).join('\n\n') + '\n';
      var anzahl = {
        punkte: punkte.length,
        bilder: bildStat.ok,
        bilder_fehlend: bildStat.fehler,
        protokoll: t.changelog.length,
        forderungen: t.forderungen.length,
        lastenheft_ziele: t.lastenheft_ziele.length,
        releases: t.releases.length,
        zugriff: t.allowed_emails.length,
        einstellungen: t.settings.length
      };
      datei('daten/punkte.json', jsonText(punkte));
      datei('daten/protokoll.json', jsonText(t.changelog));
      datei('daten/forderungen.json', jsonText(t.forderungen));
      datei('daten/lastenheft_ziele.json', jsonText(t.lastenheft_ziele));
      datei('daten/releases.json', jsonText(t.releases));
      datei('daten/zugriff.json', jsonText({ admin_email: d.admin_email, rollen: d.rollen, freigaben: t.allowed_emails }));
      datei('daten/einstellungen.json', jsonText(t.settings));
      datei('daten/schema.sql', schemaSql);
      datei('manifest.json', jsonText({
        format: d.format, version: d.version, exportiert_am: d.exportiert_am,
        exportiert_von: Store.state.user || '', quelle: location.origin,
        anzahl: anzahl, bilder_bytes: bildStat.bytes,
        tabellen: {
          'daten/punkte.json': 'entries', 'daten/protokoll.json': 'changelog',
          'daten/forderungen.json': 'forderungen', 'daten/lastenheft_ziele.json': 'lastenheft_ziele',
          'daten/releases.json': 'releases', 'daten/zugriff.json': 'allowed_emails (freigaben)',
          'daten/einstellungen.json': 'settings'
        }
      }));
      datei('LIESMICH.txt', umzugLiesmich(d, anzahl).replace(/\n/g, '\r\n'));
      // Einspiel-Skript und Excel (zum Ansehen) dazu
      return Promise.all([
        Promise.all(['opl_umzug_einspielen.py', 'opl_umzug_einspielen.mjs', 'testbetrieb.ps1'].map(function (n) {
          return fetch('assets/umzug/' + n, { cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
            .then(function (buf) { datei(n, new Uint8Array(buf)); })
            .catch(function (err) { console.error(err); });
        })),
        mitBildDaten(Store.state.entries.slice().sort(function (a, b) { return a.nr - b.nr; })).then(function (entries) {
          return Xlsx.exportWorkbook(entries, {
            stand: Xlsx.ddmmyyyy(Store.heute()), bereiche: Store.BEREICHE, themen: Store.THEMEN,
            baugruppen: Store.BAUGRUPPEN, nacharbeit: Store.NACHARBEIT, zielReleases: Store.ZIEL_RELEASES
          }).arrayBuffer();
        }).then(function (buf) { datei('OPL_4NE1_Gen4_' + dateiStempel() + '.xlsx', new Uint8Array(buf)); })
      ]);
    }).then(function () {
      // Lesbare Dateien zuerst, Bilder ans Ende
      dateien.sort(function (a, b) {
        var ba = a.name.indexOf('bilder/') === 0, bb = b.name.indexOf('bilder/') === 0;
        return ba === bb ? (ba ? a.name.localeCompare(b.name, 'de', { numeric: true }) : 0) : (ba ? 1 : -1);
      });
      download(new Blob([Xlsx.zipBuild(dateien)], { type: 'application/zip' }),
        'OPL_4NE1_Gen4_Datenpaket-Umzug_' + dateiStempel() + '.zip');
      if (bildStat.fehler) {
        toast(T('Datenpaket erstellt, aber {f} Bilder fehlen (siehe LIESMICH.txt).', { f: bildStat.fehler }), true);
      } else {
        toast(T('Datenpaket erstellt: {p} Punkte, {b} Bilder, {l} Protokollzeilen.',
          { p: d.tabellen.entries.length, b: bildStat.ok, l: d.tabellen.changelog.length }));
      }
    }).catch(function (err) {
      console.error(err);
      toast(T('Datenpaket fehlgeschlagen: {msg}', { msg: err.message }), true);
    });
  }

  function umzugLiesmich(d, n) {
    var fehlend = d.tabellen.entries.filter(function (e) {
      return e.bilder.some(function (b) { return !b.datei; });
    }).map(function (e) { return e.nr; });
    return [
      'OPL 4NE1 Gen4 – Datenpaket Umzug',
      '================================',
      '',
      'Exportiert am: ' + d.exportiert_am + ' (UTC)',
      'Exportiert von: ' + (Store.state.user || '') + '',
      'Quelle: ' + location.origin,
      '',
      'INHALT',
      '------',
      '  ' + n.punkte + ' OPL-Punkte (daten/punkte.json, alle Spalten der Tabelle "entries")',
      '  ' + n.bilder + ' Bilder (Ordner bilder/, Name: OPL-<Nr>_<laufende Nr>.<Endung>)' +
        (n.bilder_fehlend ? '  – ' + n.bilder_fehlend + ' konnten NICHT geladen werden (Punkte: ' + fehlend.join(', ') + ')' : ''),
      '  ' + n.protokoll + ' Zeilen Änderungsprotokoll, vollständig (daten/protokoll.json)',
      '  ' + n.forderungen + ' Lastenheft-Forderungen inkl. Beschreibung und Beispielen (daten/forderungen.json)',
      '  ' + n.lastenheft_ziele + ' Lastenheft-Ziele (daten/lastenheft_ziele.json)',
      '  ' + n.releases + ' Releases der Roadmap (daten/releases.json)',
      '  ' + n.zugriff + ' freigeschaltete E-Mail-Adressen mit Rolle (daten/zugriff.json)',
      '  Einstellungen: Fokus-Kategorie im Lastenheft (daten/einstellungen.json)',
      '  daten/schema.sql – Tabellen und Indizes genau wie in der heutigen Datenbank',
      '  opl_umzug_einspielen.py – baut daraus eine fertige SQLite-Datenbank',
      '  OPL_4NE1_Gen4_<Datum>.xlsx – die OPL als Excel mit Bildern, nur zum Ansehen',
      '  manifest.json – Zähler und Zuordnung Datei → Tabelle (zur Kontrolle)',
      '  testbetrieb.ps1 + opl_umzug_einspielen.mjs – OPL mit diesen Daten testweise starten',
      '',
      'NICHT ENTHALTEN (bewusst)',
      '-------------------------',
      '  - Login-Passwort (OPL_PASSWORD) und Lese-Token (READ_TOKEN): liegen als Secret',
      '    in Cloudflare und werden auf dem neuen Server neu gesetzt.',
      '  - Sitzungsschlüssel: alle melden sich nach dem Umzug einmal neu an.',
      '  - Login-Fehlversuche, Änderungszähler und der Übersetzungs-Cache (DE→EN):',
      '    entstehen von selbst neu.',
      '  - Der Programmcode: liegt im Repository (worker/, public/).',
      '',
      'SO WIRD DARAUS EINE DATENBANK',
      '-----------------------------',
      '  ZIP entpacken, im entpackten Ordner (Python 3, keine Zusatzpakete):',
      '',
      '      python opl_umzug_einspielen.py',
      '',
      '  Ergebnis: opl.sqlite mit derselben Struktur wie heute in Cloudflare D1',
      '  (Bilder wieder als Daten in der Spalte "bilder"). Das Skript prüft die',
      '  Anzahl je Tabelle gegen manifest.json.',
      '',
      'TESTBETRIEB AUF EINEM WINDOWS-SERVER',
      '------------------------------------',
      '  Im entpackten Ordner in einer normalen PowerShell (keine Admin-Rechte nötig):',
      '',
      '      powershell -ExecutionPolicy Bypass -File .\\testbetrieb.ps1',
      '',
      '  Lädt Node.js (portabel), den Programmcode von GitHub und Wrangler in den',
      '  Unterordner "testbetrieb", fragt ein Test-Passwort ab, spielt die Daten ein',
      '  und startet die OPL unter http://localhost:8787. Nächster Start: dasselbe',
      '  Kommando (geht dann schnell). Optionen: -NeuEinspielen, -CodeAktualisieren,',
      '  -Port <Nr>. Nur zum Ausprobieren – Änderungen bleiben auf dem Server und',
      '  fließen nicht in die echte OPL zurück.',
      '',
      'HINWEISE',
      '--------',
      '  - Die Excel-Datei reicht für einen Umzug NICHT aus: Protokoll, Forderungen,',
      '    Ziele, Releases und Zugriffsliste fehlen darin.',
      '  - Das Paket enthält E-Mail-Adressen und Namen (Protokoll) – nur intern',
      '    ablegen und nicht weitergeben.',
      '  - Änderungen nach dem Exportzeitpunkt sind nicht enthalten. Für den echten',
      '    Umzug kurz vorher die OPL auf "nur lesen" stellen und neu exportieren.',
      ''
    ].join('\n');
  }

  function exportCsv() {
    var kopf = ['Nr', 'Bereich', 'Thema/Aufgabe', 'Prio', 'Verantwortlicher',
                'Bis wann', 'Status', 'To Do', 'Bild', 'Erstellt am', 'Verantwortlichkeit', 'Baugruppe', 'Nacharbeit', 'Ziel-Release', 'Unterthema', 'Komponenten', 'Ersteller'];
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
        e.unterthema,
        e.komponenten,
        e.erstelltVon
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
      var ohneNr = res.entries.filter(function (e) { return !e.nr; }).length;
      var maxNr = Store.state.entries.concat(res.entries).reduce(function (m, e) { return Math.max(m, +e.nr || 0); }, 0);
      box.appendChild(el('div', null,
        T('✓ {n} Zeilen gelesen · {treffer} bestehende Punkte werden aktualisiert · {neu} neue Punkte',
          { n: res.entries.length, treffer: treffer, neu: res.entries.length - treffer }) +
        (ohneNr ? ' · ' + T('{k} ohne Nr bekommen neue Nummern ab #{ab}', { k: ohneNr, ab: maxNr + 1 }) : '') +
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

  // Verlauf eines Punkts: alle Protokollzeilen mit Datum, Person und Änderung
  var VERLAUF_MUSTER = /^(\w+): "([\s\S]*)" → "([\s\S]*?)"(.*)$/;
  function zeigeVerlauf(nr) {
    var box = $('#verlaufListe');
    var e = Store.state.entries.filter(function (x) { return x.nr === nr; })[0];
    $('#verlaufTitel').textContent = T('Verlauf #{nr}', { nr: nr });
    box.textContent = '';
    if (e && (e.erstelltAm || e.erstelltVon)) {
      box.appendChild(el('p', 'verlauf__kopf', T('Erstellt: {datum}', { datum: Xlsx.ddmmyyyy(e.erstelltAm) }) +
        (e.erstelltVon ? ' · ' + e.erstelltVon : '') +
        (e.geaendertAm ? ' — ' + T('zuletzt geändert {wann} von {wer}', { wann: new Date(e.geaendertAm).toLocaleString(I18N.locale()), wer: e.geaendertVon || '?' }) : '')));
    }
    var liste = el('ol', 'verlauf__liste');
    liste.appendChild(el('li', null, T('Lade …')));
    box.appendChild(liste);
    $('#dlgVerlauf').showModal();
    fetch('/api/log?nr=' + nr).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (zeilen) {
      liste.textContent = '';
      if (!zeilen.length) {
        liste.appendChild(el('li', 'verlauf__leer', T('Für diesen Punkt sind keine Änderungen protokolliert (z. B. aus dem Excel-Startstand oder einem älteren Import).')));
        return;
      }
      zeilen.slice().reverse().forEach(function (z) {
        var li = el('li');
        li.appendChild(el('span', 'verlauf__wann', new Date(z.wann).toLocaleString(I18N.locale(), { dateStyle: 'short', timeStyle: 'short' })));
        li.appendChild(el('span', 'verlauf__wer', z.wer || T('unbekannt')));
        var m = VERLAUF_MUSTER.exec(z.text || '');
        var was = el('span', 'verlauf__was');
        if (m) {
          was.appendChild(el('b', null, T(Store.FELD_NAMEN[m[1]] || m[1]) + ': '));
          var alt = m[2] === '–' ? '' : m[2], neu = m[3] === '–' ? '' : m[3];
          // Lange Texte: nur den geaenderten Ausschnitt zeigen (gemeinsamen Anfang/Ende kuerzen)
          if (alt.length > 160 || neu.length > 160) {
            var a0 = 0, e0 = 0;
            while (a0 < alt.length && a0 < neu.length && alt[a0] === neu[a0]) a0++;
            while (e0 < alt.length - a0 && e0 < neu.length - a0 && alt[alt.length - 1 - e0] === neu[neu.length - 1 - e0]) e0++;
            var von = Math.max(0, a0 - 40);
            var aus = function (t) {
              var stueck = t.slice(von, t.length - Math.max(0, e0 - 40));
              if (stueck.length > 400) stueck = stueck.slice(0, 400) + ' …';
              return (von ? '… ' : '') + stueck + (e0 > 40 ? ' …' : '');
            };
            alt = aus(alt); neu = aus(neu);
          }
          was.appendChild(el('span', 'verlauf__alt', alt || '–'));
          was.appendChild(document.createTextNode(' → '));
          was.appendChild(el('span', 'verlauf__neu', neu || '–'));
          if (m[4]) was.appendChild(el('small', null, m[4]));
        } else {
          was.textContent = z.text;
        }
        li.appendChild(was);
        liste.appendChild(li);
      });
    }).catch(function () {
      liste.textContent = '';
      liste.appendChild(el('li', 'verlauf__leer', T('Verlauf konnte nicht geladen werden.')));
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
        if (view === 'auswertung') { abschlussLaden(); releasesLaden(); }
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
      else if (act === 'umzug') datenpaketUmzug();
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
      $('#btnUmzugMenu').hidden = false;
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
    // Closed ohne Ziel-Release → 4.1.1 vorschlagen (der Server setzt es ohnehin)
    $('#fmStatus').addEventListener('change', function () {
      if ($('#fmStatus').value === 'Closed' && !$('#fmZielRelease').value) $('#fmZielRelease').value = '4.1.1';
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

    $('#fmTodo').addEventListener('input', todoHoeheAnpassen);
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

    $('#btnVerlauf').addEventListener('click', function () { if (editNr) zeigeVerlauf(editNr); });
    $('#btnDelete').addEventListener('click', function () {
      if (editNr == null) return;
      if (!confirm(T('Punkt #{nr} wirklich löschen? Tipp: Status „Closed” oder „Canceled” behält die Historie.', { nr: editNr }))) return;
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
