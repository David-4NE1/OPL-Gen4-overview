/*
 * xlsx-io.js – Excel-Export/-Import ohne externe Bibliothek.
 *
 * Schreibt und liest .xlsx-Dateien exakt im Schema der bestehenden
 * OPL-Excel (Titel, KPI-Block mit Formeln, Kopfzeile ab Zeile 7,
 * Daten ab Zeile 8, Spalten A-I).
 *
 * ZIP wird "stored" (unkomprimiert) geschrieben – das versteht Excel
 * problemlos. Beim Lesen wird deflate ueber die native
 * DecompressionStream-API entpackt.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* ZIP: Low-Level                                                      */
  /* ------------------------------------------------------------------ */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  var enc = new TextEncoder();
  var dec = new TextDecoder('utf-8');

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  }

  /** Baut ein ZIP aus [{name, data:Uint8Array}] – alle Eintraege "stored". */
  function zipBuild(files) {
    var now = new Date();
    var time = dosTime(now);
    var date = dosDate(now);
    var locals = [];
    var centrals = [];
    var offset = 0;

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var crc = crc32(f.data);
      var size = f.data.length;

      var local = new Uint8Array(30 + nameBytes.length + size);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // UTF-8 flag
      lv.setUint16(8, 0, true); // stored
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(f.data, 30 + nameBytes.length);
      locals.push(local);

      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centrals.push(central);

      offset += local.length;
    });

    var centralSize = centrals.reduce(function (a, b) { return a + b.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    var total = offset + centralSize + 22;
    var out = new Uint8Array(total);
    var p = 0;
    locals.forEach(function (b) { out.set(b, p); p += b.length; });
    centrals.forEach(function (b) { out.set(b, p); p += b.length; });
    out.set(eocd, p);
    return out;
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error(
        'Dieser Browser kann komprimierte xlsx-Dateien nicht lesen (DecompressionStream fehlt). ' +
        'Bitte einen aktuellen Chrome, Edge, Firefox oder Safari verwenden.'));
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /** Liest ein ZIP und gibt {name: Uint8Array} zurueck. */
  function zipRead(buffer) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Keine gueltige xlsx-Datei (ZIP-Ende nicht gefunden).');

    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    if (cdOffset === 0xffffffff) throw new Error('ZIP64-Dateien werden nicht unterstuetzt.');

    var entries = [];
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var localOff = view.getUint32(p + 42, true);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name: name, method: method, compSize: compSize, localOff: localOff });
      p += 46 + nameLen + extraLen + commentLen;
    }

    return entries.reduce(function (chain, e) {
      return chain.then(function (acc) {
        var lNameLen = view.getUint16(e.localOff + 26, true);
        var lExtraLen = view.getUint16(e.localOff + 28, true);
        var start = e.localOff + 30 + lNameLen + lExtraLen;
        var raw = bytes.subarray(start, start + e.compSize);
        if (e.method === 0) { acc[e.name] = raw; return acc; }
        if (e.method !== 8) throw new Error('Nicht unterstuetzte ZIP-Kompression in ' + e.name);
        return inflateRaw(raw).then(function (out) { acc[e.name] = out; return acc; });
      });
    }, Promise.resolve({}));
  }

  /* ------------------------------------------------------------------ */
  /* XML-Helfer                                                          */
  /* ------------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Steuerzeichen sind in XML 1.0 nicht erlaubt
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  function colName(idx) { // 1 -> A
    var s = '';
    while (idx > 0) {
      var m = (idx - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      idx = (idx - m - 1) / 26;
    }
    return s;
  }

  function parseRef(ref) { // "B12" -> {col:2, row:12}
    var m = /^([A-Z]+)(\d+)$/.exec(ref || '');
    if (!m) return null;
    var col = 0;
    for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return { col: col, row: parseInt(m[2], 10) };
  }

  /* ------------------------------------------------------------------ */
  /* Styles (1:1 an die bestehende OPL-Excel angelehnt)                  */
  /* ------------------------------------------------------------------ */

  var S = {
    DEFAULT: 0, TITLE: 1, SUBTITLE: 2, KPI_LABEL: 3, KPI_VALUE: 4, LEGEND: 5,
    HEADER: 6, CELL: 7, NR: 8,
    PRIO_HOCH: 9, PRIO_MITTEL: 10, PRIO_NIEDRIG: 11,
    ST_OFFEN: 12, ST_ARBEIT: 13, ST_ERLEDIGT: 14,
    PFLEGE: 15, UEBERFAELLIG: 16
  };

  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="7">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="16"/><color rgb="FF1F2733"/><name val="Calibri"/></font>' +
      '<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="12"/><color rgb="FF2B3A4A"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><i/><sz val="10"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFB03030"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="11">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F6"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF2B3A4A"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF4C7C3"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE8B2"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFC6E5C3"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFDEBEB"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1D6"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE3F3E1"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFDE7"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border>' +
        '<left style="thin"><color rgb="FFD0D5DA"/></left>' +
        '<right style="thin"><color rgb="FFD0D5DA"/></right>' +
        '<top style="thin"><color rgb="FFD0D5DA"/></top>' +
        '<bottom style="thin"><color rgb="FFD0D5DA"/></bottom>' +
        '<diagonal/>' +
      '</border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="17">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                    // 0 default
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                       // 1 title
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                       // 2 subtitle
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                     // 3 kpi label
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +                         // 4 kpi value
      '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                       // 5 legend
      '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 6 header
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 7 cell
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' + // 8 nr
      '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 9
      '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 10
      '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 11
      '<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 12
      '<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 13
      '<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 14
      '<xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 15 pflege
      '<xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 16 ueberfaellig
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  var HEADERS = ['Nr', 'Bereich', 'Thema/Aufgabe', 'Prio', 'Verantwortlicher',
                 'Bis wann', 'Status', 'To Do', 'Bild', 'Erstellt am'];

  var PRIO_STYLE = { 'Hoch': S.PRIO_HOCH, 'Mittel': S.PRIO_MITTEL, 'Niedrig': S.PRIO_NIEDRIG };
  var STATUS_STYLE = { 'Offen': S.ST_OFFEN, 'In Arbeit': S.ST_ARBEIT, 'Erledigt': S.ST_ERLEDIGT };

  function cellStr(ref, style, value) {
    if (value === '' || value == null) return '<c r="' + ref + '" s="' + style + '"/>';
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
      esc(value) + '</t></is></c>';
  }
  function cellNum(ref, style, value) {
    return '<c r="' + ref + '" s="' + style + '"><v>' + value + '</v></c>';
  }
  function cellFormula(ref, style, formula) {
    return '<c r="' + ref + '" s="' + style + '"><f>' + esc(formula) + '</f></c>';
  }

  function ddmmyyyy(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : iso;
  }

  /**
   * Erzeugt die xlsx-Datei als Blob.
   * @param {Array} entries  OPL-Eintraege
   * @param {Object} opts    {stand: 'DD.MM.YYYY', quelle: string}
   */
  function exportWorkbook(entries, opts) {
    opts = opts || {};
    var first = 8;
    var last = Math.max(first, first + entries.length - 1);
    var rows = [];

    rows.push('<row r="1" ht="24" customHeight="1">' + cellStr('A1', S.TITLE,
      'OPL – Open Point List | 4NE1 Gen4 Humanoid') + '</row>');
    rows.push('<row r="2">' + cellStr('A2', S.SUBTITLE,
      (opts.quelle || 'Quelle: Meeting-Notizen Mechanik-Review (21.09.2026) + Ergaenzungen David Rybinski') +
      ' · Stand: ' + (opts.stand || ddmmyyyy(new Date().toISOString().slice(0, 10)))) + '</row>');

    var kpiLabels = ['Gesamt offene Punkte', 'Prio Hoch', 'Prio Mittel', 'Prio Niedrig',
                     'Status Offen', 'Status Erledigt'];
    var r3 = kpiLabels.map(function (l, i) { return cellStr(colName(i + 1) + '3', S.KPI_LABEL, l); });
    r3.push(cellStr('H3', S.KPI_LABEL, 'Legende:'));
    rows.push('<row r="3">' + r3.join('') + '</row>');

    var range = '$A$' + first + ':$A$' + last;
    var prioRange = '$D$' + first + ':$D$' + last;
    var statusRange = '$G$' + first + ':$G$' + last;
    var kpiFormulas = [
      'COUNTA(' + range + ')',
      'COUNTIF(' + prioRange + ',"Hoch")',
      'COUNTIF(' + prioRange + ',"Mittel")',
      'COUNTIF(' + prioRange + ',"Niedrig")',
      'COUNTIF(' + statusRange + ',"Offen")',
      'COUNTIF(' + statusRange + ',"Erledigt")'
    ];
    var r5 = kpiFormulas.map(function (f, i) { return cellFormula(colName(i + 1) + '5', S.KPI_VALUE, f); });
    r5.push(cellStr('H5', S.LEGEND, 'Gelbe Zellen (Verantwortlicher/Bis wann/Status) bitte pflegen'));
    rows.push('<row r="5">' + r5.join('') + '</row>');

    rows.push('<row r="7" ht="21.75" customHeight="1">' + HEADERS.map(function (h, i) {
      return cellStr(colName(i + 1) + '7', S.HEADER, h);
    }).join('') + '</row>');

    var today = new Date().toISOString().slice(0, 10);
    entries.forEach(function (e, idx) {
      var r = first + idx;
      var offen = e.status !== 'Erledigt';
      var overdue = offen && e.faellig && e.faellig < today;
      var cells = [
        cellNum('A' + r, S.NR, e.nr),
        cellStr('B' + r, S.CELL, e.bereich),
        cellStr('C' + r, S.CELL, e.thema),
        cellStr('D' + r, PRIO_STYLE[e.prio] != null ? PRIO_STYLE[e.prio] : S.CELL, e.prio),
        cellStr('E' + r, e.verantwortlicher ? S.CELL : S.PFLEGE, e.verantwortlicher),
        cellStr('F' + r, overdue ? S.UEBERFAELLIG : (e.faellig ? S.CELL : S.PFLEGE), ddmmyyyy(e.faellig)),
        cellStr('G' + r, STATUS_STYLE[e.status] != null ? STATUS_STYLE[e.status] : S.CELL, e.status),
        cellStr('H' + r, S.CELL, e.todo),
        cellStr('I' + r, S.CELL, bildSpalte(e)),
        cellStr('J' + r, S.CELL, ddmmyyyy(e.erstelltAm))
      ];
      rows.push('<row r="' + r + '" ht="31.5" customHeight="1">' + cells.join('') + '</row>');
    });

    var sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>' +
      '<dimension ref="A1:J' + last + '"/>' +
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
        '<pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' +
        '<col min="1" max="1" width="5" customWidth="1"/>' +
        '<col min="2" max="2" width="20" customWidth="1"/>' +
        '<col min="3" max="3" width="30" customWidth="1"/>' +
        '<col min="4" max="4" width="10" customWidth="1"/>' +
        '<col min="5" max="5" width="18" customWidth="1"/>' +
        '<col min="6" max="6" width="12" customWidth="1"/>' +
        '<col min="7" max="7" width="12" customWidth="1"/>' +
        '<col min="8" max="8" width="60" customWidth="1"/>' +
        '<col min="9" max="9" width="22" customWidth="1"/>' +
        '<col min="10" max="10" width="14" customWidth="1"/>' +
      '</cols>' +
      '<sheetData>' + rows.join('') + '</sheetData>' +
      '<autoFilter ref="A7:J' + last + '"/>' +
      '<mergeCells count="3">' +
        '<mergeCell ref="A1:J1"/><mergeCell ref="A2:J2"/><mergeCell ref="H5:I5"/>' +
      '</mergeCells>' +
      '<dataValidations count="3">' +
        validation('list', 'D' + first + ':D' + last, '"Hoch,Mittel,Niedrig"') +
        validation('list', 'G' + first + ':G' + last, '"Offen,In Arbeit,Erledigt"') +
        validation('list', 'B' + first + ':B' + last,
          '"' + (opts.bereiche || []).join(',') + '"') +
      '</dataValidations>' +
      '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '</worksheet>';

    var files = [
      { name: '[Content_Types].xml', data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>') },
      { name: '_rels/.rels', data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>') },
      { name: 'xl/workbook.xml', data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="OPL 4NE1 Gen4" sheetId="1" r:id="rId1"/></sheets>' +
        '<calcPr calcId="0" fullCalcOnLoad="1"/>' +
        '</workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>') },
      { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) }
    ];

    return new Blob([zipBuild(files)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function validation(type, sqref, formula) {
    return '<dataValidation type="' + type + '" allowBlank="1" showInputMessage="1" ' +
      'showErrorMessage="0" sqref="' + sqref + '"><formula1>' + esc(formula) + '</formula1></dataValidation>';
  }

  function bildSpalte(e) {
    if (e.notiz) return e.notiz;
    if (e.bilder && e.bilder.length) {
      return 's. Anhang im OPL-Tool (' + e.bilder.length +
        (e.bilder.length === 1 ? ' Bild)' : ' Bilder)');
    }
    return '';
  }

  /* ------------------------------------------------------------------ */
  /* Import                                                              */
  /* ------------------------------------------------------------------ */

  function textOf(node) {
    // <si> kann aus mehreren <r>-Runs bestehen; <t> jeweils einsammeln.
    var ts = node.getElementsByTagName('t');
    var s = '';
    for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }

  function serialToIso(n) {
    // Excel-Seriennummer (1900-System, inkl. bekanntem Schaltjahr-Bug)
    var ms = Math.round((n - 25569) * 86400000);
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function toIsoDate(raw) {
    if (raw == null || raw === '') return '';
    var s = String(raw).trim();
    var m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(s);
    if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    if (/^\d+(\.\d+)?$/.test(s)) {
      var n = parseFloat(s);
      if (n > 20000 && n < 80000) return serialToIso(n);
    }
    return '';
  }
  function pad(x) { return String(x).length < 2 ? '0' + x : String(x); }

  /**
   * Liest eine OPL-xlsx und gibt {entries:[...], warnungen:[...]} zurueck.
   * Erwartet das bekannte Schema: Kopfzeile mit "Nr"/"Bereich"/..., Daten darunter.
   */
  function importWorkbook(arrayBuffer) {
    return Promise.resolve().then(function () {
      return zipRead(arrayBuffer);
    }).then(function (zip) {
      var parser = new DOMParser();

      function xml(name) {
        if (!zip[name]) return null;
        var doc = parser.parseFromString(dec.decode(zip[name]), 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) {
          throw new Error('XML in ' + name + ' konnte nicht gelesen werden.');
        }
        return doc;
      }

      // Shared Strings
      var shared = [];
      var ssDoc = xml('xl/sharedStrings.xml');
      if (ssDoc) {
        var sis = ssDoc.getElementsByTagName('si');
        for (var i = 0; i < sis.length; i++) shared.push(textOf(sis[i]));
      }

      // Erstes Worksheet finden
      var sheetName = Object.keys(zip).filter(function (n) {
        return /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
      }).sort()[0];
      if (!sheetName) throw new Error('Kein Tabellenblatt in der Datei gefunden.');

      var doc = xml(sheetName);
      var rowNodes = doc.getElementsByTagName('row');
      var grid = {}; // row -> {col -> value}

      for (var r = 0; r < rowNodes.length; r++) {
        var cs = rowNodes[r].getElementsByTagName('c');
        for (var c = 0; c < cs.length; c++) {
          var cell = cs[c];
          var ref = parseRef(cell.getAttribute('r'));
          if (!ref) continue;
          var t = cell.getAttribute('t');
          var val = '';
          if (t === 'inlineStr') {
            var is = cell.getElementsByTagName('is')[0];
            val = is ? textOf(is) : '';
          } else {
            var v = cell.getElementsByTagName('v')[0];
            var raw = v ? v.textContent : '';
            if (t === 's') val = shared[parseInt(raw, 10)] || '';
            else if (t === 'b') val = raw === '1' ? 'WAHR' : 'FALSCH';
            else val = raw;
          }
          if (val === '') continue;
          (grid[ref.row] = grid[ref.row] || {})[ref.col] = val;
        }
      }

      // Kopfzeile suchen: Zeile, in der Spalte A "Nr" steht
      var headerRow = null;
      Object.keys(grid).map(Number).sort(function (a, b) { return a - b; }).some(function (rn) {
        var row = grid[rn];
        if (row[1] && String(row[1]).trim().toLowerCase() === 'nr' &&
            row[2] && /bereich/i.test(String(row[2]))) { headerRow = rn; return true; }
        return false;
      });
      if (headerRow == null) {
        throw new Error('Kopfzeile nicht gefunden. Erwartet wird eine Zeile mit "Nr" in Spalte A ' +
          'und "Bereich" in Spalte B (Schema der OPL-Excel).');
      }

      var entries = [];
      var warnungen = [];
      var rowNums = Object.keys(grid).map(Number).filter(function (n) { return n > headerRow; })
        .sort(function (a, b) { return a - b; });

      rowNums.forEach(function (rn) {
        var row = grid[rn];
        var nrRaw = row[1];
        var todo = (row[8] || '').trim();
        var thema = (row[3] || '').trim();
        if (!nrRaw && !todo && !thema) return; // Leerzeile

        var nr = parseInt(String(nrRaw).replace(/\D/g, ''), 10);
        if (!nr) { warnungen.push('Zeile ' + rn + ': keine gueltige Nr – uebersprungen.'); return; }

        var prio = normalize(row[4], ['Hoch', 'Mittel', 'Niedrig']);
        if (!prio) {
          if (row[4]) warnungen.push('Zeile ' + rn + ': Prio "' + row[4] + '" unbekannt – auf "Mittel" gesetzt.');
          prio = 'Mittel';
        }
        var status = normalize(row[7], ['Offen', 'In Arbeit', 'Erledigt']);
        if (!status) {
          if (row[7]) warnungen.push('Zeile ' + rn + ': Status "' + row[7] + '" unbekannt – auf "Offen" gesetzt.');
          status = 'Offen';
        }
        var faellig = toIsoDate(row[6]);
        if (row[6] && !faellig) warnungen.push('Zeile ' + rn + ': Datum "' + row[6] + '" nicht lesbar – leer gelassen.');

        var erstelltAm = toIsoDate(row[10]);
        if (row[10] && !erstelltAm) warnungen.push('Zeile ' + rn + ': Erstellt-am-Datum "' + row[10] + '" nicht lesbar – leer gelassen.');

        entries.push({
          nr: nr,
          bereich: (row[2] || '').trim() || 'Hardware/Mechanik',
          thema: thema,
          prio: prio,
          verantwortlicher: (row[5] || '').trim(),
          faellig: faellig,
          status: status,
          todo: todo,
          bilder: [],
          notiz: (row[9] || '').trim(),
          erstelltAm: erstelltAm
        });
      });

      if (!entries.length) throw new Error('Die Datei enthaelt keine lesbaren OPL-Zeilen.');
      return { entries: entries, warnungen: warnungen };
    });
  }

  function normalize(value, allowed) {
    if (!value) return null;
    var s = String(value).trim().toLowerCase();
    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i].toLowerCase() === s) return allowed[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------ */

  global.OPLXlsx = {
    exportWorkbook: exportWorkbook,
    importWorkbook: importWorkbook,
    ddmmyyyy: ddmmyyyy,
    toIsoDate: toIsoDate
  };
})(window);
