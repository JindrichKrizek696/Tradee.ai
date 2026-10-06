#!/usr/bin/env python3
"""Převede data starého sdíleného účtu (`jindra`, z nginx hlaviček) na Google ID přihlášeného uživatele.
Použití: python3 scripts/migrate-legacy-user.py g:<sub> [--apply]   (bez --apply jen vypíše, co by se změnilo)
Spouštět až po prvním přihlášení – řádek members s novým ID už musí existovat. Předtím scripts/backup.sh."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD = 'jindra'


def statements(old, new):
    if old == new:
        raise ValueError('staré a nové ID je stejné')
    return [
        ('DELETE FROM watch_flags WHERE user_id=%s AND instrument IN (SELECT instrument FROM (SELECT instrument FROM watch_flags WHERE user_id=%s) x)', (new, old)),
        ("UPDATE watch_flags SET id=CONCAT(%s,':',instrument), user_id=%s WHERE user_id=%s", (new, new, old)),
        ('UPDATE trades SET user_id=%s WHERE user_id=%s', (new, old)),
        ('DELETE FROM progress WHERE user_id=%s AND lesson_id IN (SELECT lesson_id FROM (SELECT lesson_id FROM progress WHERE user_id=%s) x)', (new, old)),
        ("UPDATE progress SET id=CONCAT(%s,':',lesson_id), user_id=%s WHERE user_id=%s", (new, new, old)),
        ('UPDATE messages SET user_id=%s WHERE user_id=%s', (new, old)),
        ('UPDATE members m JOIN members o ON o.id=%s SET m.palette=o.palette WHERE m.id=%s AND o.palette IS NOT NULL', (old, new)),
        ('DELETE FROM members WHERE id=%s', (old,)),
    ]


def main():
    import pymysql
    sys.path.insert(0, str(ROOT / 'scripts'))
    from importlib import import_module
    load_env = import_module('mariadb-migrate').load_env
    args = [a for a in sys.argv[1:] if a != '--apply']
    if len(args) != 1 or not args[0].startswith('g:'):
        sys.exit('Použití: migrate-legacy-user.py g:<sub> [--apply]')
    new, apply = args[0], '--apply' in sys.argv
    cfg = load_env(ROOT / '.mariadb.env')
    conn = pymysql.connect(host=cfg['MARIADB_HOST'], port=int(cfg.get('MARIADB_PORT', 3306)), user=cfg['MARIADB_USER'], password=cfg['MARIADB_PASSWORD'], database=cfg['MARIADB_DB'], charset='utf8mb4', autocommit=False)
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT COUNT(*) FROM members WHERE id=%s', (new,))
            if cur.fetchone()[0] != 1:
                sys.exit(f'{new} v members není – nejdřív se přihlas.')
            for t in ('trades', 'watch_flags', 'progress', 'messages'):
                cur.execute(f'SELECT COUNT(*) FROM {t} WHERE user_id=%s', (OLD,))
                print(f'{t}: {cur.fetchone()[0]} řádků {OLD} → {new}')
            if not apply:
                print('Nanečisto. Spusť s --apply.')
                return
            for sql, params in statements(OLD, new):
                cur.execute(sql, params)
        conn.commit()
        print('Hotovo.')
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
