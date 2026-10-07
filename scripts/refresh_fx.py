#!/usr/bin/env python3
"""Denní kurzy ECB (posledních 90 dní) do tabulky fx_rates – pro přepočet P&L MetaTrader účtů do měny souhrnu.
Použití: python3 scripts/refresh_fx.py          (čte .mariadb.env v kořeni projektu)
         python3 scripts/refresh_fx.py --full   (celá historie ECB od 1999 – jednorázově, kvůli starším obchodům)"""
import sys
import urllib.request
import xml.etree.ElementTree as ET
from importlib import import_module
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'
URL_FULL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
BATCH = 5000


def batches(rows, size=BATCH):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def parse_rates(xml_text):
    out = []
    for cube in ET.fromstring(xml_text).iter():
        day = cube.attrib.get('time')
        if not day:
            continue
        out.append((day, 'EUR', 1.0))
        for c in cube:
            out.append((day, c.attrib['currency'], float(c.attrib['rate'])))
    if not out:
        raise ValueError('ECB XML neobsahuje žádné kurzy')
    return out


def main(argv=None):
    full = '--full' in (sys.argv[1:] if argv is None else argv)
    import pymysql
    sys.path.insert(0, str(ROOT / 'scripts'))
    cfg = import_module('mariadb-migrate').load_env(ROOT / '.mariadb.env')
    req = urllib.request.Request(URL_FULL if full else URL, headers={'User-Agent': 'Mozilla/5.0 (compatible; TradeeFx/1.0; +https://tradee.eu)'})
    rows = parse_rates(urllib.request.urlopen(req, timeout=120 if full else 30).read().decode('utf-8'))
    conn = pymysql.connect(host=cfg['MARIADB_HOST'], port=int(cfg.get('MARIADB_PORT', 3306)), user=cfg['MARIADB_USER'], password=cfg['MARIADB_PASSWORD'], database=cfg['MARIADB_DB'], charset='utf8mb4', autocommit=True)
    try:
        with conn.cursor() as cur:
            for chunk in batches(rows):
                cur.executemany('INSERT INTO fx_rates(date,currency,per_eur) VALUES(%s,%s,%s) ON DUPLICATE KEY UPDATE per_eur=VALUES(per_eur)', chunk)
    finally:
        conn.close()
    print('fx ok:', len(rows), 'kurzů')


if __name__ == '__main__':
    main()
