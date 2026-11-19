#!/usr/bin/env python3
"""Hlídač Tradee na VPS (cron každých 30 min): nic neopravuje, jen hlásí mailem, když něco přestane fungovat.

Kontroluje službu tradee.service a HTTPS, běh agenta fundamentů (fundamentals-cron.log), stáří a úplnost
data/fundamentals.json (prázdný faktor = pár bez skóre, viz NZD 19. 11. 2026), check-score.mjs,
refresh-vps.sh a refresh-live.sh, disk a zálohu.

Mail přes Resend (.notify.env: RESEND_API_KEY, MAIL_FROM) na HLIDAC_MAIL_TO. Posílá se jen při změně stavu
(nový problém, jiná sada problémů, uzdravení) a nejdřív po 24 h znovu, aby schránku nezaplavil.
Stav v ~/.tradee-hlidac.json. `--dry` jen vypíše, `--test` pošle zkušební mail.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(os.environ.get('TRADEE_ROOT', Path(__file__).resolve().parent.parent))
STATE = Path(os.environ.get('HLIDAC_STATE', Path.home() / '.tradee-hlidac.json'))
MAIL_TO = os.environ.get('HLIDAC_MAIL_TO', 'danslaby@email.cz')
URL = os.environ.get('HLIDAC_URL', 'https://tradee.eu')
REPEAT_AFTER = timedelta(hours=24)
AGENT_OK = ('ok', 'bez změny', 'push přeskočen', 'konflikt – ponechána ruční verze', 'zámek obsazen')
LOG_LINE = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)Z? · (.*?) · (.*?) · ')


def now_utc():
    return datetime.now(timezone.utc)


def parse_ts(s):
    s = s.strip().replace('Z', '+00:00')
    if re.match(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$', s):
        s += '+00:00'
    return datetime.fromisoformat(s)


def age(dt, now=None):
    return (now or now_utc()) - dt


def fmt_age(td):
    h = td.total_seconds() / 3600
    return f'{h:.0f} h' if h >= 1 else f'{td.total_seconds() / 60:.0f} min'


def sh(cmd, timeout=60):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=isinstance(cmd, str))
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 124, '', 'timeout')


# --- jednotlivé kontroly: každá vrací seznam problémů (prázdný = OK) ---------------------------------------

def check_service():
    r = sh(['systemctl', 'is-active', 'tradee'])
    return [] if r.stdout.strip() == 'active' else [f'služba tradee.service není active ({r.stdout.strip() or r.stderr.strip()})']


def check_http():
    r = sh(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', URL])
    return [] if r.stdout.strip() == '200' else [f'{URL} vrací {r.stdout.strip() or "nic"} místo 200']


def agent_status(line):
    """Z řádku fundamentals-cron.log vrátí (čas, stav) nebo None."""
    m = LOG_LINE.match(line)
    return (parse_ts(m.group(1)), m.group(3).strip()) if m else None


def check_agent(log_text, now, max_age=timedelta(hours=14)):
    lines = [l for l in log_text.splitlines() if l.strip()]
    if not lines:
        return ['fundamentals-cron.log je prázdný']
    parsed = agent_status(lines[-1])
    if not parsed:
        return [f'poslední řádek fundamentals-cron.log nejde přečíst: {lines[-1][:120]}']
    ts, status = parsed
    out = []
    if not status.startswith(AGENT_OK):
        out.append(f'agent fundamentů: poslední běh skončil „{status}“ ({lines[-1][:160]})')
    if age(ts, now) > max_age:
        out.append(f'agent fundamentů neběžel {fmt_age(age(ts, now))} (cron 06:30 a 18:30 UTC)')
    return out


def check_fundamentals(data, mtime, now, max_age=timedelta(hours=36)):
    out = []
    if age(mtime, now) > max_age:
        out.append(f'data/fundamentals.json je {fmt_age(age(mtime, now))} starý (limit {fmt_age(max_age)})')
    for cur, block in sorted(data.get('currencies', {}).items()):
        nulls = [k for k, f in block.get('factors', {}).items() if not isinstance(f, dict) or f.get('value') is None]
        if nulls:
            out.append(f'{cur}: prázdné faktory {", ".join(nulls)} → páry s {cur} nemají skóre'
                       + (' (a tím ani měnové indexy)' if len(nulls) else ''))
    return out


def check_score():
    # nvm potřebuje bash (pod /bin/sh skončí s kódem 3)
    cmd = f'cd {ROOT} && . ~/.nvm/nvm.sh >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1 && node --experimental-strip-types scripts/check-score.mjs'
    r = sh(['bash', '-c', cmd], timeout=120)
    if r.returncode == 0:
        return []
    err = (r.stderr or r.stdout).strip().splitlines()
    return ['check-score.mjs neprošel: ' + (err[0][:160] if err else f'exit {r.returncode}')]


def last_marker(text, pattern):
    """Čas posledního řádku `== <ISO čas> <text>` odpovídajícího vzoru."""
    ts = None
    for m in re.finditer(r'^== (\S+) ' + pattern, text, re.M):
        ts = m.group(1)
    return parse_ts(ts) if ts else None


def check_refresh(refresh_text, live_text, now):
    out = []
    r = last_marker(refresh_text, r'refresh start')
    if not r or age(r, now) > timedelta(hours=5):
        out.append('refresh-vps.sh neběžel ' + (fmt_age(age(r, now)) if r else 'nikdy') + ' (hodinově ve všední dny, po 4 h o víkendu)')
    l = last_marker(live_text, r'live')
    if not l or age(l, now) > timedelta(minutes=45):
        out.append('refresh-live.sh neběžel ' + (fmt_age(age(l, now)) if l else 'nikdy') + ' (každých 15 min)')
    return out


def check_disk(limit=85):
    r = sh(['df', '--output=pcent', '/'])
    try:
        pct = int(r.stdout.strip().splitlines()[-1].strip().rstrip('%'))
    except (ValueError, IndexError):
        return ['df / nejde přečíst']
    return [f'disk / je na {pct} % (limit {limit} %)'] if pct >= limit else []


def check_backup(backup_dir, backup_log, now, max_age=timedelta(hours=30)):
    dumps = sorted(backup_dir.glob('mariadb-*.sql.gz'), key=lambda p: p.stat().st_mtime)
    if not dumps:
        return [f'v {backup_dir} není žádný dump']
    out = []
    newest = datetime.fromtimestamp(dumps[-1].stat().st_mtime, timezone.utc)
    if age(newest, now) > max_age:
        out.append(f'poslední DB dump je {fmt_age(age(newest, now))} starý (limit {fmt_age(max_age)})')
    last = (backup_log.read_text(encoding='utf-8', errors='replace').strip().splitlines() or ['-'])[-1] if backup_log.exists() else '-'
    if ' ok' not in last:
        out.append(f'backup.log nekončí „ok“: {last[:120]}')
    return out


def run_checks(now):
    problems = []
    problems += check_service()
    problems += check_http()
    log = ROOT / 'fundamentals-cron.log'
    problems += check_agent(log.read_text(encoding='utf-8', errors='replace') if log.exists() else '', now)
    fj = ROOT / 'data' / 'fundamentals.json'
    try:
        problems += check_fundamentals(json.loads(fj.read_text(encoding='utf-8')),
                                       datetime.fromtimestamp(fj.stat().st_mtime, timezone.utc), now)
    except (OSError, ValueError) as e:
        problems.append(f'data/fundamentals.json nejde načíst: {e}')
    problems += check_score()
    rd = lambda p: p.read_text(encoding='utf-8', errors='replace') if p.exists() else ''
    problems += check_refresh(rd(ROOT / 'refresh.log'), rd(ROOT / 'live.log'), now)
    problems += check_disk()
    problems += check_backup(Path.home() / 'backups' / 'tradee', ROOT / 'backup.log', now)
    return problems


# --- rozhodnutí, kdy psát ------------------------------------------------------------------------------------

def decide(problems, state, now):
    """Vrátí (druh mailu nebo None, nový stav). Druh: 'problem' | 'ok'."""
    key = '\n'.join(problems)
    last_key = state.get('problems', '')
    last_mail = parse_ts(state['mailedAt']) if state.get('mailedAt') else None
    new = {'problems': key, 'checkedAt': now.isoformat(), 'mailedAt': state.get('mailedAt')}
    if problems:
        if key != last_key or not last_mail or age(last_mail, now) >= REPEAT_AFTER:
            new['mailedAt'] = now.isoformat()
            return 'problem', new
        return None, new
    if last_key:
        new['mailedAt'] = now.isoformat()
        return 'ok', new
    return None, new


def load_env(path):
    env = {}
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def send_mail(subject, text):
    env = load_env(ROOT / '.notify.env')
    key = env.get('RESEND_API_KEY')
    if not key:
        return 'chybí RESEND_API_KEY v .notify.env'
    body = json.dumps({'from': env.get('MAIL_FROM') or 'Tradee <info@dejny.eu>', 'to': [MAIL_TO], 'subject': subject, 'text': text}).encode()
    req = urllib.request.Request('https://api.resend.com/emails', data=body, method='POST',
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                                          # Cloudflare před api.resend.com blokuje výchozí User-Agent Pythonu (error 1010)
                                          'User-Agent': 'tradee-hlidac/1 (+https://tradee.eu)'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return None if r.status < 300 else f'Resend {r.status}'
    except Exception as e:  # noqa: BLE001
        return f'Resend: {e}'[:200]


def compose(kind, problems, now):
    stamp = now.astimezone().strftime('%d. %m. %Y %H:%M')
    if kind == 'ok':
        return 'Tradee: zase OK', f'Všechny kontroly hlídače prošly ({stamp}).\n'
    lines = '\n'.join(f'- {p}' for p in problems)
    return f'Tradee: {len(problems)} problém{"y" if 1 < len(problems) < 5 else "ů" if len(problems) >= 5 else ""}', \
        f'Hlídač na VPS našel {stamp}:\n\n{lines}\n\nLogy: ~/tradee/*.log, fundamentals-cron.log; služba: systemctl status tradee.\n'


def main(argv):
    now = now_utc()
    if '--test' in argv:
        err = send_mail('Tradee: zkušební mail hlídače', f'Hlídač funguje ({now.isoformat()}).\n')
        print('test mail:', err or 'odeslán na ' + MAIL_TO)
        return 1 if err else 0
    problems = run_checks(now)
    if '--dry' in argv:
        print('\n'.join(problems) if problems else 'OK – žádný problém')
        return 0
    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {}
    kind, new_state = decide(problems, state, now)
    note = ''
    if kind:
        subject, text = compose(kind, problems, now)
        err = send_mail(subject, text)
        note = f' · mail „{subject}“ ' + (f'selhal: {err}' if err else 'odeslán')
        if err:
            new_state['mailedAt'] = state.get('mailedAt')  # zkusit znovu příště
    STATE.write_text(json.dumps(new_state, ensure_ascii=False), encoding='utf-8')
    print(f'{now.strftime("%Y-%m-%dT%H:%M:%SZ")} · {len(problems)} problémů' + (': ' + ' | '.join(problems) if problems else '') + note)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
