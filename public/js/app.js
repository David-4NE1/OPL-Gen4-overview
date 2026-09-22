/*
 * app.js – Oberfläche des OPL-Tools.
 */
(function () {
  'use strict';

  var Store = window.OPLStore;
  var Xlsx = window.OPLXlsx;

  var view = 'karten';
  var sort = { feld: 'nr', richtung: 1 };
  var quick = null;                 // KPI-Schnellfilter
  var zugeklappt = {};              // Bereich -> true, wenn eingeklappt
  var erledigtOffen = false;
  var importPuffer = null;

  var filter = { suche: '', bereich: '', thema: '', prio: '', status: '', verant: '' };

  var PRIO_RANK = { 'Hoch': 0, 'Mittel': 1, 'Niedrig': 2 };
  var STATUS_RANK = { 'Offen': 0, 'In Arbeit': 1, 'Erledigt': 2 };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

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
    if (!iso) return 'kein Datum';
    var d = tageBis(iso);
    var txt = Xlsx.ddmmyyyy(iso);
    if (d === 0) return txt + ' · heute';
    if (d < 0) return txt + ' · ' + Math.abs(d) + ' T überfällig';
    if (d <= 7) return txt + ' · in ' + d + ' T';
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
    if (filter.thema && e.thema !== filter.thema) return false;
    if (filter.prio && e.prio !== filter.prio) return false;
    if (filter.status && e.status !== filter.status) return false;
    if (filter.verant) {
      var v = e.verantwortlicher || '(offen)';
      if (v !== filter.verant) return false;
    }
    if (quick === 'offen' && e.status === 'Erledigt') return false;
    if (quick === 'erledigt' && e.status !== 'Erledigt') return false;
    if (quick === 'hoch' && !(e.prio === 'Hoch' && e.status !== 'Erledigt')) return false;
    if (quick === 'mittel' && !(e.prio === 'Mittel' && e.status !== 'Erledigt')) return false;
    if (quick === 'niedrig' && !(e.prio === 'Niedrig' && e.status !== 'Erledigt')) return false;
    if (quick === 'ueberfaellig' && !Store.istUeberfaellig(e)) return false;
    if (filter.suche) {
      var hay = [e.nr, e.thema, e.todo, e.verantwortlicher, e.bereich, e.notiz]
        .join(' ').toLowerCase();
      if (hay.indexOf(filter.suche) < 0) return false;
    }
    return true;
  }

  function filterAktiv() {
    return !!(filter.suche || filter.bereich || filter.thema || filter.prio || filter.status || filter.verant || quick);
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
        teile.push(ql[quick] || quick);
      }
      if (filter.bereich) teile.push('Bereich: ' + filter.bereich);
      if (filter.thema) teile.push('Thema: ' + filter.thema);
      if (filter.prio) teile.push('Prio: ' + filter.prio);
      if (filter.status) teile.push('Status: ' + filter.status);
      if (filter.verant) teile.push('Verantwortlich: ' + filter.verant);
      if (filter.suche) teile.push('Suche: "' + filter.suche + '"');
      $('#filterBannerText').textContent = 'Zeige ' + liste.length + ' von ' + alle.length + ' Punkten — ' + teile.join(', ');
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    var content = $('#content');
    content.textContent = '';

    if (!liste.length) {
      var leer = el('div', 'empty');
      leer.appendChild(el('p', null, alle.length
        ? 'Keine Punkte passen zu Filter und Suche.'
        : 'Noch keine Punkte – lege den ersten an oder importiere eine Excel.'));
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
    head.appendChild(el('h2', null, istErledigtGruppe ? '✓ Erledigt' : titel));

    if (!istErledigtGruppe) {
      ['Hoch', 'Mittel', 'Niedrig'].forEach(function (p) {
        var n = eintraege.filter(function (e) { return e.prio === p; }).length;
        if (n) head.appendChild(el('span', 'pill pill--' + slug(p), n + '×' + p[0]));
      });
      var ueber = eintraege.filter(Store.istUeberfaellig).length;
      if (ueber) head.appendChild(el('span', 'pill pill--hoch', '⚠ ' + ueber + ' überfällig'));

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
        bar.title = nErl + ' erledigt, ' + nArb + ' in Arbeit, ' + nOff + ' offen';
        head.appendChild(bar);
      }
    }
    head.appendChild(el('span', 'group__count', eintraege.length + (eintraege.length === 1 ? ' Punkt' : ' Punkte')));

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
    top.appendChild(el('span', 'card__thema', e.thema || '(ohne Thema)'));
    var edit = el('button', 'card__edit', '✎');
    edit.type = 'button';
    edit.title = 'Bearbeiten';
    edit.setAttribute('aria-label', 'Punkt ' + e.nr + ' bearbeiten');
    edit.addEventListener('click', function () { oeffneEdit(e.nr); });
    top.appendChild(edit);
    c.appendChild(top);

    if (e.todo) c.appendChild(el('p', 'card__todo', e.todo));

    var meta = el('div', 'card__meta');

    var prio = el('button', 'chip');
    prio.type = 'button';
    prio.title = 'Klick: Prio wechseln (Hoch → Mittel → Niedrig)';
    prio.appendChild(el('span', 'chip__dot dot--' + slug(e.prio)));
    prio.appendChild(el('span', null, e.prio));
    prio.addEventListener('click', function () { Store.cycle(e.nr, 'prio'); });
    meta.appendChild(prio);

    var st = el('button', 'chip chip--status-' + slug(e.status), e.status);
    st.type = 'button';
    st.title = 'Klick: Status wechseln (Offen → In Arbeit → Erledigt)';
    st.addEventListener('click', function () { Store.cycle(e.nr, 'status'); });
    meta.appendChild(st);

    var ueberfaellig = Store.istUeberfaellig(e);
    var tage = tageBis(e.faellig);
    var due = el('button', 'chip chip--due' +
      (ueberfaellig ? ' is-overdue' : (tage != null && tage >= 0 && tage <= 7 && e.status !== 'Erledigt' ? ' is-soon' : '')) +
      (e.faellig ? '' : ' chip--none'), (ueberfaellig ? '⚠ ' : '📅 ') + datumLabel(e.faellig));
    due.type = 'button';
    due.title = 'Fälligkeit ändern';
    due.addEventListener('click', function () { oeffneEdit(e.nr, 'faellig'); });
    meta.appendChild(due);

    var vn = el('button', 'chip' + (e.verantwortlicher ? '' : ' chip--none'),
      '👤 ' + (e.verantwortlicher || 'offen'));
    vn.type = 'button';
    vn.title = 'Verantwortlichen setzen';
    vn.addEventListener('click', function () { oeffneEdit(e.nr, 'verant'); });
    meta.appendChild(vn);

    c.appendChild(meta);

    if (e.bilder && e.bilder.length) {
      var row = el('div', 'thumbrow');
      e.bilder.forEach(function (b) {
        var img = new Image();
        img.className = 'thumb';
        img.src = b.src;
        img.alt = b.name || ('Bild zu Punkt ' + e.nr);
        img.loading = 'lazy';
        img.addEventListener('click', function () { zeigeLightbox(b.src, img.alt); });
        row.appendChild(img);
      });
      c.appendChild(row);
    } else if (e.notiz) {
      c.appendChild(el('div', 'card__meta', '🖼 ' + e.notiz));
    }

    return c;
  }

  var SPALTEN = [
    { feld: 'nr', label: 'Nr' },
    { feld: 'bereich', label: 'Bereich' },
    { feld: 'thema', label: 'Thema/Aufgabe' },
    { feld: 'prio', label: 'Prio' },
    { feld: 'verantwortlicher', label: 'Verantwortlicher' },
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
      var th = el('th', null, s.label);
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
      row.appendChild(el('td', null, e.bereich));
      row.appendChild(el('td', null, e.thema));

      var tdP = el('td');
      var p = el('button', 'chip');
      p.type = 'button';
      p.appendChild(el('span', 'chip__dot dot--' + slug(e.prio)));
      p.appendChild(el('span', null, e.prio));
      p.addEventListener('click', function () { Store.cycle(e.nr, 'prio'); });
      tdP.appendChild(p);
      row.appendChild(tdP);

      row.appendChild(el('td', null, e.verantwortlicher || '–'));

      var tdD = el('td', null, e.faellig ? Xlsx.ddmmyyyy(e.faellig) : '–');
      if (Store.istUeberfaellig(e)) { tdD.style.color = 'var(--hoch)'; tdD.style.fontWeight = '700'; }
      row.appendChild(tdD);

      var tdS = el('td');
      var s = el('button', 'chip chip--status-' + slug(e.status), e.status);
      s.type = 'button';
      s.addEventListener('click', function () { Store.cycle(e.nr, 'status'); });
      tdS.appendChild(s);
      row.appendChild(tdS);

      row.appendChild(el('td', 'col-todo', e.todo));
      row.appendChild(el('td', null, e.notiz || (e.bilder.length ? e.bilder.length + ' Bild(er)' : '')));

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
    $('#standLine').textContent = 'Open Point List · ' + alle.length + ' Punkte · Stand ' +
      Xlsx.ddmmyyyy(Store.heute());
  }

  function fuelleVerantFilter(alle) {
    var sel = $('#fVerant');
    var namen = {};
    alle.forEach(function (e) { namen[e.verantwortlicher || '(offen)'] = true; });
    var liste = Object.keys(namen).sort();
    var aktuell = filter.verant;
    sel.textContent = '';
    sel.appendChild(new Option('Alle Verantwortlichen', ''));
    liste.forEach(function (n) { sel.appendChild(new Option(n, n)); });
    sel.value = liste.indexOf(aktuell) >= 0 ? aktuell : '';
    if (sel.value !== aktuell) filter.verant = sel.value;

    var dl = $('#personen');
    dl.textContent = '';
    liste.filter(function (n) { return n !== '(offen)'; })
      .forEach(function (n) { dl.appendChild(new Option(n)); });
  }

  function fuelleThemaFilter(alle) {
    var sel = $('#fThema');
    var themen = {};
    alle.forEach(function (e) { if (e.thema) themen[e.thema] = true; });
    var liste = Object.keys(themen).sort();
    var aktuell = filter.thema;
    sel.textContent = '';
    sel.appendChild(new Option('Alle Themen', ''));
    liste.forEach(function (t) { sel.appendChild(new Option(t, t)); });
    sel.value = liste.indexOf(aktuell) >= 0 ? aktuell : '';
    if (sel.value !== aktuell) filter.thema = sel.value;

    var dl = $('#themenListe');
    dl.textContent = '';
    liste.forEach(function (t) { dl.appendChild(new Option(t)); });
  }

  /* ---------------------------------------------------------- Lightbox */

  function zeigeLightbox(src, alt) {
    $('#lightboxImg').src = src;
    $('#lightboxImg').alt = alt || '';
    $('#lightbox').hidden = false;
  }

  /* ------------------------------------------------------ Edit-Dialog */

  var editNr = null;
  var editBilder = [];
  var editListe = [];

  function fuelleSelect(sel, werte) {
    sel.textContent = '';
    werte.forEach(function (w) { sel.appendChild(new Option(w, w)); });
  }

  function aktualisiereEditTitel() {
    var thema = $('#fmThema').value.trim();
    var bereich = $('#fmBereich').value;
    $('#dlgEditTitle').textContent = thema || (editNr == null ? 'Neuer Punkt' : 'Punkt #' + editNr);
    var sub = $('#dlgEditSub');
    if (editNr == null) {
      sub.textContent = bereich;
      sub.hidden = false;
    } else {
      sub.textContent = '#' + editNr + ' · ' + bereich;
      sub.hidden = false;
    }
  }

  function oeffneEdit(nr, fokus) {
    editNr = nr == null ? null : nr;
    var e = nr == null ? null : Store.byNr(nr);
    $('#fmBereich').value = e ? e.bereich : (filter.bereich || Store.BEREICHE[0]);
    $('#fmThema').value = e ? e.thema : '';
    $('#fmPrio').value = e ? e.prio : 'Mittel';
    $('#fmStatus').value = e ? e.status : 'Offen';
    $('#fmVerant').value = e ? e.verantwortlicher : (Store.state.user || '');
    $('#fmFaellig').value = e ? e.faellig : '';
    $('#fmTodo').value = e ? e.todo : '';
    $('#fmNotiz').value = e ? e.notiz : '';
    $('#fmBilder').value = '';
    aktualisiereEditTitel();
    editBilder = e ? Store.clone(e.bilder) : [];
    renderEditBilder();
    $('#btnDelete').hidden = !e;

    if (e && !editListe.length) {
      editListe = Store.state.entries.filter(sichtbar).map(function (x) { return x.nr; });
    }
    var hasNav = e && editListe.length > 1;
    $('#editNav').hidden = !hasNav;
    $('#btnSaveNext').hidden = !hasNav;
    if (hasNav) {
      var idx = editListe.indexOf(nr);
      $('#editPos').textContent = (idx + 1) + ' von ' + editListe.length;
    }

    if (!$('#dlgEdit').open) $('#dlgEdit').showModal();
    setTimeout(function () {
      if (fokus === 'faellig') $('#fmFaellig').focus();
      else if (fokus === 'verant') $('#fmVerant').focus();
      else $('#fmThema').focus();
    }, 30);
  }

  function editSpeichern() {
    var data = {
      bereich: $('#fmBereich').value,
      thema: $('#fmThema').value.trim(),
      prio: $('#fmPrio').value,
      status: $('#fmStatus').value,
      verantwortlicher: $('#fmVerant').value.trim(),
      faellig: $('#fmFaellig').value,
      todo: $('#fmTodo').value.trim(),
      notiz: $('#fmNotiz').value.trim(),
      bilder: editBilder
    };
    if (!data.thema) { toast('Bitte ein Thema angeben.', true); return false; }
    if (editNr == null) {
      var neu = Store.add(data);
      toast('Punkt #' + neu.nr + ' angelegt.');
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
      img.addEventListener('click', function () { zeigeLightbox(b.src, b.name); });
      var x = el('button', null, '✕');
      x.type = 'button';
      x.title = 'Bild entfernen';
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
      reader.onerror = function () { reject(new Error('Datei nicht lesbar: ' + file.name)); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Kein gültiges Bild: ' + file.name)); };
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

  function exportXlsx() {
    try {
      var blob = Xlsx.exportWorkbook(Store.state.entries, {
        stand: Xlsx.ddmmyyyy(Store.heute()),
        bereiche: Store.BEREICHE
      });
      download(blob, 'OPL_4NE1_Gen4_' + dateiStempel() + '.xlsx');
      toast('Excel exportiert – gleiches Schema wie die bestehende Liste.');
    } catch (err) {
      console.error(err);
      toast('Excel-Export fehlgeschlagen: ' + err.message, true);
    }
  }

  function exportCsv() {
    var kopf = ['Nr', 'Bereich', 'Thema/Aufgabe', 'Prio', 'Verantwortlicher',
                'Bis wann', 'Status', 'To Do', 'Bild'];
    function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    var zeilen = [kopf.map(q).join(';')];
    Store.state.entries.forEach(function (e) {
      zeilen.push([e.nr, e.bereich, e.thema, e.prio, e.verantwortlicher,
        Xlsx.ddmmyyyy(e.faellig), e.status, e.todo,
        e.notiz || (e.bilder.length ? e.bilder.length + ' Bild(er) im Tool' : '')
      ].map(q).join(';'));
    });
    // BOM, damit Excel UTF-8 erkennt
    var blob = new Blob(['﻿' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    download(blob, 'OPL_4NE1_Gen4_' + dateiStempel() + '.csv');
    toast('CSV exportiert.');
  }

  function vorschauImport(file) {
    var box = $('#impVorschau');
    box.hidden = false;
    box.textContent = 'Datei wird gelesen …';
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
        '✓ ' + res.entries.length + ' Zeilen gelesen · ' + treffer +
        ' davon mit bekannter Nr · ' + (res.entries.length - treffer) + ' neu'));
      if (res.warnungen.length) {
        box.appendChild(el('div', null, '⚠ ' + res.warnungen.length + ' Hinweis(e):'));
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

  /* ---------------------------------------------------------- Protokoll */

  function zeigeLog() {
    var box = $('#logList');
    box.textContent = '';
    var eintraege = Store.state.log.slice().reverse();
    if (!eintraege.length) {
      box.appendChild(el('div', null, 'Noch keine Änderungen protokolliert.'));
    }
    eintraege.forEach(function (l) {
      var d = el('div');
      var b = el('b', null, l.nr ? '#' + l.nr + ' ' : 'Liste ');
      d.appendChild(b);
      d.appendChild(document.createTextNode(l.text + ' '));
      d.appendChild(el('span', null, '— ' + l.wer + ', ' +
        new Date(l.wann).toLocaleString('de-DE')));
      box.appendChild(d);
    });
    $('#dlgLog').showModal();
  }

  /* --------------------------------------------------------------- Init */

  function init() {
    fuelleSelect($('#fmBereich'), Store.BEREICHE);
    fuelleSelect($('#fmPrio'), Store.PRIOS);
    fuelleSelect($('#fmStatus'), Store.STATI);
    Store.BEREICHE.forEach(function (b) { $('#fBereich').appendChild(new Option(b, b)); });
    Store.PRIOS.forEach(function (p) { $('#fPrio').appendChild(new Option(p, p)); });
    Store.STATI.forEach(function (s) { $('#fStatus').appendChild(new Option(s, s)); });

    Store.onError(function (msg) { toast(msg, true); });
    if (window.__OPL_LOGIN_USER) {
      Store.setUser(window.__OPL_LOGIN_USER);
    }
    Store.load();
    Store.subscribe(render);
    $('#userName').value = Store.state.user || window.__OPL_LOGIN_USER || '';

    // Filter
    var t;
    $('#suche').addEventListener('input', function (ev) {
      clearTimeout(t);
      var v = ev.target.value.trim().toLowerCase();
      t = setTimeout(function () { filter.suche = v; render(); }, 120);
    });
    [['#fBereich', 'bereich'], ['#fThema', 'thema'], ['#fPrio', 'prio'], ['#fStatus', 'status'], ['#fVerant', 'verant']]
      .forEach(function (pair) {
        $(pair[0]).addEventListener('change', function (ev) {
          filter[pair[1]] = ev.target.value;
          render();
        });
      });
    function resetFilter() {
      filter = { suche: '', bereich: '', thema: '', prio: '', status: '', verant: '' };
      quick = null;
      $('#suche').value = '';
      ['#fBereich', '#fThema', '#fPrio', '#fStatus', '#fVerant'].forEach(function (s) { $(s).value = ''; });
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
      } else if (act === 'log') zeigeLog();
      else if (act === 'reset') {
        if (confirm('Wirklich alle Änderungen verwerfen und den Excel-Startstand ' +
                    '(29 Punkte, 21.09.2026) wiederherstellen?')) {
          Store.reset();
          toast('Startstand wiederhergestellt.');
        }
      }
    });

    // Neuer Punkt
    $('#btnNeu').addEventListener('click', function () { oeffneEdit(null); });

    // Edit-Dialog
    $('#fmThema').addEventListener('input', aktualisiereEditTitel);
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
        toast('Punkt #' + editNr + ' gespeichert.');
        editListe = [];
        $('#dlgEdit').close();
      }
    });

    $('#btnSaveNext').addEventListener('click', function () {
      if (editSpeichern()) {
        editNavigiere(1);
      }
    });

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
      if (!confirm('Punkt #' + editNr + ' wirklich löschen? ' +
                   'Tipp: Status „Erledigt” behält die Historie.')) return;
      Store.remove(editNr);
      editListe = [];
      $('#dlgEdit').close();
      toast('Punkt gelöscht.');
    });

    // Import-Dialog
    $('#impFile').addEventListener('change', function (ev) {
      if (ev.target.files[0]) vorschauImport(ev.target.files[0]);
    });
    $('#btnImportGo').addEventListener('click', function () {
      if (!importPuffer) return;
      var modus = $$('input[name="impModus"]').filter(function (r) { return r.checked; })[0].value;
      if (modus === 'ersetzen' &&
          !confirm('Der aktuelle Stand (' + Store.state.entries.length +
                   ' Punkte) wird komplett ersetzt. Fortfahren?')) return;
      var res = Store.applyImport(importPuffer, modus);
      $('#dlgImport').close();
      toast(modus === 'ersetzen'
        ? 'Import fertig: Liste durch ' + res.neu + ' Punkte aus der Excel ersetzt.'
        : 'Import fertig: ' + res.aktualisiert + ' aktualisiert, ' + res.neu + ' neu.');
    });

    // Dialoge schließen
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });

    // Lightbox
    $('#lightbox').addEventListener('click', function () { $('#lightbox').hidden = true; });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') $('#lightbox').hidden = true;
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
