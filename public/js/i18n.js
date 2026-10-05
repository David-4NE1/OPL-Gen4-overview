/*
 * i18n.js – Deutsch/Englisch-Umschaltung der Oberflaeche.
 *
 * Schluessel ist der deutsche Originaltext; T('Speichern') liefert im
 * englischen Modus 'Save'. Platzhalter: T('Punkt #{nr}', {nr: 5}).
 * Statische Texte im HTML werden ueber data-i18n* Attribute uebersetzt.
 * Die Sprache gilt pro Browser (localStorage); ein Wechsel laedt die Seite neu.
 * Gespeichert wird immer auf Deutsch – auch Auswahlwerte wie Bereich/Status.
 */
(function (global) {
  'use strict';

  var KEY = 'opl.lang';
  var lang = 'de';
  try { if (global.localStorage.getItem(KEY) === 'en') lang = 'en'; } catch (e) {}

  var EN = {
    // Login
    'Anmeldung': 'Sign in',
    'E-Mail': 'Email',
    'Passwort': 'Password',
    'Anmelden': 'Sign in',
    'Falsches Passwort': 'Wrong password',
    'E-Mail-Adresse oder Passwort falsch': 'Email address or password incorrect',
    'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen': 'Too many failed attempts – please try again in 15 minutes',
    'Nur für Admins erlaubt': 'Admins only',
    'Nur für Admins erlaubt.': 'Admins only.',
    'Nur Lesezugriff – Bearbeiten ist für diesen Zugang nicht freigeschaltet': 'Read-only access – editing is not enabled for this account',
    'Nur Lesezugriff – Bearbeiten ist für deinen Zugang nicht freigeschaltet.': 'Read-only access – editing is not enabled for your account.',
    'Angemeldet als – wird im Änderungsprotokoll mitgeschrieben': 'Signed in as – recorded in the change log',
    'Punkt #{nr} wurde inzwischen von {wer} geändert ({felder}).\n\nOK: deine Änderung trotzdem speichern (überschreibt die von {wer}).\nAbbrechen: die Änderung von {wer} behalten.': 'Item #{nr} was changed in the meantime by {wer} ({felder}).\n\nOK: save your change anyway (overwrites {wer}\'s).\nCancel: keep {wer}\'s change.',
    'jemand anderem': 'someone else',
    'Notiz': 'Note',
    'Release': 'Release',
    'Seite': 'Side',
    'Lesen': 'Read',
    'Admin': 'Admin',
    'Rolle': 'Role',
    'Rolle ändern': 'Change role',
    'Haupt-Admin, nicht änderbar': 'Main admin, cannot be changed',
    '{email}: Rolle {rolle}.': '{email}: role {rolle}.',
    '{n} Zugänge · {l} Lesen · {b} Bearbeiten · {a} Admin': '{n} accounts · {l} read · {b} edit · {a} admin',
    '{n} Adresse(n) mit Rolle {rolle} freigeschaltet.': '{n} address(es) enabled with role {rolle}.',
    'Neue E-Mail-Adressen (eine pro Zeile, auch mit Komma oder Semikolon getrennt)': 'New email addresses (one per line, or separated by comma or semicolon)',
    'Höchstens 200 Adressen auf einmal': 'At most 200 addresses at once',
    'Nur diese E-Mail-Adressen (@neura-robotics.com) dürfen sich anmelden. <b>Lesen</b>: ansehen und exportieren · <b>Bearbeiten</b>: Punkte anlegen und ändern · <b>Admin</b>: zusätzlich löschen, Import „Ersetzen“, Zurücksetzen und Zugriff verwalten. Entfernen wirkt sofort.': 'Only these email addresses (@neura-robotics.com) can sign in. <b>Read</b>: view and export · <b>Edit</b>: create and change items · <b>Admin</b>: also delete, import "Replace", reset and manage access. Removal takes effect immediately.',
    'Fehler': 'Error',
    'Verbindungsfehler': 'Connection error',
    'Nur @neura-robotics.com Adressen erlaubt': 'Only @neura-robotics.com addresses allowed',
    'Diese E-Mail-Adresse ist nicht zugelassen': 'This email address is not authorized',
    'vorname.nachname@neura-robotics.com': 'firstname.lastname@neura-robotics.com',

    // Kopfleiste / KPIs
    'Open Point List – Humanoid Entwicklung': 'Open Point List – Humanoid Development',
    'Open Point List · {n} Punkte · Stand {datum}': 'Open Point List · {n} items · as of {datum}',
    'offen': 'open',
    'Prio hoch': 'High prio',
    'mittel': 'medium',
    'niedrig': 'low',
    'überfällig': 'overdue',
    'erledigt': 'done',
    'Dein Name': 'Your name',
    'Wird im Änderungsprotokoll mitgeschrieben': 'Recorded in the change log',
    '+ Neuer Punkt': '+ New item',
    'Excel & mehr': 'Excel & more',
    'Sprache: Deutsch / English': 'Language: Deutsch / English',

    // Menue
    '⬇ Excel-Export (.xlsx)': '⬇ Excel export (.xlsx)',
    '⬇ CSV-Export': '⬇ CSV export',
    '⬆ Excel-Import (.xlsx)': '⬆ Excel import (.xlsx)',
    '🕓 Änderungsprotokoll': '🕓 Change log',
    '🗺 Roadmap / Releases': '🗺 Roadmap / releases',
    'Seite (aus Sicht des Roboters)': 'Side (from the robot\'s view)',
    'Links': 'Left',
    'Rechts': 'Right',
    'Beidseitig': 'Both sides',
    'Release-Zuordnung in der Roadmap ändern': 'Change release assignment in the roadmap',
    '↺ Auf Excel-Startstand zurücksetzen': '↺ Reset to Excel baseline',
    '🔐 Zugriff verwalten': '🔐 Manage access',
    '🚪 Abmelden': '🚪 Sign out',

    // Filterleiste
    'Suchen in Thema, To Do, Verantwortlicher …': 'Search topic, to do, owner …',
    'Alle Bereiche': 'All areas',
    'Alle Themen': 'All topics',
    'Alle Prios': 'All prios',
    'Alle Status': 'All statuses',
    'Alle Verantwortlichen': 'All owners',
    'Alle Verantwortlichkeiten': 'All responsibilities',
    'Alle Baugruppen': 'All assemblies',
    'Auswahl aufheben': 'Clear selection',
    'Nacharbeit': 'Rework',
    'Nacharbeit am Teil': 'Rework on part',
    'Nacharbeit: {v}': 'Rework: {v}',
    '(keine Nacharbeit)': '(no rework)',
    '– keine –': '– none –',
    // Feste Themen und Baugruppen
    'Thema': 'Topic',
    'Baugruppe': 'Assembly',
    'Kollision & Bauraum': 'Collision & installation space',
    'Kabel & Steckverbinder': 'Cables & connectors',
    'Montage & Service': 'Assembly & service',
    'Verbindungstechnik & Toleranzen': 'Fasteners & tolerances',
    'Poka Yoke & Varianten': 'Poka-yoke & variants',
    'Auslegung & Simulation': 'Design calculation & simulation',
    'Thermik': 'Thermal',
    'Elektronik & Software': 'Electronics & software',
    'BOM/CAD & Dokumentation': 'BOM/CAD & documentation',
    'Industrialisierung & Design': 'Industrialisation & design',
    'Kopf': 'Head',
    'Torso': 'Torso',
    'Arm': 'Arm',
    'Pelvis/Hüfte': 'Pelvis/hip',
    'Bein': 'Leg',
    'Fuß': 'Foot',
    'Übergreifend': 'Cross-cutting',
    'Baugruppe offen': 'Assembly open',
    'Baugruppe setzen': 'Set assembly',
    'Baugruppe: {v}': 'Assembly: {v}',
    'Thema zuordnen': 'Assign topic',
    'Thema aus der Liste wählen': 'Choose a topic from the list',
    '(nicht zugeordnet)': '(not assigned)',
    'Bitte ein Thema aus der Liste wählen.': 'Please choose a topic from the list.',
    '– bitte wählen –': '– please choose –',
    'bisher: {t} (bitte neu wählen)': 'previously: {t} (please choose again)',
    'Ansicht': 'View',
    'Karten-Ansicht': 'Card view',
    'Tabellen-Ansicht': 'Table view',
    'Filter zurücksetzen': 'Reset filters',
    '✕ Zurücksetzen': '✕ Reset',
    'Zeige {n} von {gesamt} Punkten — {teile}': 'Showing {n} of {gesamt} items — {teile}',
    'Bereich: {v}': 'Area: {v}',
    'Thema: {v}': 'Topic: {v}',
    'Prio: {v}': 'Prio: {v}',
    'Status: {v}': 'Status: {v}',
    'Verantwortlich: {v}': 'Owner: {v}',
    'Verantwortlichkeit: {v}': 'Responsibility: {v}',
    'Suche: "{v}"': 'Search: "{v}"',
    'Prio Hoch': 'Prio high',
    'Prio Mittel': 'Prio medium',
    'Prio Niedrig': 'Prio low',
    'Überfällig': 'Overdue',
    '(offen)': '(open)',

    // Feste Werte (Anzeige; gespeichert wird der deutsche Wert)
    'Hardware/Mechanik': 'Hardware/Mechanics',
    'Elektrik/Elektronik': 'Electrical/Electronics',
    'Simulation/Berechnung': 'Simulation/Calculation',
    'Montage/Fertigung': 'Assembly/Manufacturing',
    'Design': 'Design',
    'Software': 'Software',
    'Advanced Development': 'Advanced Development',
    'Pre Series': 'Pre Series',
    'Hoch': 'High',
    'Mittel': 'Medium',
    'Niedrig': 'Low',
    'Offen': 'Open',
    'In Arbeit': 'In progress',
    'Erledigt': 'Done',

    // Board / Karten
    'Keine Punkte passen zu Filter und Suche.': 'No items match the filters and search.',
    'Noch keine Punkte – lege den ersten an oder importiere eine Excel.': 'No items yet – create the first one or import an Excel file.',
    '✓ Erledigt': '✓ Done',
    '⚠ {n} überfällig': '⚠ {n} overdue',
    '{a} erledigt, {b} in Arbeit, {c} offen': '{a} done, {b} in progress, {c} open',
    '1 Punkt': '1 item',
    '{n} Punkte': '{n} items',
    '(ohne Thema)': '(no topic)',
    'Bearbeiten': 'Edit',
    'Punkt {nr} bearbeiten': 'Edit item {nr}',
    'Erstellt: {datum}': 'Created: {datum}',
    'Klick: Prio wechseln (Hoch → Mittel → Niedrig)': 'Click: change prio (High → Medium → Low)',
    'Klick: Status wechseln (Offen → In Arbeit → Erledigt)': 'Click: change status (Open → In progress → Done)',
    'Fälligkeit ändern': 'Change due date',
    'Verantwortlichen setzen': 'Set owner',
    'Verantwortlichkeit offen': 'Responsibility open',
    'Verantwortlichkeit setzen (Advanced Development / Pre Series)': 'Set responsibility (Advanced Development / Pre Series)',
    'Bild zu Punkt {nr}': 'Image for item {nr}',
    'kein Datum': 'no date',
    '{datum} · heute': '{datum} · today',
    '{datum} · {n} T überfällig': '{datum} · {n} d overdue',
    '{datum} · in {n} T': '{datum} · in {n} d',
    '{n} Bild(er)': '{n} image(s)',

    // Tabelle
    'Nr': 'No.',
    'Bereich': 'Area',
    'Thema/Aufgabe': 'Topic/Task',
    'Prio': 'Prio',
    'Verantwortlicher': 'Owner',
    'Verantwortlichkeit': 'Responsibility',
    'Bis wann': 'Due',
    'Status': 'Status',
    'To Do': 'To do',
    'Bild': 'Image',

    // Bearbeiten-Dialog
    'Neuer Punkt': 'New item',
    'Punkt #{nr}': 'Item #{nr}',
    'Vorheriger (Alt+←)': 'Previous (Alt+←)',
    'Nächster (Alt+→)': 'Next (Alt+→)',
    '{a} von {b}': '{a} of {b}',
    'z. B. Lagerkonzept Kugellager': 'e.g. ball bearing concept',
    'z. B. Thorsten Grelle': 'e.g. Thorsten Grelle',
    '– offen –': '– open –',
    'Konkrete Beschreibung der Aufgabe': 'Concrete description of the task',
    'Notiz zur Bildspalte (Excel, Spalte „Bild“)': 'Note for the image column (Excel, column “Bild”)',
    'z. B. s. Anhang Thorsten (2 Bilder)': 'e.g. see attachment Thorsten (2 images)',
    'Bilder': 'Images',
    'Bild entfernen': 'Remove image',
    'Löschen': 'Delete',
    'Abbrechen': 'Cancel',
    'Speichern': 'Save',
    'Speichern & weiter ›': 'Save & next ›',
    'Inhalte werden auf Deutsch gespeichert – bitte auf Deutsch eintragen. Hier steht der Originaltext.':
      'Content is stored in German – please enter text in German. The fields show the original text.',
    'Bitte ein Thema angeben.': 'Please enter a topic.',
    'Punkt #{nr} angelegt.': 'Item #{nr} created.',
    'Punkt #{nr} gespeichert.': 'Item #{nr} saved.',
    'Punkt #{nr} wirklich löschen? Tipp: Status „Erledigt” behält die Historie.':
      'Really delete item #{nr}? Tip: status “Done” keeps the history.',
    'Punkt gelöscht.': 'Item deleted.',
    'Datei nicht lesbar: {name}': 'File not readable: {name}',
    'Kein gültiges Bild: {name}': 'Not a valid image: {name}',

    // Export / Import
    'Excel exportiert – gleiches Schema wie die bestehende Liste.': 'Excel exported – same layout as the existing list.',
    'Excel-Export fehlgeschlagen: {msg}': 'Excel export failed: {msg}',
    'CSV exportiert.': 'CSV exported.',
    'Filter aktiv: {n} von {g} Punkten.': 'Filter active: {n} of {g} items.',
    'Keine Punkte im aktuellen Filter – nichts zu exportieren.': 'No items in the current filter – nothing to export.',
    'Excel-Import': 'Excel import',
    'Erwartet wird das gewohnte OPL-Schema: Kopfzeile mit <b>Nr | Bereich | Thema/Aufgabe | Prio | Verantwortlicher | Bis wann | Status | To Do | Bild</b>, Daten darunter. Titel- und KPI-Zeilen darüber werden ignoriert.':
      'Expected is the usual OPL layout: header row with <b>Nr | Bereich | Thema/Aufgabe | Prio | Verantwortlicher | Bis wann | Status | To Do | Bild</b>, data below. Title and KPI rows above are ignored.',
    'Datei': 'File',
    'Wie einspielen?': 'How to import?',
    '<b>Zusammenführen</b> – Einträge mit gleicher Nr werden aktualisiert, neue kommen dazu.':
      '<b>Merge</b> – entries with the same no. are updated, new ones are added.',
    '<b>Ersetzen</b> – der aktuelle Stand wird komplett durch die Datei ersetzt.':
      '<b>Replace</b> – the current state is completely replaced by the file.',
    'Importieren': 'Import',
    'Datei wird gelesen …': 'Reading file …',
    '✓ {n} Zeilen gelesen · {treffer} davon mit bekannter Nr · {neu} neu': '✓ {n} rows read · {treffer} with known no. · {neu} new',
    '⚠ {n} Hinweis(e):': '⚠ {n} note(s):',
    'Der aktuelle Stand ({n} Punkte) wird komplett ersetzt. Fortfahren?': 'The current state ({n} items) will be replaced completely. Continue?',
    'Achtung: Die Datei enthält nur {i} von {n} Punkten. Beim Ersetzen werden {w} Punkte gelöscht. Wirklich fortfahren?': 'Warning: the file contains only {i} of {n} items. Replacing will delete {w} items. Really continue?',
    'Import fertig: Liste durch {n} Punkte aus der Excel ersetzt.': 'Import done: list replaced by {n} items from the Excel file.',
    'Import fertig: {a} aktualisiert, {n} neu.': 'Import done: {a} updated, {n} new.',
    'Wirklich alle Änderungen verwerfen und den Excel-Startstand (29 Punkte, 21.09.2026) wiederherstellen?':
      'Really discard all changes and restore the Excel baseline (29 items, 21.09.2026)?',
    'Startstand wiederhergestellt.': 'Baseline restored.',

    // Protokoll
    'Änderungsprotokoll': 'Change log',
    'Lade …': 'Loading …',
    'Noch keine Änderungen protokolliert.': 'No changes logged yet.',
    'Liste ': 'List ',
    'unbekannt': 'unknown',
    'Protokoll konnte nicht geladen werden.': 'Could not load the change log.',
    'Schließen': 'Close',
    'Vorheriges Bild': 'Previous image',
    'Nächstes Bild': 'Next image',

    // Admin
    'Zugriff verwalten': 'Manage access',
    'Nur diese E-Mail-Adressen (@neura-robotics.com) dürfen sich anmelden.': 'Only these email addresses (@neura-robotics.com) can sign in.',
    'Neue E-Mail-Adresse': 'New email address',
    'Hinzufügen': 'Add',
    '✕ entfernen': '✕ remove',
    '{email} den Zugang entziehen?': 'Revoke access for {email}?',
    '{email} entfernt.': '{email} removed.',
    '{email} hinzugefügt.': '{email} added.',
    'Entfernen fehlgeschlagen.': 'Removal failed.',
    'Konnte Liste nicht laden: {msg}': 'Could not load list: {msg}',
    'unbekannter Fehler': 'unknown error',
    'Kein Zugriff': 'No access',
    'Der Admin-Zugang kann nicht entfernt werden': 'The admin account cannot be removed',

    // Maschinelle Uebersetzung der Karteninhalte
    '🌐 Karteninhalte werden übersetzt …': '🌐 Translating card contents …',
    '🌐 Karteninhalte wurden maschinell aus dem Deutschen übersetzt (Cloudflare Workers AI) und können ungenau sein. Gespeichert wird auf Deutsch – der Bearbeiten-Dialog zeigt den Originaltext.':
      '🌐 Card contents were machine-translated from German (Cloudflare Workers AI) and may be inaccurate. Content is stored in German – the edit dialog shows the original text.',
    '⚠ Automatische Übersetzung derzeit nicht verfügbar – Karteninhalte werden auf Deutsch angezeigt.':
      '⚠ Automatic translation is currently unavailable – card contents are shown in German.',
    '🌐 übersetzt': '🌐 machine-translated',
    'Original (Deutsch): {text}': 'Original (German): {text}',

    // Verbindung / Bilder
    '⚠ Verbindung zum Server gestört – angezeigt wird ein älterer, im Browser gespeicherter Stand. Bitte keine Änderungen eintragen, bis dieser Hinweis verschwindet.':
      '⚠ Connection to the server is disrupted – an older state stored in the browser is shown. Please do not make changes until this notice disappears.',
    'Keine Verbindung zum Server – Import ist gerade nicht möglich.': 'No connection to the server – import is not possible right now.',
    'Keine Verbindung zum Server – Zurücksetzen ist gerade nicht möglich.': 'No connection to the server – reset is not possible right now.',
    'Speichern auf dem Server fehlgeschlagen: {msg}': 'Saving to the server failed: {msg}',
    'Excel wird erstellt …': 'Creating Excel file …',
    'Excel exportiert – {n} Bilder enthalten.': 'Excel exported – {n} images included.',
    'Excel exportiert, aber {f} von {g} Bildern konnten nicht geladen werden.': 'Excel exported, but {f} of {g} images could not be loaded.'
  };

  function fill(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return params[k] != null ? String(params[k]) : m;
    });
  }

  function T(de, params) {
    var s = (lang === 'en' && EN[de] != null) ? EN[de] : de;
    return fill(s, params);
  }

  function apply(root) {
    if (lang !== 'en') return;
    root = root || document;
    var each = function (sel, fn) {
      Array.prototype.forEach.call(root.querySelectorAll(sel), fn);
    };
    each('[data-i18n]', function (el) { el.textContent = T(el.textContent.trim()); });
    each('[data-i18n-html]', function (el) {
      var key = el.innerHTML.replace(/\s+/g, ' ').trim();
      if (EN[key] != null) el.innerHTML = EN[key];
    });
    each('[data-i18n-ph]', function (el) { el.placeholder = T(el.placeholder); });
    each('[data-i18n-title]', function (el) { el.title = T(el.title); });
    each('[data-i18n-aria]', function (el) { el.setAttribute('aria-label', T(el.getAttribute('aria-label'))); });
  }

  function setLang(next) {
    try { global.localStorage.setItem(KEY, next === 'en' ? 'en' : 'de'); } catch (e) {}
    global.location.reload();
  }

  function initToggles() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang-toggle]'), function (b) {
      b.textContent = lang === 'en' ? 'DE' : 'EN';
      b.title = T('Sprache: Deutsch / English');
      b.addEventListener('click', function () { setLang(lang === 'en' ? 'de' : 'en'); });
    });
  }

  document.documentElement.lang = lang;

  global.OPLi18n = {
    lang: function () { return lang; },
    isEn: function () { return lang === 'en'; },
    locale: function () { return lang === 'en' ? 'en-GB' : 'de-DE'; },
    T: T,
    apply: apply,
    setLang: setLang
  };

  function onReady() { apply(document); initToggles(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})(window);
