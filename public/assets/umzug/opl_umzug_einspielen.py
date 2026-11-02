#!/usr/bin/env python3
"""
OPL 4NE1 Gen4 - Datenpaket Umzug in eine SQLite-Datenbank einspielen.

Aufruf im entpackten Ordner des Datenpakets (nur Python-Standardbibliothek):

    python opl_umzug_einspielen.py                 -> erzeugt opl.sqlite
    python opl_umzug_einspielen.py ziel.sqlite     -> anderer Dateiname

Die Datenbank hat dieselbe Struktur wie die OPL in Cloudflare D1
(daten/schema.sql); Bilder stehen wie dort als data:-URL in der Spalte
"bilder". Zum Schluss wird die Anzahl je Tabelle mit manifest.json verglichen.
"""
import base64
import json
import os
import sqlite3
import sys

HIER = os.path.dirname(os.path.abspath(__file__))


def lesen(name):
    with open(os.path.join(HIER, name), encoding='utf-8') as f:
        return json.load(f)


def einfuegen(con, tabelle, zeilen):
    spalten_db = [r[1] for r in con.execute('PRAGMA table_info("%s")' % tabelle)]
    for z in zeilen:
        spalten = [s for s in z if s in spalten_db]
        con.execute('INSERT OR REPLACE INTO "%s" (%s) VALUES (%s)' % (
            tabelle, ', '.join('"%s"' % s for s in spalten), ', '.join('?' * len(spalten))),
            [z[s] for s in spalten])
    return len(zeilen)


def bilder_als_daten(punkt):
    bilder = []
    for b in punkt.get('bilder') or []:
        if not b.get('datei'):
            print('  Hinweis: OPL-%s - ein Bild fehlt im Paket (%s)' % (punkt.get('nr'), b.get('fehler', '')))
            continue
        with open(os.path.join(HIER, b['datei']), 'rb') as f:
            daten = base64.b64encode(f.read()).decode('ascii')
        bilder.append({'name': b.get('name', ''), 'src': 'data:%s;base64,%s' % (b.get('mime') or 'image/jpeg', daten)})
    return json.dumps(bilder, ensure_ascii=False)


def main():
    ziel = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HIER, 'opl.sqlite')
    if os.path.exists(ziel):
        sys.exit('%s gibt es schon - bitte erst umbenennen oder löschen.' % ziel)
    manifest = lesen('manifest.json')
    con = sqlite3.connect(ziel)
    with open(os.path.join(HIER, 'daten', 'schema.sql'), encoding='utf-8') as f:
        con.executescript(f.read())

    punkte = lesen('daten/punkte.json')
    for p in punkte:
        p['bilder'] = bilder_als_daten(p)
    zugriff = lesen('daten/zugriff.json')

    with con:
        ist = {
            'punkte': einfuegen(con, 'entries', punkte),
            'protokoll': einfuegen(con, 'changelog', lesen('daten/protokoll.json')),
            'forderungen': einfuegen(con, 'forderungen', lesen('daten/forderungen.json')),
            'lastenheft_ziele': einfuegen(con, 'lastenheft_ziele', lesen('daten/lastenheft_ziele.json')),
            'releases': einfuegen(con, 'releases', lesen('daten/releases.json')),
            'zugriff': einfuegen(con, 'allowed_emails', zugriff['freigaben']),
            'einstellungen': einfuegen(con, 'settings', lesen('daten/einstellungen.json')),
        }
    con.close()

    soll = manifest.get('anzahl', {})
    ok = True
    print('Tabelle            Soll    Ist')
    for k, n in ist.items():
        s = soll.get(k)
        markierung = '' if s is None or s == n else '   <-- ABWEICHUNG'
        ok = ok and not markierung
        print('%-16s %6s %6d%s' % (k, '' if s is None else s, n, markierung))
    print('\nFertig: %s%s' % (ziel, '' if ok else '  (bitte Abweichungen prüfen)'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
