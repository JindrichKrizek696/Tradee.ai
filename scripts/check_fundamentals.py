#!/usr/bin/env python3
"""Kontrola výstupu agenta fundamentů: porovná starý a nový data/fundamentals.json.
Použití: check_fundamentals.py OLD NEW [--now ISO]  → exit 0 = přijato, 1 = odmítnuto (důvod na stdout)."""
import json
import sys
from datetime import datetime, timedelta, timezone

CURRENCIES = {'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD'}
FROZEN = ('schemaVersion', 'methodVersion', 'staleAfterHours', 'reviewCadenceHours')


def parse_time(s):
    t = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def validate(old, new_text, now):
    """Vrátí (True, shrnutí) nebo (False, důvod). Neočekávaný tvar dat = odmítnutí s důvodem, nikdy pád."""
    try:
        return _validate(old, new_text, now)
    except Exception as e:  # noqa: BLE001
        return False, f'neočekávaný tvar dat: {type(e).__name__}: {e}'[:300]


def same_kind(a, b):
    """Stejný typ JSON hodnoty (int a float se berou jako číslo)."""
    num = (int, float)
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b)
    return (isinstance(a, num) and isinstance(b, num)) or type(a) is type(b)


def _validate(old, new_text, now):
    try:
        new = json.loads(new_text)
    except ValueError as e:
        return False, f'neplatný JSON: {e}'
    if not isinstance(new, dict):
        return False, 'kořen není objekt'
    missing = [k for k in old if k not in new]
    if missing:
        return False, 'chybí klíče: ' + ', '.join(missing)
    wrong = [k for k in old if old[k] is not None and not same_kind(old[k], new[k])]
    if wrong:
        return False, 'změněný typ klíčů: ' + ', '.join(wrong)
    cur = new.get('currencies')
    if not isinstance(cur, dict) or set(cur) != CURRENCIES:
        return False, 'currencies musí mít přesně 8 měn ' + ' '.join(sorted(CURRENCIES))
    for c, v in cur.items():
        if not isinstance(v, dict) or not isinstance(v.get('factors'), dict):
            return False, f'měně {c} chybí factors'
        for name, f in v['factors'].items():
            if isinstance(f, dict) and isinstance(f.get('value'), (int, float)) and not (f.get('source') and f.get('reason')):
                return False, f'faktor {c}.{name} má hodnotu bez zdroje nebo zdůvodnění'
    for k in FROZEN:
        if new.get(k) != old.get(k):
            return False, f'změna metodiky ({k}) není povolená'
    oh, nh = old.get('history', []), new.get('history')
    if not isinstance(nh, list) or len(nh) < len(oh):
        return False, 'historie se zkrátila'
    if nh[:len(oh)] != oh:
        return False, 'změněný starší záznam historie'
    try:
        nc, oc = parse_time(new['checkedAt']), parse_time(old['checkedAt'])
    except (KeyError, ValueError):
        return False, 'checkedAt není ISO čas'
    if nc <= oc:
        return False, 'checkedAt není novější než předchozí'
    if nc > now + timedelta(minutes=10):
        return False, 'checkedAt je v budoucnosti'
    for e in new.get('events', []):
        if not isinstance(e, dict):
            return False, 'událost není objekt'
        if not all(e.get(k) for k in ('id', 'at', 'title', 'source')):
            return False, f"událost {e.get('id', '?')} nemá id/at/title/source"
        try:
            parse_time(e['at'])
        except ValueError:
            return False, f"událost {e['id']} má neplatné at"
    if len(new_text) < 0.5 * len(json.dumps(old, ensure_ascii=False)):
        return False, 'soubor se zmenšil o víc než polovinu'
    changed = sum(1 for c in CURRENCIES if cur[c] != old['currencies'].get(c))
    added = len({e['id'] for e in new.get('events', [])} - {e['id'] for e in old.get('events', [])})
    return True, f'ok: {changed} měn se změnou, {added} nových událostí'


def main(argv):
    if len(argv) < 3:
        print('použití: check_fundamentals.py OLD NEW [--now ISO]')
        return 2
    now = parse_time(argv[argv.index('--now') + 1]) if '--now' in argv else datetime.now(timezone.utc)
    with open(argv[1], encoding='utf-8') as f:
        old = json.load(f)
    with open(argv[2], encoding='utf-8') as f:
        text = f.read()
    ok, msg = validate(old, text, now)
    print(msg)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
