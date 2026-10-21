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

  function exportXlsx(eintraege, stand, ziele) {
    ziele = ziele || {};
    var kap = struktur(eintraege);
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
    return Xlsx.exportTabelle({ blaetter: [{
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
    }] });
  }

  /* ---------------------------------------------------------- Word-Export */

  var X = function (s) { return Xlsx.escXml(s); };
  var NAVY = '2B3A4A', GRAU = '5A6674', LINIE = 'C8CDD3';
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
  // Absatz; o = { style, jc, after, keepNext, pageBreakBefore }
  function para(runs, o) {
    o = o || {};
    var ppr = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + (o.keepNext ? '<w:keepNext/>' : '') +
      (o.pageBreakBefore ? '<w:pageBreakBefore/>' : '') +
      '<w:spacing w:before="0" w:after="' + (o.after == null ? 80 : o.after) + '"/>' + (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '');
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
    xml += '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + kopf.map(function (k, i) {
      return zelle(para(run(k, { b: true, color: 'FFFFFF', sz: 17 }), { after: 0 }), breiten[i], NAVY);
    }).join('') + '</w:tr>';
    zeilen.forEach(function (z) {
      xml += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + z.map(function (c, i) {
        return typeof c === 'string' ? zelle(para(run(c, { sz: 18 }), { after: 0 }), breiten[i]) : zelle(c.xml, breiten[i], c.fill);
      }).join('') + '</w:tr>';
    });
    return xml + '</w:tbl>';
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

    var sect = '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
    var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    var dokument = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + sect + '</w:body></w:document>';
    var fuss = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="' + BREITE + '"/></w:tabs></w:pPr>' +
      run('Lastenheft-Übersicht 4NE1 Gen4 · Stand ' + stand + ' · aus der OPL abgeleitet', { sz: 16, color: GRAU }) +
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

  global.OPLLastenheft = { id: id, struktur: struktur, schluessel: schluessel, TRENNER: TRENNER, render: render, exportXlsx: exportXlsx, exportDocx: exportDocx };
})(window);
