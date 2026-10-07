#!/usr/bin/env python3
"""Údržba MT dat: snímky účtů starší 90 dní zredukuje na jeden za hodinu (první v každé hodině).
Použití: python3 scripts/mt_maintenance.py"""
import sys
import time
from importlib import import_module
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    import pymysql
    sys.path.insert(0, str(ROOT / 'scripts'))
    cfg = import_module('mariadb-migrate').load_env(ROOT / '.mariadb.env')
    cutoff = int((time.time() - 90 * 86400) * 1000)
    conn = pymysql.connect(host=cfg['MARIADB_HOST'], port=int(cfg.get('MARIADB_PORT', 3306)), user=cfg['MARIADB_USER'], password=cfg['MARIADB_PASSWORD'], database=cfg['MARIADB_DB'], charset='utf8mb4', autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute('''DELETE s FROM mt_snapshots s
                LEFT JOIN (SELECT account_id, MIN(ts) AS keep_ts FROM mt_snapshots WHERE ts < %s GROUP BY account_id, FLOOR(ts / 3600000)) k
                  ON k.account_id = s.account_id AND k.keep_ts = s.ts
                WHERE s.ts < %s AND k.keep_ts IS NULL''', (cutoff, cutoff))
            print('mt údržba: smazáno', cur.rowcount, 'starých snímků')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
