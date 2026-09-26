#!/usr/bin/env python3
"""Zrcadlení dat Tradee.ai do MariaDB (db.dejny.eu).

Aplikace běží dál nad D1 (SQLite). Tento skript pravidelně:
- zrcadlí tabulky members, watch_flags a trades (a každou změnu zapíše do change_log),
- archivuje každou novou verzi datových souborů v data/ (gzip, deduplikace přes SHA-256),
- rozepíše historii skóre a pozorování ukazatelů do dotazovatelných tabulek.
Přihlašovací údaje čte z .mariadb.env v kořeni projektu (mimo Git).
"""
import datetime as dt
import glob
import gzip
import hashlib
import json
import sqlite3
import sys
from decimal import Decimal
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = ['fundamentals.json', 'score-market.json', 'expanded-market.json', 'score-history.json']
MIRROR = {
    'members': ['id', 'email', 'name', 'role'],
    'watch_flags': ['id', 'user_id', 'instrument', 'flag', 'updated'],
    'trades': ['id', 'user_id', 'date', 'instrument', 'pnl', 'note', 'created'],
}
DDL = [
    "CREATE TABLE IF NOT EXISTS members(id VARCHAR(128) PRIMARY KEY, email VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL, role VARCHAR(32) NOT NULL, synced_at DATETIME NOT NULL) CHARACTER SET utf8mb4",
    "CREATE TABLE IF NOT EXISTS watch_flags(id VARCHAR(191) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, instrument VARCHAR(64) NOT NULL, flag VARCHAR(16) NOT NULL, updated VARCHAR(40) NOT NULL, synced_at DATETIME NOT NULL, INDEX(user_id)) CHARACTER SET utf8mb4",
    "CREATE TABLE IF NOT EXISTS trades(id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, date DATE NOT NULL, instrument VARCHAR(64) NOT NULL, pnl DECIMAL(14,2) NOT NULL, note TEXT NOT NULL, created VARCHAR(40) NOT NULL, synced_at DATETIME NOT NULL, INDEX(user_id, date)) CHARACTER SET utf8mb4",
    "CREATE TABLE IF NOT EXISTS change_log(id BIGINT AUTO_INCREMENT PRIMARY KEY, `table` VARCHAR(32) NOT NULL, row_id VARCHAR(191) NOT NULL, action VARCHAR(8) NOT NULL, row_json LONGTEXT NULL, at DATETIME NOT NULL, INDEX(`table`, row_id), INDEX(at)) CHARACTER SET utf8mb4",
    "CREATE TABLE IF NOT EXISTS data_files(id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL, sha256 CHAR(64) NOT NULL, size_bytes INT NOT NULL, checked_at VARCHAR(40) NULL, content_gz LONGBLOB NOT NULL, synced_at DATETIME NOT NULL, UNIQUE KEY uq_name_sha(name, sha256), INDEX(name, synced_at)) CHARACTER SET utf8mb4",
    "CREATE TABLE IF NOT EXISTS score_snapshots(at VARCHAR(40) NOT NULL, instrument VARCHAR(64) NOT NULL, score DECIMAL(8,2) NULL, coverage INT NULL, method VARCHAR(32) NULL, parts LONGTEXT NULL, PRIMARY KEY(at, instrument), INDEX(instrument, at)) CHARACTER SET utf8mb4",
    "CREATE TABLE IF NOT EXISTS observations(currency VARCHAR(16) NOT NULL, indicator VARCHAR(64) NOT NULL, captured_at VARCHAR(40) NOT NULL, value TEXT NULL, period VARCHAR(64) NULL, checked_at VARCHAR(40) NULL, source_url TEXT NULL, note TEXT NULL, PRIMARY KEY(currency, indicator, captured_at)) CHARACTER SET utf8mb4",
    "CREATE TABLE IF NOT EXISTS sync_runs(id BIGINT AUTO_INCREMENT PRIMARY KEY, at DATETIME NOT NULL, status VARCHAR(16) NOT NULL, details TEXT) CHARACTER SET utf8mb4",
]


def load_env():
    cfg = {}
    for line in (ROOT / '.mariadb.env').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            cfg[k.strip()] = v.strip()
    return cfg


def sqlite_path():
    files = [f for f in sorted(glob.glob(str(ROOT / '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite'))) if not f.endswith('metadata.sqlite')]
    if not files:
        raise SystemExit('SQLite databáze D1 nebyla nalezena.')
    return files[0]


def norm(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float, Decimal)):
        return round(float(v), 2)
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


def mirror_table(cur, lite, table, cols, now, log):
    src = {}
    for row in lite.execute(f"SELECT {','.join(cols)} FROM {table}"):
        src[row[0]] = dict(zip(cols, row))
    cur.execute(f"SELECT {','.join(cols)} FROM `{table}`")
    dst = {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}
    ins = upd = dele = 0
    for key, row in src.items():
        old = dst.get(key)
        same = old is not None and all(norm(old[c]) == norm(row[c]) for c in cols)
        if same:
            continue
        cur.execute(
            f"INSERT INTO `{table}`({','.join(cols)},synced_at) VALUES({','.join(['%s'] * len(cols))},%s) "
            f"ON DUPLICATE KEY UPDATE {','.join(f'{c}=VALUES({c})' for c in cols)},synced_at=VALUES(synced_at)",
            [row[c] for c in cols] + [now])
        cur.execute("INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES(%s,%s,%s,%s,%s)",
                    (table, str(key), 'insert' if old is None else 'update', json.dumps(row, ensure_ascii=False), now))
        if old is None:
            ins += 1
        else:
            upd += 1
    for key, old in dst.items():
        if key in src:
            continue
        cur.execute(f"DELETE FROM `{table}` WHERE id=%s", (key,))
        cur.execute("INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES(%s,%s,%s,%s,%s)",
                    (table, str(key), 'delete', json.dumps({k: norm(v) for k, v in old.items()}, ensure_ascii=False), now))
        dele += 1
    log.append(f"{table}: {len(src)} řádků, +{ins} ~{upd} -{dele}")


def checked_at_of(name, obj):
    try:
        if name == 'fundamentals.json':
            return obj.get('checkedAt')
        if name in ('score-market.json', 'expanded-market.json'):
            return obj.get('refresh', {}).get('attemptedAt')
        if name == 'score-history.json':
            return obj['snapshots'][-1]['at'] if obj.get('snapshots') else None
    except Exception:
        return None
    return None


def archive_files(cur, now, log):
    added = 0
    for name in DATA_FILES:
        path = ROOT / 'data' / name
        if not path.exists():
            continue
        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        cur.execute("SELECT 1 FROM data_files WHERE name=%s AND sha256=%s", (name, sha))
        if cur.fetchone():
            continue
        try:
            checked = checked_at_of(name, json.loads(raw))
        except Exception:
            checked = None
        cur.execute("INSERT INTO data_files(name,sha256,size_bytes,checked_at,content_gz,synced_at) VALUES(%s,%s,%s,%s,%s,%s)",
                    (name, sha, len(raw), checked, gzip.compress(raw, 6), now))
        added += 1
    log.append(f"data_files: +{added} nových verzí")


def flatten_history(cur, log):
    path = ROOT / 'data' / 'score-history.json'
    if not path.exists():
        return
    hist = json.loads(path.read_text(encoding='utf-8'))
    snaps = obs = 0
    for s in hist.get('snapshots', []):
        for instrument, sc in s.get('scores', {}).items():
            cur.execute("INSERT IGNORE INTO score_snapshots(at,instrument,score,coverage,method,parts) VALUES(%s,%s,%s,%s,%s,%s)",
                        (s['at'], instrument, sc.get('score'), sc.get('coverage'), sc.get('method'), json.dumps(sc.get('parts'), ensure_ascii=False)))
            snaps += cur.rowcount
    for o in hist.get('observations', []):
        cur.execute("INSERT IGNORE INTO observations(currency,indicator,captured_at,value,period,checked_at,source_url,note) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                    (o.get('currency'), o.get('id'), o.get('capturedAt'), o.get('value'), o.get('period'), o.get('checkedAt'), o.get('sourceUrl'), o.get('note')))
        obs += cur.rowcount
    log.append(f"score_snapshots: +{snaps}, observations: +{obs}")


def main():
    cfg = load_env()
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None)
    log = []
    conn = pymysql.connect(host=cfg['MARIADB_HOST'], user=cfg['MARIADB_USER'], password=cfg['MARIADB_PASSWORD'], database=cfg['MARIADB_DB'], charset='utf8mb4', autocommit=False)
    try:
        with conn.cursor() as cur:
            for ddl in DDL:
                cur.execute(ddl)
            lite = sqlite3.connect(f"file:{sqlite_path()}?mode=ro", uri=True)
            try:
                for table, cols in MIRROR.items():
                    mirror_table(cur, lite, table, cols, now, log)
            finally:
                lite.close()
            archive_files(cur, now, log)
            flatten_history(cur, log)
            cur.execute("INSERT INTO sync_runs(at,status,details) VALUES(%s,%s,%s)", (now, 'ok', '; '.join(log)))
        conn.commit()
        print('sync ok:', '; '.join(log))
    except Exception as e:
        conn.rollback()
        try:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO sync_runs(at,status,details) VALUES(%s,%s,%s)", (now, 'error', str(e)[:2000]))
            conn.commit()
        except Exception:
            pass
        print('sync FAILED:', e, file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
