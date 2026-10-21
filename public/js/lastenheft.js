/*
 * lastenheft.js – Lastenheft-Ansicht und -Export (Word/Excel) aus den OPL-Punkten.
 *
 * Jeder OPL-Punkt ist eine Anforderung. Ist sie (noch) nicht als Zielzustand
 * formuliert (Feld "anforderung"), steht der To-Do-Text als Platzhalter da.
 * Gliederung: feste Kategorie (Thema) -> Baugruppe von Kopf bis Fuss -> Prio -> Nr.
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
  var OHNE_THEMA = 'Ohne Kategorie';
  var PRIO_RANG = { Hoch: 0, Mittel: 1, Niedrig: 2 };

  function id(e) {
    return 'LH-' + (KUERZEL[e.thema] || 'XX') + '-' + String(e.nr).padStart(3, '0');
  }

  function struktur(eintraege) {
    var themen = Store.THEMEN.concat([OHNE_THEMA]);
    var baugruppen = Store.BAUGRUPPEN.concat([OHNE_BG]);
    return themen.map(function (thema) {
      var punkte = eintraege.filter(function (e) {
        return thema === OHNE_THEMA ? !Store.istThema(e.thema) : e.thema === thema;
      });
      var gruppen = baugruppen.map(function (bg) {
        return {
          name: bg,
          punkte: punkte.filter(function (e) { return (e.baugruppe || OHNE_BG) === bg; })
            .sort(function (a, b) { return PRIO_RANG[a.prio] - PRIO_RANG[b.prio] || a.nr - b.nr; })
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

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // opts: { gesamt, filterAktiv, oeffnen(nr), aktionen: DOM-Knoten }
  function render(eintraege, opts) {
    var wrap = el('section', 'lh');
    var kopf = el('div', 'lh__kopf');
    var titel = el('div', 'lh__titel');
    titel.appendChild(el('h2', null, T('Lastenheft-Übersicht')));
    var z = zahlen(eintraege);
    titel.appendChild(el('p', 'lh__sub', T('{n} Anforderungen · {o} offen ({h} Prio Hoch) · {u} umgesetzt', {
      n: z.gesamt, o: z.offen, h: z.hoch, u: z.umgesetzt
    }) + (opts.filterAktiv ? ' · ' + T('gefiltert: {n} von {g} Punkten', { n: z.gesamt, g: opts.gesamt }) : '')));
    if (z.ohneText) {
      titel.appendChild(el('p', 'lh__hinweis', T('{n} Punkte sind noch nicht als Anforderung formuliert – dort steht der To-Do-Text der OPL.', { n: z.ohneText })));
    }
    kopf.appendChild(titel);
    if (opts.aktionen) kopf.appendChild(opts.aktionen);
    wrap.appendChild(kopf);

    // Uebersicht je Kategorie
    var kap = struktur(eintraege);
    var tab = el('table', 'lh__zahlen');
    var thead = el('thead');
    var trh = el('tr');
    [T('Kategorie'), T('Gesamt'), T('Offen'), T('davon Hoch'), T('Umgesetzt')].forEach(function (h) { trh.appendChild(el('th', null, h)); });
    thead.appendChild(trh);
    tab.appendChild(thead);
    var tbody = el('tbody');
    kap.forEach(function (k, i) {
      var zk = zahlen(k.punkte);
      var tr = el('tr');
      var a = el('a', null, (i + 1) + '  ' + T(k.name));
      a.href = '#lh-kap-' + (i + 1);
      var td = el('td');
      td.appendChild(a);
      tr.appendChild(td);
      [zk.gesamt, zk.offen, zk.hoch, zk.umgesetzt].forEach(function (v) { tr.appendChild(el('td', null, String(v))); });
      tbody.appendChild(tr);
    });
    tab.appendChild(tbody);
    wrap.appendChild(tab);

    kap.forEach(function (k, ki) {
      var zk = zahlen(k.punkte);
      var h = el('h2', 'lh__kap', (ki + 1) + '  ' + T(k.name));
      h.id = 'lh-kap-' + (ki + 1);
      h.appendChild(el('small', null, T('{n} Anforderungen · {o} offen · {u} umgesetzt', { n: zk.gesamt, o: zk.offen, u: zk.umgesetzt })));
      wrap.appendChild(h);
      k.gruppen.forEach(function (g, gi) {
        wrap.appendChild(el('h3', 'lh__bg', (ki + 1) + '.' + (gi + 1) + '  ' + T(g.name)));
        var liste = el('div', 'lh__liste');
        g.punkte.forEach(function (e) { liste.appendChild(zeile(e, opts)); });
        wrap.appendChild(liste);
      });
    });
    return wrap;
  }

  function zeile(e, opts) {
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
    if (e.nacharbeit) text.appendChild(el('small', null, T('Nacharbeit am Teil') + ': ' + T(e.nacharbeit)));
    z.appendChild(text);
    var meta = el('div', 'lh__meta');
    meta.appendChild(el('span', 'lh__opl', 'OPL #' + e.nr));
    meta.appendChild(el('span', 'pill pill--' + String(e.prio).toLowerCase(), T(e.prio)));
    meta.appendChild(el('span', 'lh__status' + (e.status === 'Erledigt' ? ' is-umgesetzt' : ''), statusText(e)));
    meta.appendChild(el('span', 'lh__ziel', e.zielRelease ? '🎯 ' + e.zielRelease : T('kein Ziel-Release')));
    z.appendChild(meta);
    z.addEventListener('click', function () { opts.oeffnen(e.nr); });
    z.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') opts.oeffnen(e.nr); });
    return z;
  }

  /* --------------------------------------------------------- Excel-Export */

  function exportXlsx(eintraege, stand) {
    var zeilen = [];
    struktur(eintraege).forEach(function (k) {
      k.gruppen.forEach(function (g) {
        g.punkte.forEach(function (e) {
          zeilen.push([id(e), k.name, g.name, e.lhTitel, e.anforderung || '', e.nr, e.prio,
            e.status === 'Erledigt' ? 'umgesetzt' : e.status, e.zielRelease, e.nacharbeit,
            e.verantwortlichkeit, e.verantwortlicher, e.anforderung ? '' : 'ja', e.todo]);
        });
      });
    });
    return Xlsx.exportTabelle({
      blatt: 'Lastenheft',
      titel: 'Lastenheft-Übersicht 4NE1 Gen4',
      untertitel: 'Aus der Open Point List abgeleitet · Stand ' + stand + ' · ' + zeilen.length + ' Anforderungen',
      kopf: ['ID', 'Kategorie', 'Baugruppe', 'Titel', 'Anforderung', 'OPL-Nr', 'Prio', 'Status', 'Ziel-Release',
        'Nacharbeit', 'Verantwortlichkeit', 'Verantwortlicher', 'Noch nicht formuliert', 'OPL-Text (To Do)'],
      breiten: [12, 24, 15, 30, 60, 8, 9, 11, 11, 16, 18, 18, 11, 60],
      zeilen: zeilen
    });
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
    body += para(run('Lastenheft-Übersicht', { b: true, sz: 48, color: NAVY }), { after: 80 });
    body += para(run('Anforderungen abgeleitet aus der Open Point List (OPL) · Stand ' + stand, { sz: 22, color: GRAU }), { after: 200 });
    body += para(run(z.gesamt + ' Anforderungen, davon ' + z.offen + ' offen (' + z.hoch + ' mit Priorität Hoch) und ' +
      z.umgesetzt + ' umgesetzt.' + (opts.filterHinweis ? ' ' + opts.filterHinweis : '')));
    body += para(run('Gliederung nach Kategorie, darin nach Baugruppe von Kopf bis Fuß und Priorität. Die ID LH-<Kategorie>-<OPL-Nr.> ' +
      'verweist auf den Ursprungspunkt in der OPL. „umgesetzt“ = in der OPL erledigt.' +
      (z.ohneText ? ' ' + z.ohneText + ' Punkte sind noch nicht als Anforderung formuliert; dort steht kursiv der OPL-Text.' : ''),
      { sz: 18, color: GRAU }), { after: 160 });
    body += para(run('Übersicht', { b: true, sz: 26, color: NAVY }), { style: 'Heading2' });
    var BU = [3838, 1450, 1450, 1450, 1450];
    body += tabelle(BU, ['Kategorie', 'Gesamt', 'Offen', 'davon Hoch', 'Umgesetzt'], kap.map(function (k, i) {
      var zk = zahlen(k.punkte);
      return [(i + 1) + '  ' + k.name, String(zk.gesamt), String(zk.offen), String(zk.hoch), String(zk.umgesetzt)];
    }).concat([['Summe', String(z.gesamt), String(z.offen), String(z.hoch), String(z.umgesetzt)]]));

    var SP = [1250, 4638, 720, 830, 1200, 1000];
    kap.forEach(function (k, ki) {
      var zk = zahlen(k.punkte);
      body += para(run((ki + 1) + '  ' + k.name), { style: 'Heading1', pageBreakBefore: true });
      body += para(run(zk.gesamt + ' Anforderungen · ' + zk.offen + ' offen · ' + zk.umgesetzt + ' umgesetzt', { color: GRAU }));
      k.gruppen.forEach(function (g, gi) {
        body += para(run((ki + 1) + '.' + (gi + 1) + '  ' + g.name), { style: 'Heading2', keepNext: true });
        body += tabelle(SP, ['ID', 'Anforderung', 'OPL', 'Prio', 'Status', 'Release'], g.punkte.map(function (e) {
          var text = (e.lhTitel ? para(run(e.lhTitel, { b: true, sz: 18 }), { after: 30 }) : '') +
            (e.anforderung ? para(run(e.anforderung, { sz: 18 }), { after: 0 })
              : para(run('[noch nicht formuliert] ', { b: true, sz: 16, color: 'B8860B' }) + run(e.todo, { i: true, sz: 17, color: GRAU }), { after: 0 })) +
            (e.nacharbeit ? para(run('Nacharbeit am Teil: ' + e.nacharbeit, { sz: 16, color: GRAU }), { after: 0 }) : '');
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

  global.OPLLastenheft = { id: id, struktur: struktur, render: render, exportXlsx: exportXlsx, exportDocx: exportDocx };
})(window);
