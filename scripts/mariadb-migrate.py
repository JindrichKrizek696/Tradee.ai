#!/usr/bin/env python3
"""Aplikuje migrace z drizzle/mariadb/*.sql do MariaDB. Každý soubor se zapíše do schema_migrations a spustí jen jednou.
Použití: python3 scripts/mariadb-migrate.py [cesta k .env]   (výchozí .mariadb.env v kořeni projektu)"""
import sys
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[1]


def load_env(path):
    cfg = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            cfg[k.strip()] = v.strip()
    return cfg


def main():
    cfg = load_env(sys.argv[1] if len(sys.argv) > 1 else ROOT / '.mariadb.env')
    conn = pymysql.connect(host=cfg['MARIADB_HOST'], port=int(cfg.get('MARIADB_PORT', 3306)), user=cfg['MARIADB_USER'], password=cfg['MARIADB_PASSWORD'], database=cfg['MARIADB_DB'], charset='utf8mb4', autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations(name VARCHAR(128) PRIMARY KEY, applied_at DATETIME NOT NULL)")
            cur.execute("SELECT name FROM schema_migrations")
            done = {r[0] for r in cur.fetchall()}
            for file in sorted((ROOT / 'drizzle' / 'mariadb').glob('*.sql')):
                if file.name in done:
                    continue
                statements = [s.strip() for s in file.read_text(encoding='utf-8').split('--> statement-breakpoint')]
                for st in statements:
                    st = '\n'.join(l for l in st.splitlines() if not l.strip().startswith('--')).strip()
                    if st:
                        cur.execute(st)
                cur.execute("INSERT INTO schema_migrations(name, applied_at) VALUES(%s, UTC_TIMESTAMP())", (file.name,))
                print('applied', file.name)
            print('migrations up to date for', cfg['MARIADB_DB'])
    finally:
        conn.close()


if __name__ == '__main__':
    main()
