#!/usr/bin/env python3
"""
OPL-Datenspiegel: holt die OPL 4NE1 Gen4 per Lese-Token und legt sie in einer
SQLite-Datenbank auf dem internen Server ab (nur Python-Standardbibliothek).

- Punkte: aktueller Stand je OPL-Nr. plus Verlauf jeder gesehenen Version
- Protokoll: alle Änderungen (wer, wann, welches Feld, alt -> neu)
- Auswertungs-Views für Lessons Learned (siehe auswertung.sql)

Abgeholt wird inkrementell: nur seit dem letzten Lauf geänderte Punkte und
neue Protokollzeilen. Einmal am Tag (bzw. beim ersten Lauf) kommt die volle
Liste, damit gelöschte Punkte erkannt werden.

Konfiguration (Umgebungsvariablen oder Dateien neben dem Skript):
  OPL_URL         Adresse der OPL (Standard: siehe STANDARD_URL)
  OPL_READ_TOKEN  Lese-Token; alternativ Datei "token.txt" neben dem Skript
  OPL_DB          Pfad der SQLite-Datei (Standard: opl_spiegel.sqlite neben dem Skript)

Aufruf:  python opl_spiegel.py            (normaler Lauf)
         python opl_spiegel.py --voll     (volle Liste erzwingen)
"""
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

STANDARD_URL = 'https://opl-gen4-overview.david-rybinski.workers.dev'
HIER = os.path.dirname(os.path.abspath(__file__))
VOLL_NACH_STUNDEN = 24

FELDER = ['bereich', 'thema', 'unterthema', 'prio', 'status', 'verantwortlicher', 'verantwortlichkeit',
          'baugruppe', 'seite', 'nacharbeit', 'zielRelease', 'komponenten', 'release', 'faellig', 'todo',
          'notiz', 'lhTitel', 'anforderung', 'erstelltAm', 'geaendertAm', 'geaendertVon']
SPALTE = {f: re.sub(r'([A-Z])', lambda m: '_' + m.group(1).lower(), f) for f in FELDER}

SCHEMA = """
CREATE TABLE IF NOT EXISTS punkte (
  nr INTEGER PRIMARY KEY, bereich TEXT, thema TEXT, unterthema TEXT, prio TEXT, status TEXT,
  verantwortlicher TEXT, verantwortlichkeit TEXT, baugruppe TEXT, seite TEXT, nacharbeit TEXT,
  ziel_release TEXT, komponenten TEXT, release TEXT, faellig TEXT, todo TEXT, notiz TEXT,
  lh_titel TEXT, anforderung TEXT, erstellt_am TEXT, geaendert_am TEXT, geaendert_von TEXT,
  bilder_anzahl INTEGER DEFAULT 0, geloescht_am TEXT, zuletzt_abgerufen TEXT
);
CREATE TABLE IF NOT EXISTS punkte_verlauf (
  nr INTEGER NOT NULL, geaendert_am TEXT NOT NULL, daten TEXT NOT NULL, abgerufen_am TEXT NOT NULL,
  PRIMARY KEY (nr, geaendert_am)
);
CREATE TABLE IF NOT EXISTS protokoll (
  id INTEGER PRIMARY KEY, nr INTEGER, text TEXT, wann TEXT, wer TEXT,
  feld TEXT, alt TEXT, neu TEXT
);
CREATE INDEX IF NOT EXISTS idx_protokoll_nr ON protokoll (nr);
CREATE INDEX IF NOT EXISTS idx_protokoll_feld ON protokoll (feld);
CREATE TABLE IF NOT EXISTS abrufe (
  id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT, art TEXT, punkte INTEGER, protokoll INTEGER, fehler TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""

# Protokolltexte wie: status: "Offen" → "Erledigt"   bzw.  zielRelease: "–" → "4.1.1" (automatisch, erledigt)
AENDERUNG = re.compile(r'^(\w+): "(.*)" → "(.*?)"')


def jetzt():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def konfig():
    url = os.environ.get('OPL_URL', STANDARD_URL).rstrip('/')
    token = os.environ.get('OPL_READ_TOKEN', '').strip()
    if not token and os.path.exists(os.path.join(HIER, 'token.txt')):
        with open(os.path.join(HIER, 'token.txt'), encoding='utf-8') as f:
            token = f.read().strip()
    if not token:
        sys.exit('Kein Lese-Token: Umgebungsvariable OPL_READ_TOKEN setzen oder token.txt neben das Skript legen.')
    db = os.environ.get('OPL_DB', os.path.join(HIER, 'opl_spiegel.sqlite'))
    return url, token, db


def holen(url, token, pfad, **params):
    q = ('?' + urllib.parse.urlencode(params)) if params else ''
    req = urllib.request.Request(url + pfad + q, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:  # nutzt den Windows-Proxy automatisch
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise SystemExit('Token abgelehnt (401). Ist READ_TOKEN im Cloudflare-Worker gesetzt und identisch?')
        raise


def meta(con, key, wert=None):
    if wert is None:
        row = con.execute('SELECT value FROM meta WHERE key = ?', (key,)).fetchone()
        return row[0] if row else None
    con.execute('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', (key, wert))


def punkte_speichern(con, eintraege, zeit):
    neueste = ''
    for e in eintraege:
        werte = {SPALTE[f]: (e.get(f) or '') for f in FELDER}
        werte['nr'] = e['nr']
        werte['bilder_anzahl'] = len(e.get('bilder') or [])
        werte['zuletzt_abgerufen'] = zeit
        spalten = list(werte)
        con.execute(
            'INSERT INTO punkte (%s, geloescht_am) VALUES (%s, NULL) ON CONFLICT(nr) DO UPDATE SET %s, geloescht_am = NULL' % (
                ', '.join(spalten), ', '.join('?' * len(spalten)),
                ', '.join('%s = excluded.%s' % (s, s) for s in spalten if s != 'nr')),
            [werte[s] for s in spalten])
        daten = {k: v for k, v in e.items() if k != 'bilder'}
        daten['bilder_anzahl'] = werte['bilder_anzahl']
        con.execute('INSERT OR IGNORE INTO punkte_verlauf (nr, geaendert_am, daten, abgerufen_am) VALUES (?, ?, ?, ?)',
                    (e['nr'], werte['geaendert_am'] or zeit, json.dumps(daten, ensure_ascii=False), zeit))
        if werte['geaendert_am'] > neueste:
            neueste = werte['geaendert_am']
    return neueste


def protokoll_holen(con, url, token):
    letzte = int(meta(con, 'letzte_log_id') or 0)
    neu = 0
    while True:
        zeilen = holen(url, token, '/api/log', nach_id=letzte, limit=5000)
        for z in zeilen:
            m = AENDERUNG.match(z.get('text') or '')
            con.execute('INSERT OR IGNORE INTO protokoll (id, nr, text, wann, wer, feld, alt, neu) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        (z['id'], z.get('nr'), z.get('text'), z.get('wann'), z.get('wer'),
                         m.group(1) if m else None, m.group(2) if m else None, m.group(3) if m else None))
            letzte = max(letzte, int(z['id']))
        neu += len(zeilen)
        meta(con, 'letzte_log_id', str(letzte))
        if len(zeilen) < 5000:
            return neu


def views_anlegen(con):
    with open(os.path.join(HIER, 'auswertung.sql'), encoding='utf-8') as f:
        con.executescript(f.read())


def lauf(voll_erzwingen=False):
    url, token, pfad = konfig()
    con = sqlite3.connect(pfad)
    con.executescript(SCHEMA)
    zeit = jetzt()
    seit = meta(con, 'letzte_zeit')
    letzte_voll = meta(con, 'letzte_voll')
    voll = voll_erzwingen or not seit or not letzte_voll or \
        dt.datetime.fromisoformat(letzte_voll.replace('Z', '+00:00')) < dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=VOLL_NACH_STUNDEN)
    try:
        eintraege = holen(url, token, '/api/entries') if voll else holen(url, token, '/api/entries', seit=seit)
        with con:
            neueste = punkte_speichern(con, eintraege, zeit)
            if voll:
                # Punkte, die es in der OPL nicht mehr gibt, als gelöscht markieren
                nrs = [e['nr'] for e in eintraege]
                con.execute('UPDATE punkte SET geloescht_am = ? WHERE geloescht_am IS NULL AND nr NOT IN (%s)' % (
                    ','.join('?' * len(nrs)) or 'NULL'), [zeit] + nrs)
                meta(con, 'letzte_voll', zeit)
            if neueste and neueste > (seit or ''):
                meta(con, 'letzte_zeit', neueste)
            n_log = protokoll_holen(con, url, token)
            con.execute('INSERT INTO abrufe (zeit, art, punkte, protokoll) VALUES (?, ?, ?, ?)',
                        (zeit, 'voll' if voll else 'änderungen', len(eintraege), n_log))
        views_anlegen(con)
        print('%s %s: %d Punkte, %d neue Protokollzeilen -> %s' % (zeit, 'voll' if voll else 'Änderungen', len(eintraege), n_log, pfad))
    except Exception as err:
        with con:
            con.execute('INSERT INTO abrufe (zeit, art, fehler) VALUES (?, ?, ?)', (zeit, 'fehler', str(err)))
        raise
    finally:
        con.close()


if __name__ == '__main__':
    lauf(voll_erzwingen='--voll' in sys.argv)
