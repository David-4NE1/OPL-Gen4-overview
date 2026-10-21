/*
 * lastenheft.js – Lastenheft-Ansicht und -Export (Word/Excel) aus den OPL-Punkten.
 *
 * Jeder OPL-Punkt ist eine Anforderung. Ist sie (noch) nicht als Zielzustand
 * formuliert (Feld "anforderung"), steht der To-Do-Text als Platzhalter da.
 * Gliederung: feste Kategorie (Thema) -> Unterthema -> Baugruppe von Kopf bis Fuss -> Prio -> Nr.
 * IDs sind an die OPL-Nummer gebunden und damit stabil: LH-<Kuerzel>-<Nr>.
 */
(function (global) {
  'use strict';

  var Store = global.OPLStore;
  var Xlsx = global.OPLXlsx;
  var T = global.OPLi18n.T;

  var KUERZEL = {
    'Kollision & Bauraum': 'KB', 'Kabel & Steckverbinder': 'KS', 'Montage & Service': 'MS',
    'Verbindungstechnik & Toleranzen': 'VT', 'Poka Yoke & Varianten': 'PY', 'Auslegung & Simulation': 'AS',
    'Thermik': 'TH', 'Elektronik & Software': 'ES', 'BOM/CAD & Dokumentation': 'BD',
    'Industrialisierung & Design': 'ID'
  };
  // An wen richten sich die Forderungen einer Kategorie ("Was brauchen wir von …?")
  var ADRESSAT = {
    'Kollision & Bauraum': 'der Konstruktion', 'Kabel & Steckverbinder': 'den Kabelexperten',
    'Montage & Service': 'Montageplanung und Service', 'Verbindungstechnik & Toleranzen': 'der Konstruktion',
    'Poka Yoke & Varianten': 'der Konstruktion', 'Auslegung & Simulation': 'Berechnung und Simulation',
    'Thermik': 'den Thermik-Experten', 'Elektronik & Software': 'Elektronik und Software',
    'BOM/CAD & Dokumentation': 'CAD/PLM und Dokumentation', 'Industrialisierung & Design': 'Industrialisierung und Design'
  };
  function frage(kategorie) {
    return ADRESSAT[kategorie] ? T('Was brauchen wir von {wem}?', { wem: T(ADRESSAT[kategorie]) }) : '';
  }
  function beispielNrs(f) {
    return String(f.beispiele || '').split(',').map(Number).filter(function (n) { return n > 0; });
  }
  // Forderungen je Kategorie, in Reihenfolge
  function forderungenVon(forderungen, kategorie) {
    return (forderungen || []).filter(function (f) { return f.kategorie === kategorie; })
      .sort(function (a, b) { return (a.pos - b.pos) || (a.id - b.id); });
  }
  function kurztext(e, max) {
    var t = e.lhTitel || String(e.todo || '').trim().replace(/:?\s*\r?\n\s*/g, ' / ').replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  var OHNE_BG = 'nicht zugeordnet';
  var OHNE_UT = 'Ohne Unterthema';
  var OHNE_THEMA = 'Ohne Kategorie';
  var PRIO_RANG = { Hoch: 0, Mittel: 1, Niedrig: 2 };

  function id(e) {
    return 'LH-' + (KUERZEL[e.thema] || 'XX') + '-' + String(e.nr).padStart(3, '0');
  }

  function struktur(eintraege) {
    var themen = Store.THEMEN.concat([OHNE_THEMA]);
    var baugruppen = Store.BAUGRUPPEN.concat([OHNE_BG]);
    var bgRang = function (e) { return baugruppen.indexOf(e.baugruppe || OHNE_BG); };
    return themen.map(function (thema) {
      var punkte = eintraege.filter(function (e) {
        return thema === OHNE_THEMA ? !Store.istThema(e.thema) : e.thema === thema;
      });
      var gruppen = Store.unterthemenVon(thema).concat([OHNE_UT]).map(function (ut) {
        return {
          name: ut,
          punkte: punkte.filter(function (e) { return (e.unterthema || OHNE_UT) === ut; })
            .sort(function (a, b) { return bgRang(a) - bgRang(b) || PRIO_RANG[a.prio] - PRIO_RANG[b.prio] || a.nr - b.nr; })
        };
      }).filter(function (g) { return g.punkte.length; });
      return { name: thema, punkte: punkte, gruppen: gruppen };
    }).filter(function (k) { return k.punkte.length; });
  }

  function zahlen(l) {
    return {
      gesamt: l.length,
      offen: l.filter(function (e) { return e.status !== 'Erledigt'; }).length,
      hoch: l.filter(function (e) { return e.status !== 'Erledigt' && e.prio === 'Hoch'; }).length,
      umgesetzt: l.filter(function (e) { return e.status === 'Erledigt'; }).length,
      ohneText: l.filter(function (e) { return !e.anforderung; }).length
    };
  }

  function statusText(e) { return e.status === 'Erledigt' ? T('umgesetzt') : T(e.status); }

  /* ------------------------------------------------------------- Ansicht */

  var TRENNER = ' › ';
  function schluessel(kategorie, unterthema) { return unterthema && unterthema !== OHNE_UT ? kategorie + TRENNER + unterthema : kategorie; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fortschritt(l) {
    var z = zahlen(l);
    var box = el('div', 'lh__fortschritt');
    var bar = el('span', 'lh__balken');
    var fill = el('span');
    fill.style.width = (z.gesamt ? Math.round(z.umgesetzt / z.gesamt * 100) : 0) + '%';
    bar.appendChild(fill);
    box.appendChild(bar);
    box.appendChild(el('span', 'lh__quote', T('{u} von {n} umgesetzt', { u: z.umgesetzt, n: z.gesamt }) +
      (z.hoch ? ' · ' + T('{h} offen Prio Hoch', { h: z.hoch }) : '')));
    return box;
  }

  // "Anforderung" und "Ziel" als zwei beschriftete Aussagen; fehlt etwas, ein Hinweis
  function aussagen(ziel, kompakt) {
    var box = el('div', 'lh__aussagen' + (kompakt ? ' lh__aussagen--kompakt' : ''));
    [['Anforderung', ziel && ziel.anforderung], ['Ziel', ziel && ziel.ziel]].forEach(function (x) {
      var z = el('div', 'lh__aussage');
      z.appendChild(el('span', 'lh__label', T(x[0])));
      z.appendChild(el('p', x[1] ? null : 'lh__leer', x[1] || T('noch nicht formuliert')));
      box.appendChild(z);
    });
    return box;
  }

  function stiftKnopf(opts, kategorie, unterthema) {
    if (!opts.darfBearbeiten) return null;
    var b = el('button', 'lh__stift', '✎');
    b.type = 'button';
    b.title = T('Anforderung und Ziel bearbeiten');
    b.addEventListener('click', function (ev) { ev.stopPropagation(); opts.bearbeiten(kategorie, unterthema === OHNE_UT ? '' : unterthema); });
    return b;
  }

  // opts: { gesamt, filterAktiv, aktionen, ziele: {schluessel: {anforderung, ziel}}, offen: {schluessel: true},
  //         umschalten(schluessel), bearbeiten(kategorie, unterthema), darfBearbeiten, oeffnen(nr) }
  function render(eintraege, opts) {
    var ziele = opts.ziele || {};
    var offen = opts.offen || {};
    var wrap = el('section', 'lh');
    var kopf = el('div', 'lh__kopf');
    var titel = el('div', 'lh__titel');
    titel.appendChild(el('h2', null, T('Lastenheft auf einen Blick')));
    var z = zahlen(eintraege);
    titel.appendChild(el('p', 'lh__sub', T('{n} OPL-Punkte · {o} offen ({h} Prio Hoch) · {u} umgesetzt', {
      n: z.gesamt, o: z.offen, h: z.hoch, u: z.umgesetzt
    }) + (opts.filterAktiv ? ' · ' + T('gefiltert: {n} von {g} Punkten', { n: z.gesamt, g: opts.gesamt }) : '')));
    kopf.appendChild(titel);
    if (opts.aktionen) kopf.appendChild(opts.aktionen);
    wrap.appendChild(kopf);

    var kap = struktur(eintraege);

    var modus = el('div', 'lh__modus');
    [['forderungen', T('Forderungen')], ['unterthemen', T('Alle Punkte je Unterthema')]].forEach(function (m) {
      var b = el('button', opts.modus === m[0] ? 'is-active' : null, m[1]);
      b.type = 'button';
      b.addEventListener('click', function () { opts.setModus(m[0]); });
      modus.appendChild(b);
    });
    wrap.appendChild(modus);

    if (opts.modus !== 'unterthemen') {
      wrap.appendChild(forderungsAnsicht(kap, eintraege, opts));
      return wrap;
    }

    // Kacheln: je Kategorie Anforderung, Ziel, Fortschritt
    var kacheln = el('div', 'lh__kacheln');
    kap.forEach(function (k, i) {
      var kachel = el('article', 'lh__kachel');
      kachel.tabIndex = 0;
      var h = el('div', 'lh__kachelkopf');
      h.appendChild(el('h3', null, (i + 1) + '  ' + T(k.name)));
      var st = stiftKnopf(opts, k.name, '');
      if (st) h.appendChild(st);
      kachel.appendChild(h);
      kachel.appendChild(aussagen(ziele[k.name], true));
      kachel.appendChild(fortschritt(k.punkte));
      var springen = function () {
        var ziel = document.getElementById('lh-kap-' + (i + 1));
        if (ziel) ziel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      kachel.addEventListener('click', springen);
      kachel.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') springen(); });
      kacheln.appendChild(kachel);
    });
    wrap.appendChild(kacheln);

    // Je Kategorie: Aussagen gross, darunter die Unterthemen kompakt, Karten aufklappbar
    kap.forEach(function (k, ki) {
      var sek = el('section', 'lh__kapitel');
      sek.id = 'lh-kap-' + (ki + 1);
      var h = el('div', 'lh__kapkopf');
      h.appendChild(el('h2', 'lh__kap', (ki + 1) + '  ' + T(k.name)));
      var st = stiftKnopf(opts, k.name, '');
      if (st) h.appendChild(st);
      sek.appendChild(h);
      sek.appendChild(aussagen(ziele[k.name], false));
      sek.appendChild(fortschritt(k.punkte));

      var liste = el('div', 'lh__unterthemen');
      k.gruppen.forEach(function (g) {
        var key = schluessel(k.name, g.name);
        var zg = zahlen(g.punkte);
        var zeile = el('div', 'lh__ut' + (offen[key] ? ' is-offen' : ''));
        var kopfzeile = el('div', 'lh__utkopf');
        kopfzeile.tabIndex = 0;
        kopfzeile.setAttribute('role', 'button');
        kopfzeile.setAttribute('aria-expanded', String(!!offen[key]));
        var name = el('div', 'lh__utname');
        name.appendChild(el('span', 'lh__chev', '▸'));
        name.appendChild(el('b', null, T(g.name)));
        name.appendChild(el('span', 'lh__utzahl', T('{o} offen / {n}', { o: zg.offen, n: zg.gesamt })));
        kopfzeile.appendChild(name);
        if (g.name !== OHNE_UT) kopfzeile.appendChild(aussagen(ziele[key], true));
        else kopfzeile.appendChild(el('p', 'lh__leer', T('Punkte ohne Unterthema – im Dialog zuordnen')));
        var st2 = g.name !== OHNE_UT ? stiftKnopf(opts, k.name, g.name) : null;
        if (st2) kopfzeile.appendChild(st2);
        var auf = function () { opts.umschalten(key); };
        kopfzeile.addEventListener('click', auf);
        kopfzeile.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') auf(); });
        zeile.appendChild(kopfzeile);
        if (offen[key]) {
          var karten = el('div', 'lh__liste');
          g.punkte.forEach(function (e) { karten.appendChild(kartenZeile(e, opts)); });
          zeile.appendChild(karten);
        }
        liste.appendChild(zeile);
      });
      sek.appendChild(liste);
      wrap.appendChild(sek);
    });
    return wrap;
  }

  // Ebene 1: je Kategorie die Frage an die Fachleute und ihre Forderungen.
  // Ebene 2: Forderung aufklappen → Detail und aktuelle OPL-Beispiele.
  // Ebene 3: Beispiel anklicken → Karte. Dazu je Kategorie die offenen Punkte ohne Forderung.
  function forderungsAnsicht(kap, eintraege, opts) {
    var offen = opts.offen || {};
    var nachNr = {};
    eintraege.forEach(function (e) { nachNr[e.nr] = e; });
    var verknuepft = {};   // OPL-Nr, die irgendeine Forderung als Beispiel nennt
    (opts.forderungen || []).forEach(function (f) { beispielNrs(f).forEach(function (n) { verknuepft[n] = true; }); });
    var box = el('div', 'fo');
    kap.forEach(function (k, ki) {
      if (k.name === OHNE_THEMA) return;
      var liste = forderungenVon(opts.forderungen, k.name);
      var zk = zahlen(k.punkte);
      var art = el('article', 'fo__kat');
      var kopf = el('div', 'fo__kopf');
      var titel = el('div', 'fo__titel');
      titel.appendChild(el('h3', null, (ki + 1) + '  ' + T(k.name)));
      titel.appendChild(el('p', 'fo__frage', frage(k.name)));
      kopf.appendChild(titel);
      var zahl = el('div', 'fo__zahlen');
      zahl.appendChild(el('span', 'fo__zahl', T('{o} offen', { o: zk.offen })));
      if (zk.hoch) zahl.appendChild(el('span', 'fo__zahl fo__zahl--hoch', T('{h} Prio Hoch', { h: zk.hoch })));
      kopf.appendChild(zahl);
      var wd = el('button', 'lh__stift fo__word', '⬇ Word');
      wd.type = 'button';
      wd.title = T('Forderungen und Beispiele dieser Kategorie als Word');
      wd.addEventListener('click', function () { opts.exportKategorie(k.name); });
      kopf.appendChild(wd);
      if (opts.darfBearbeiten) {
        var neu = el('button', 'lh__stift fo__neu', '+');
        neu.type = 'button';
        neu.title = T('Forderung hinzufügen');
        neu.addEventListener('click', function () { opts.forderungBearbeiten(k.name, null); });
        kopf.appendChild(neu);
      }
      art.appendChild(kopf);

      var ul = el('ol', 'fo__liste');
      liste.forEach(function (f) {
        var key = 'fo:' + f.id;
        var nrs = beispielNrs(f);
        var bsp = nrs.map(function (n) { return nachNr[n]; }).filter(Boolean);
        var bOffen = bsp.filter(function (e) { return e.status !== 'Erledigt'; });
        var li = el('li', 'fo__f' + (offen[key] ? ' is-offen' : ''));
        var z = el('div', 'fo__fkopf');
        z.tabIndex = 0;
        z.setAttribute('role', 'button');
        z.setAttribute('aria-expanded', String(!!offen[key]));
        z.appendChild(el('span', 'lh__chev', '▸'));
        z.appendChild(el('span', 'fo__text', f.text));
        var badge = el('span', 'fo__badge' + (bOffen.some(function (e) { return e.prio === 'Hoch'; }) ? ' fo__badge--hoch' : ''),
          bsp.length ? T('{o} offen / {n} Beispiele', { o: bOffen.length, n: bsp.length }) : T('keine Beispiele'));
        z.appendChild(badge);
        if (opts.darfBearbeiten) {
          var st = el('button', 'lh__stift', '✎');
          st.type = 'button';
          st.title = T('Forderung bearbeiten');
          st.addEventListener('click', function (ev) { ev.stopPropagation(); opts.forderungBearbeiten(k.name, f); });
          z.appendChild(st);
        }
        var auf = function () { opts.umschalten(key); };
        z.addEventListener('click', auf);
        z.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') auf(); });
        li.appendChild(z);
        if (offen[key]) {
          var tief = el('div', 'fo__tief');
          if (f.detail) tief.appendChild(el('p', 'fo__detail', f.detail));
          if (bsp.length) {
            tief.appendChild(el('div', 'lh__label', T('Aktuelle Beispiele aus der OPL')));
            var karten = el('div', 'lh__liste');
            bsp.sort(function (a, b) { return (a.status === 'Erledigt') - (b.status === 'Erledigt') || PRIO_RANG[a.prio] - PRIO_RANG[b.prio] || a.nr - b.nr; })
              .forEach(function (e) { karten.appendChild(kartenZeile(e, opts)); });
            tief.appendChild(karten);
          } else {
            tief.appendChild(el('p', 'lh__leer', nrs.length ? T('Die Beispiele liegen außerhalb des Filters.') : T('Noch keine OPL-Punkte verknüpft.')));
          }
          li.appendChild(tief);
        }
        ul.appendChild(li);
      });
      if (!liste.length) ul.appendChild(el('li', 'fo__f fo__f--leer lh__leer', T('Noch keine Forderungen formuliert.')));
      art.appendChild(ul);

      // offene Punkte, die keiner Forderung zugeordnet sind
      var rest = k.punkte.filter(function (e) { return e.status !== 'Erledigt' && !verknuepft[e.nr]; });
      if (rest.length) {
        var rkey = 'fo-rest:' + k.name;
        var r = el('div', 'fo__rest' + (offen[rkey] ? ' is-offen' : ''));
        var rk = el('button', 'fo__restkopf', (offen[rkey] ? '▾ ' : '▸ ') + (rest.length === 1 ? T('1 weiterer offener Punkt ohne Forderung') : T('{n} weitere offene Punkte ohne Forderung', { n: rest.length })));
        rk.type = 'button';
        rk.addEventListener('click', function () { opts.umschalten(rkey); });
        r.appendChild(rk);
        if (offen[rkey]) {
          var rl = el('div', 'lh__liste');
          rest.forEach(function (e) { rl.appendChild(kartenZeile(e, opts)); });
          r.appendChild(rl);
        }
        art.appendChild(r);
      }
      box.appendChild(art);
    });
    return box;
  }

  // Einzelner OPL-Punkt kompakt: ID, Titel/Anforderung, Baugruppe, Prio, Status
  function kartenZeile(e, opts) {
    var z = el('article', 'lh__anf' + (e.status === 'Erledigt' ? ' is-umgesetzt' : ''));
    z.tabIndex = 0;
    z.title = T('Punkt #{nr} öffnen', { nr: e.nr });
    z.appendChild(el('div', 'lh__id', id(e)));
    var text = el('div', 'lh__text');
    if (e.lhTitel) text.appendChild(el('b', null, e.lhTitel));
    if (e.anforderung) {
      text.appendChild(el('p', null, e.anforderung));
    } else {
      var p = el('p', 'lh__platzhalter', e.todo);
      p.insertBefore(el('span', 'lh__marke', T('noch nicht formuliert')), p.firstChild);
      text.appendChild(p);
    }
    z.appendChild(text);
    var meta = el('div', 'lh__meta');
    meta.appendChild(el('span', 'lh__bgchip', '📍 ' + T(e.baugruppe || OHNE_BG)));
    meta.appendChild(el('span', 'pill pill--' + String(e.prio).toLowerCase(), T(e.prio)));
    meta.appendChild(el('span', 'lh__status' + (e.status === 'Erledigt' ? ' is-umgesetzt' : ''), statusText(e)));
    if (e.zielRelease) meta.appendChild(el('span', 'lh__ziel', '🎯 ' + e.zielRelease));
    z.appendChild(meta);
    z.addEventListener('click', function () { opts.oeffnen(e.nr); });
    z.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') opts.oeffnen(e.nr); });
    return z;
  }

  /* --------------------------------------------------------- Excel-Export */

  function exportXlsx(eintraege, stand, ziele, forderungen) {
    ziele = ziele || {};
    var kap = struktur(eintraege);
    var nachNr = {};
    eintraege.forEach(function (e) { nachNr[e.nr] = e; });
    // Blatt 0: Forderungen (gleichzeitig Vorlage zum Einspielen)
    var fo = [];
    kap.forEach(function (k) {
      forderungenVon(forderungen, k.name).forEach(function (f) {
        var bsp = beispielNrs(f).map(function (n) { return nachNr[n]; }).filter(Boolean);
        fo.push([k.name, frage(k.name), f.text, f.detail || '', beispielNrs(f).join(', '),
          bsp.filter(function (e) { return e.status !== 'Erledigt'; }).length,
          bsp.map(function (e) { return '#' + e.nr + ' ' + kurztext(e, 90); }).join('\n')]);
      });
    });
    // Blatt 1: auf einen Blick (gleichzeitig Vorlage zum Einspielen von Anforderung/Ziel)
    var blick = [];
    kap.forEach(function (k) {
      var zk = zahlen(k.punkte), zz = ziele[k.name] || {};
      blick.push([k.name, '', zz.anforderung || '', zz.ziel || '', zk.gesamt, zk.offen, zk.umgesetzt]);
      k.gruppen.forEach(function (g) {
        if (g.name === OHNE_UT) return;
        var zg = zahlen(g.punkte), zu = ziele[schluessel(k.name, g.name)] || {};
        blick.push([k.name, g.name, zu.anforderung || '', zu.ziel || '', zg.gesamt, zg.offen, zg.umgesetzt]);
      });
    });
    var zeilen = [];
    kap.forEach(function (k) {
      k.gruppen.forEach(function (g) {
        g.punkte.forEach(function (e) {
          zeilen.push([id(e), k.name, g.name, e.baugruppe || OHNE_BG, e.lhTitel, e.anforderung || '', e.nr, e.prio,
            e.status === 'Erledigt' ? 'umgesetzt' : e.status, e.zielRelease, e.nacharbeit,
            e.verantwortlichkeit, e.verantwortlicher, e.anforderung ? '' : 'ja', e.todo]);
        });
      });
    });
    var blaetter = [{
      blatt: 'Forderungen',
      titel: 'Forderungen an die Fachbereiche – 4NE1 Gen4',
      untertitel: 'Je Kategorie: was wir brauchen, mit aktuellen OPL-Punkten als Beispiel · Stand ' + stand +
        ' · Spalten Kategorie, Forderung, Detail und Beispiele lassen sich über „Aus Excel übernehmen“ wieder einspielen (ersetzt die Forderungen der enthaltenen Kategorien)',
      kopf: ['Kategorie', 'Gefragt', 'Forderung', 'Detail', 'Beispiele (OPL-Nr)', 'davon offen', 'Beispiele (Kurztext)'],
      breiten: [26, 34, 50, 60, 16, 10, 80],
      zeilen: fo
    }, {
      blatt: 'Auf einen Blick',
      titel: 'Lastenheft auf einen Blick – 4NE1 Gen4',
      untertitel: 'Anforderung und Ziel je Kategorie und Unterthema · Stand ' + stand + ' · lässt sich über „Aus Excel übernehmen“ wieder einspielen',
      kopf: ['Kategorie', 'Unterthema', 'Anforderung', 'Ziel', 'OPL-Punkte', 'Offen', 'Umgesetzt'],
      breiten: [28, 32, 70, 60, 11, 9, 11],
      zeilen: blick
    }, {
      blatt: 'Anforderungen je Punkt',
      titel: 'Lastenheft – Anforderungen je OPL-Punkt',
      untertitel: 'Aus der Open Point List abgeleitet · Stand ' + stand + ' · ' + zeilen.length + ' Punkte',
      kopf: ['ID', 'Kategorie', 'Unterthema', 'Baugruppe', 'Titel', 'Anforderung', 'OPL-Nr', 'Prio', 'Status', 'Ziel-Release',
        'Nacharbeit', 'Verantwortlichkeit', 'Verantwortlicher', 'Noch nicht formuliert', 'OPL-Text (To Do)'],
      breiten: [12, 24, 26, 15, 30, 60, 8, 9, 11, 11, 16, 18, 18, 11, 60],
      zeilen: zeilen
    }];
    return Xlsx.exportTabelle({ blaetter: fo.length ? blaetter : blaetter.slice(1) });
  }

  /* ---------------------------------------------------------- Word-Export */

  var X = function (s) { return Xlsx.escXml(s); };
  var NAVY = '2B3A4A', GRAU = '5A6674', LINIE = 'C8CDD3', BLAU = '2F6FB0';
  var PRIO_FARBE = { Hoch: 'F4C7C3', Mittel: 'FCE8B2', Niedrig: 'C6E5C3' };
  var BREITE = 9638; // A4 hoch, 2 cm Rand

  // Lauf: Text mit Zeilenumbruechen; o = { b, i, color, sz }
  function run(text, o) {
    o = o || {};
    var rpr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') +
      (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
    return String(text == null ? '' : text).split(/\r?\n/).map(function (teil, i) {
      return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + (i ? '<w:br/>' : '') +
        '<w:t xml:space="preserve">' + X(teil) + '</w:t></w:r>';
    }).join('');
  }
  // Absatz; o = { style, jc, before, after, ind: [links, haengend], keepNext, pageBreakBefore }
  function para(runs, o) {
    o = o || {};
    var ppr = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + (o.keepNext ? '<w:keepNext/>' : '') +
      (o.pageBreakBefore ? '<w:pageBreakBefore/>' : '') +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 80 : o.after) + '"/>' +
      (o.ind ? '<w:ind w:left="' + o.ind[0] + '" w:hanging="' + (o.ind[1] || 0) + '"/>' : '') + (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '');
    return '<w:p><w:pPr>' + ppr + '</w:pPr>' + runs + '</w:p>';
  }
  function zelle(inhalt, breite, fill) {
    return '<w:tc><w:tcPr><w:tcW w:w="' + breite + '" w:type="dxa"/>' +
      (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : '') + '</w:tcPr>' + inhalt + '</w:tc>';
  }
  function tabelle(breiten, kopf, zeilen) {
    var raender = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
      return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="' + LINIE + '"/>';
    }).join('');
    var xml = '<w:tbl><w:tblPr><w:tblW w:w="' + BREITE + '" w:type="dxa"/><w:tblBorders>' + raender + '</w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>' +
      '<w:bottom w:w="50" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      breiten.map(function (b) { return '<w:gridCol w:w="' + b + '"/>'; }).join('') + '</w:tblGrid>';
    if (kopf) xml += '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + kopf.map(function (k, i) {
      return zelle(para(run(k, { b: true, color: 'FFFFFF', sz: 17 }), { after: 0 }), breiten[i], NAVY);
    }).join('') + '</w:tr>';
    zeilen.forEach(function (z) {
      xml += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + z.map(function (c, i) {
        return typeof c === 'string' ? zelle(para(run(c, { sz: 18 }), { after: 0 }), breiten[i]) : zelle(c.xml, breiten[i], c.fill);
      }).join('') + '</w:tr>';
    });
    return xml + '</w:tbl>';
  }

  // Word-Paket (document, styles, footer) um einen fertigen Body bauen
  function docxPaket(body, fussText, rand) {
    var sect = '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="' + rand + '" w:right="1134" w:bottom="' + rand + '" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
    var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    var dokument = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + sect + '</w:body></w:document>';
    var fuss = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="' + BREITE + '"/></w:tabs></w:pPr>' +
      run(fussText, { sz: 16, color: GRAU }) +
      '<w:r><w:rPr><w:color w:val="' + GRAU + '"/><w:sz w:val="16"/></w:rPr><w:tab/><w:t xml:space="preserve">Seite </w:t></w:r>' +
      '<w:r><w:rPr><w:color w:val="' + GRAU + '"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:rPr><w:color w:val="' + GRAU + '"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:color w:val="' + GRAU + '"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:rPr><w:color w:val="' + GRAU + '"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>' +
      '<w:r><w:rPr><w:color w:val="' + GRAU + '"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
    var stile = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
      '<w:sz w:val="19"/><w:szCs w:val="19"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="120" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>' +
      '<w:rPr><w:b/><w:color w:val="' + NAVY + '"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr>' +
      '<w:rPr><w:b/><w:color w:val="' + NAVY + '"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style></w:styles>';
    var enc = new TextEncoder();
    var dateien = [
      { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>') },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>') },
      { name: 'word/_rels/document.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
        '</Relationships>') },
      { name: 'word/document.xml', data: enc.encode(dokument) },
      { name: 'word/styles.xml', data: enc.encode(stile) },
      { name: 'word/footer1.xml', data: enc.encode(fuss) }
    ];
    return new Blob([Xlsx.zipBuild(dateien)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function exportDocx(eintraege, stand, opts) {
    opts = opts || {};
    var kap = struktur(eintraege);
    var z = zahlen(eintraege);
    var body = '';
    body += para(run('4NE1 Gen4 Humanoid', { sz: 26, color: GRAU }), { after: 40 });
    body += para(run('Lastenheft auf einen Blick', { b: true, sz: 48, color: NAVY }), { after: 80 });
    body += para(run('Anforderungen abgeleitet aus der Open Point List (OPL) · Stand ' + stand, { sz: 22, color: GRAU }), { after: 200 });
    body += para(run(z.gesamt + ' Anforderungen, davon ' + z.offen + ' offen (' + z.hoch + ' mit Priorität Hoch) und ' +
      z.umgesetzt + ' umgesetzt.' + (opts.filterHinweis ? ' ' + opts.filterHinweis : '')));
    body += para(run('Gliederung nach Kategorie und Unterthema, darin nach Baugruppe von Kopf bis Fuß und Priorität. Die ID LH-<Kategorie>-<OPL-Nr.> ' +
      'verweist auf den Ursprungspunkt in der OPL. „umgesetzt“ = in der OPL erledigt.' +
      (z.ohneText ? ' ' + z.ohneText + ' Punkte sind noch nicht als Anforderung formuliert; dort steht kursiv der OPL-Text.' : ''),
      { sz: 18, color: GRAU }), { after: 160 });
    var ziele = opts.ziele || {};
    var zText = function (zz, feld) { return zz && zz[feld] ? zz[feld] : '– noch nicht formuliert –'; };
    body += para(run('Auf einen Blick', { b: true, sz: 26, color: NAVY }), { style: 'Heading2' });
    var BU = [2300, 3290, 3048, 1000];
    body += tabelle(BU, ['Kategorie', 'Anforderung', 'Ziel', 'Stand'], kap.map(function (k, i) {
      var zk = zahlen(k.punkte), zz = ziele[k.name];
      return [{ xml: para(run((i + 1) + '  ' + k.name, { b: true, sz: 18 }), { after: 0 }) },
        { xml: para(run(zText(zz, 'anforderung'), { sz: 17, i: !(zz && zz.anforderung), color: zz && zz.anforderung ? null : GRAU }), { after: 0 }) },
        { xml: para(run(zText(zz, 'ziel'), { sz: 17, i: !(zz && zz.ziel), color: zz && zz.ziel ? null : GRAU }), { after: 0 }) },
        { xml: para(run(zk.umgesetzt + '/' + zk.gesamt + ' umgesetzt', { sz: 16 }), { after: 0, jc: 'center' }) }];
    }));
    // Anforderung/Ziel als zwei beschriftete Absaetze
    var aussagenXml = function (zz) {
      return para(run('Anforderung: ', { b: true, sz: 19, color: NAVY }) + run(zText(zz, 'anforderung'), { sz: 19, i: !(zz && zz.anforderung) }), { after: 40 }) +
        para(run('Ziel: ', { b: true, sz: 19, color: NAVY }) + run(zText(zz, 'ziel'), { sz: 19, i: !(zz && zz.ziel) }), { after: 120 });
    };

    var SP = [1250, 4638, 720, 830, 1200, 1000];
    kap.forEach(function (k, ki) {
      var zk = zahlen(k.punkte);
      body += para(run((ki + 1) + '  ' + k.name), { style: 'Heading1', pageBreakBefore: true });
      body += aussagenXml(ziele[k.name]);
      body += para(run(zk.gesamt + ' OPL-Punkte · ' + zk.offen + ' offen · ' + zk.umgesetzt + ' umgesetzt', { color: GRAU }));
      k.gruppen.forEach(function (g, gi) {
        body += para(run((ki + 1) + '.' + (gi + 1) + '  ' + g.name), { style: 'Heading2', keepNext: true });
        if (g.name !== OHNE_UT) body += aussagenXml(ziele[schluessel(k.name, g.name)]);
        body += tabelle(SP, ['ID', 'Anforderung', 'OPL', 'Prio', 'Status', 'Release'], g.punkte.map(function (e) {
          var text = (e.lhTitel ? para(run(e.lhTitel, { b: true, sz: 18 }), { after: 30 }) : '') +
            (e.anforderung ? para(run(e.anforderung, { sz: 18 }), { after: 0 })
              : para(run('[noch nicht formuliert] ', { b: true, sz: 16, color: 'B8860B' }) + run(e.todo, { i: true, sz: 17, color: GRAU }), { after: 0 })) +
            para(run('Baugruppe: ' + (e.baugruppe || OHNE_BG) + (e.nacharbeit ? ' · Nacharbeit am Teil: ' + e.nacharbeit : ''), { sz: 16, color: GRAU }), { after: 0 });
          var mitte = function (t, fill) { return { xml: para(run(t, { sz: 17 }), { after: 0, jc: 'center' }), fill: fill }; };
          return [
            { xml: para(run(id(e), { b: true, sz: 16 }), { after: 0 }) },
            { xml: text },
            mitte('#' + e.nr),
            mitte(e.prio, PRIO_FARBE[e.prio]),
            mitte(e.status === 'Erledigt' ? 'umgesetzt' : e.status.toLowerCase(), e.status === 'Erledigt' ? 'E3F3E1' : null),
            mitte(e.zielRelease || '–')
          ];
        }));
        body += para('', { after: 60 });
      });
    });

    return docxPaket(body, 'Lastenheft-Übersicht 4NE1 Gen4 · Stand ' + stand + ' · aus der OPL abgeleitet', 1134);
  }

  /* ------------------------------------------ Word: Forderungen einer Kategorie */

  // Oben die Forderungen als knappe Liste, darunter je Forderung einige OPL-Beispiele
  function exportKategorie(eintraege, kategorie, stand, opts) {
    opts = opts || {};
    var punkte = eintraege.filter(function (e) { return e.thema === kategorie; });
    var liste = forderungenVon(opts.forderungen, kategorie);
    var zk = zahlen(punkte), zz = (opts.ziele || {})[kategorie];
    var nachNr = {};
    eintraege.forEach(function (e) { nachNr[e.nr] = e; });
    var MAX = 4;
    var langtext = function (e) {
      var t = (e.lhTitel ? e.lhTitel + ': ' : '') + String(e.todo || '').trim().replace(/:?\s*\r?\n\s*/g, ' / ').replace(/\s+/g, ' ');
      return t.length > 320 ? t.slice(0, 319) + '…' : t;
    };
    var sortiert = function (l) {
      return l.slice().sort(function (a, b) { return (a.status === 'Erledigt') - (b.status === 'Erledigt') || PRIO_RANG[a.prio] - PRIO_RANG[b.prio] || a.nr - b.nr; });
    };
    var zelleText = function (t, o) { return { xml: para(run(t, Object.assign({ sz: 17 }, o || {})), { after: 0, jc: o && o.jc }) }; };
    var beispielTabelle = function (l) {
      return tabelle([700, 5338, 900, 1100, 1600], ['OPL', 'Punkt', 'Prio', 'Status', 'Verantwortlich'], l.map(function (e) {
        return [zelleText('#' + e.nr, { b: true }), zelleText(langtext(e)),
          { xml: para(run(e.prio, { sz: 16 }), { after: 0, jc: 'center' }), fill: PRIO_FARBE[e.prio] },
          zelleText(e.status === 'Erledigt' ? 'erledigt' : e.status, { sz: 16, jc: 'center' }),
          zelleText(e.verantwortlicher || e.verantwortlichkeit || '–', { sz: 15 })];
      }));
    };

    var body = '';
    body += para(run('4NE1 Gen4 · Forderungen aus der Open Point List · Stand ' + stand, { sz: 18, color: GRAU }), { after: 40 });
    body += para(run(kategorie, { b: true, sz: 44, color: NAVY }), { after: 20 });
    if (frage(kategorie)) body += para(run(frage(kategorie), { sz: 28, color: BLAU }), { after: 80 });
    body += para(run(zk.offen + ' offene Punkte · ' + zk.hoch + ' mit Prio Hoch · ' + zk.umgesetzt + ' von ' + zk.gesamt + ' umgesetzt', { sz: 18, color: GRAU }) +
      (zz && zz.ziel ? '<w:r><w:br/></w:r>' + run('Ziel: ', { sz: 18, b: true, color: GRAU }) + run(zz.ziel, { sz: 18, color: GRAU, i: true }) : ''), { after: 200 });

    if (liste.length) {
      body += para(run('Was wir brauchen', { b: true, sz: 26, color: NAVY }), { style: 'Heading2' });
      liste.forEach(function (f) {
        body += para(run('•', { b: true, color: BLAU, sz: 24 }) + '<w:r><w:tab/></w:r>' + run(f.text, { b: true, sz: 23 }), { ind: [400, 300], after: 70 });
      });
    } else {
      body += para(run('Für diese Kategorie sind noch keine Forderungen formuliert.', { i: true, color: GRAU }));
    }

    var verknuepft = {};
    (opts.forderungen || []).forEach(function (f) { beispielNrs(f).forEach(function (n) { verknuepft[n] = true; }); });
    var mitBeispiel = liste.filter(function (f) { return beispielNrs(f).some(function (n) { return nachNr[n]; }); });
    if (mitBeispiel.length) {
      body += para(run('Beispiele aus der OPL', { b: true, sz: 26, color: NAVY }), { style: 'Heading2', before: 240 });
      mitBeispiel.forEach(function (f, i) {
        var bsp = sortiert(beispielNrs(f).map(function (n) { return nachNr[n]; }).filter(Boolean));
        body += para(run((i + 1) + '.  ' + f.text, { b: true, sz: 20, color: NAVY }), { before: 140, after: 30, keepNext: true });
        if (f.detail) body += para(run(f.detail, { sz: 17, i: true, color: GRAU }), { after: 50, keepNext: true });
        body += beispielTabelle(bsp.slice(0, MAX));
        if (bsp.length > MAX) {
          body += para(run('Weitere: ' + bsp.slice(MAX).map(function (e) { return '#' + e.nr; }).join(', '), { sz: 16, color: GRAU }), { before: 30, after: 0 });
        }
      });
    }
    var rest = sortiert(punkte.filter(function (e) { return e.status !== 'Erledigt' && !verknuepft[e.nr]; }));
    if (rest.length) {
      body += para(run('Weitere offene Punkte ohne Forderung', { b: true, sz: 20, color: NAVY }), { before: 200, after: 50, keepNext: true });
      body += beispielTabelle(rest);
    }
    body += para(run('Quelle: OPL 4NE1 Gen4, Stand ' + stand + '. Alle Punkte und Details im Board, Reiter Lastenheft → Forderungen.', { sz: 15, color: GRAU }), { before: 160, after: 0 });
    return docxPaket(body, '4NE1 Gen4 · ' + kategorie + ' · Forderungen aus der OPL · Stand ' + stand, 1000);
  }

  /* ------------------------------------------- Word-Kurzfassung (Management) */

  // 2–3 Seiten: Kennzahlen, Anforderung/Ziel/Stand je Kategorie, Steuerungsbedarf
  // und die offenen Punkte mit Prio Hoch – alles aus dem aktuellen Stand berechnet
  function exportKurzfassung(eintraege, stand, opts) {
    opts = opts || {};
    var ziele = opts.ziele || {};
    var kap = struktur(eintraege);
    var z = zahlen(eintraege);
    var offen = eintraege.filter(function (e) { return e.status !== 'Erledigt'; });
    var hoch = offen.filter(function (e) { return e.prio === 'Hoch'; });
    var hochTermin = hoch.filter(function (e) { return e.faellig; }).length;
    var hochRelease = hoch.filter(function (e) { return e.zielRelease; }).length;
    var ohneRelease = offen.filter(function (e) { return !e.zielRelease; }).length;
    var ueberfaellig = offen.filter(function (e) { return e.faellig && e.faellig < opts.heute; }).length;
    var nacharbeit = eintraege.filter(function (e) { return e.nacharbeit; }).length;
    var ohneFo = kap.filter(function (k) { return !forderungenVon(opts.forderungen, k.name).length; }).length;
    var datum = function (d) { return d ? Xlsx.ddmmyyyy(d) : ''; };
    var klein = function (t, o) { return { xml: para(run(t, Object.assign({ sz: 17 }, o || {})), { after: 0, jc: o && o.jc }) }; };

    var body = '';
    body += para(run('4NE1 Gen4 · Management-Kurzfassung aus der Open Point List', { sz: 20, color: GRAU }), { after: 20 });
    body += para(run('Was wir von den Fachbereichen brauchen', { b: true, sz: 40, color: NAVY }), { after: 60 });
    body += para(run('Stand ' + stand + (opts.filterHinweis ? ' · ' + opts.filterHinweis : ''), { sz: 20, color: GRAU }), { after: 140 });

    // Kennzahlen als Kachelzeile
    var KPI = [[z.gesamt, 'OPL-Punkte'], [z.offen, 'offen'], [z.hoch, 'offen mit Prio Hoch'],
      [hochTermin + ' / ' + z.hoch, 'Prio Hoch mit Termin'], [nacharbeit, 'mit Nacharbeit am Teil']];
    var kb = Math.floor(BREITE / KPI.length);
    body += tabelle(KPI.map(function () { return kb; }), null, [KPI.map(function (k) {
      return { xml: para(run(k[0], { b: true, sz: 32, color: NAVY }), { after: 0, jc: 'center' }) +
        para(run(k[1], { sz: 15, color: GRAU }), { after: 0, jc: 'center' }), fill: 'F1F3F5' };
    })]);

    body += para(run('Je Kategorie: was wir von den Fachbereichen brauchen, mit den aktuellen OPL-Punkten als Beleg ' +
      '(rot mit ! = offen mit Prio Hoch, ✓ = erledigt). Details zu jedem Punkt im Board, Reiter Lastenheft → Forderungen.', { sz: 17, color: GRAU }), { before: 120, after: 40 });
    var nachNr = {};
    eintraege.forEach(function (e) { nachNr[e.nr] = e; });
    kap.forEach(function (k, ki) {
      if (k.name === OHNE_THEMA) return;
      var zk = zahlen(k.punkte), liste = forderungenVon(opts.forderungen, k.name), zz = ziele[k.name];
      body += para(run((ki + 1) + '  ' + k.name, { b: true, sz: 24, color: NAVY }) +
        (frage(k.name) ? run('  –  ' + frage(k.name), { sz: 21, color: NAVY }) : ''), { before: 180, after: 20, keepNext: true });
      body += para(run(zk.offen + ' offen · ' + (zk.hoch ? zk.hoch + ' × Prio Hoch · ' : '') + zk.umgesetzt + '/' + zk.gesamt + ' umgesetzt' +
        (zz && zz.ziel ? '   Ziel: ' : ''), { sz: 16, color: GRAU }) + (zz && zz.ziel ? run(zz.ziel, { sz: 16, color: GRAU, i: true }) : ''),
        { after: 60, keepNext: true });
      if (!liste.length) {
        var hochK = k.punkte.filter(function (e) { return e.status !== 'Erledigt' && e.prio === 'Hoch'; });
        body += para(run('Noch keine Forderungen formuliert.' + (hochK.length ? ' Offen mit Prio Hoch: ' : ''), { sz: 17, i: true, color: GRAU }) +
          run(hochK.map(function (e) { return '#' + e.nr; }).join(', '), { sz: 17, color: GRAU }), { ind: [360, 0] });
        return;
      }
      liste.forEach(function (f, fi) {
        var bsp = beispielNrs(f).map(function (n) { return nachNr[n]; }).filter(Boolean)
          .sort(function (a, b) { return (a.status === 'Erledigt') - (b.status === 'Erledigt') || PRIO_RANG[a.prio] - PRIO_RANG[b.prio] || a.nr - b.nr; });
        var letzte = fi === liste.length - 1;
        body += para(run('•', { b: true, color: BLAU }) + '<w:r><w:tab/></w:r>' + run(f.text, { b: true, sz: 19 }),
          { ind: [360, 240], after: f.detail || bsp.length ? 0 : 50, keepNext: !letzte || !!(f.detail || bsp.length) });
        if (f.detail) body += para(run(f.detail, { sz: 17 }), { ind: [360, 0], after: bsp.length ? 0 : 50 });
        if (bsp.length) {
          var marke = function (e) { return e.status === 'Erledigt' ? ' ✓' : e.prio === 'Hoch' ? ' !' : ''; };
          body += para(run('OPL: ', { sz: 16, b: true, color: GRAU }) + bsp.map(function (e, i) {
            return run((i ? ', ' : '') + '#' + e.nr + marke(e), { sz: 16, color: e.prio === 'Hoch' && e.status !== 'Erledigt' ? 'B02A2A' : GRAU, b: e.prio === 'Hoch' && e.status !== 'Erledigt' });
          }).join(''), { ind: [360, 0], after: 60 });
        }
      });
    });

    body += para(run('Steuerungsbedarf', { b: true, sz: 26, color: NAVY }), { style: 'Heading2' });
    var bedarf = [];
    if (z.hoch) bedarf.push(['Termine für Prio Hoch: ', (z.hoch - hochTermin) + ' von ' + z.hoch + ' offenen Prio-Hoch-Punkten haben keinen Termin, ' +
      (z.hoch - hochRelease) + ' kein Ziel-Release.']);
    if (ohneRelease) bedarf.push(['Release-Zuordnung: ', ohneRelease + ' von ' + z.offen + ' offenen Punkten sind keinem Ziel-Release zugeordnet.']);
    if (ueberfaellig) bedarf.push(['Überfällig: ', ueberfaellig + ' offene Punkte haben ihren Termin überschritten.']);
    var schwer = kap.map(function (k) { return [k.name, zahlen(k.punkte).hoch]; })
      .filter(function (x) { return x[1]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
    if (schwer.length) bedarf.push(['Schwerpunkte: ', 'die meisten offenen Prio-Hoch-Punkte liegen in ' +
      schwer.map(function (x) { return x[0] + ' (' + x[1] + ')'; }).join(', ') + '.']);
    if (nacharbeit) bedarf.push(['Nacharbeit: ', nacharbeit + ' Punkte erforderten Nacharbeit am Teil (Fräsen, Schleifen o. Ä.) – Ursache im CAD/Freigabeprozess abstellen.']);
    if (ohneFo) bedarf.push(['Forderungen formulieren: ', 'für ' + ohneFo + ' von ' + kap.length + ' Kategorien sind noch keine Forderungen hinterlegt.']);
    if (!bedarf.length) bedarf.push(['', 'Kein akuter Steuerungsbedarf erkannt.']);
    bedarf.forEach(function (b, i) {
      body += para(run((i + 1) + '.  ', { b: true, color: NAVY }) + run(b[0], { b: true }) + run(b[1]), { after: 50 });
    });

    if (hoch.length) {
      body += para(run('Offene Punkte mit Prio Hoch (' + hoch.length + ')', { b: true, sz: 26, color: NAVY }), { style: 'Heading2' });
      var reihe = {};
      kap.forEach(function (k, i) { reihe[k.name] = i; });
      hoch.sort(function (a, b) { return (reihe[a.thema] - reihe[b.thema]) || (a.nr - b.nr); });
      body += tabelle([700, 2050, 4038, 1650, 1200], ['OPL', 'Kategorie', 'Punkt', 'Verantwortlich', 'Termin / Release'], hoch.map(function (e) {
        var text = e.lhTitel || String(e.todo || '').trim().replace(/:?\s*\r?\n\s*/g, ' / ').replace(/\s+/g, ' ');
        if (text.length > 160) text = text.slice(0, 157) + '…';
        var termin = [datum(e.faellig), e.zielRelease].filter(Boolean).join(' · ');
        return [klein('#' + e.nr, { b: true }), klein(e.thema + (e.unterthema ? ' › ' + e.unterthema : ''), { sz: 15 }), klein(text),
          klein([e.verantwortlicher, e.verantwortlichkeit].filter(Boolean).join(', ') || '–', { sz: 15 }),
          termin ? klein(termin, { jc: 'center' }) : { xml: para(run('fehlt', { sz: 17, b: true, color: 'B02A2A' }), { after: 0, jc: 'center' }), fill: 'FDECEC' }];
      }));
    }
    body += para(run('Quelle: OPL 4NE1 Gen4, Stand ' + stand + '. Forderungen aus dem Reiter Lastenheft; #-Nummern verweisen auf OPL-Punkte.', { sz: 15, color: GRAU }), { after: 0 });
    return docxPaket(body, '4NE1 Gen4 · Management-Kurzfassung aus der OPL · Stand ' + stand, 850);
  }

  global.OPLLastenheft = { id: id, frage: frage, struktur: struktur, schluessel: schluessel, TRENNER: TRENNER, render: render, exportXlsx: exportXlsx, exportDocx: exportDocx, exportKurzfassung: exportKurzfassung, exportKategorie: exportKategorie };
})(window);
