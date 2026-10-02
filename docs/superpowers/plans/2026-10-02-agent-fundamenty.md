# Agent fundamentů na VPS – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code na VPS 2× denně ověří a aktualizuje `data/fundamentals.json` podle `FUNDAMENTALS.md`; výstup projde kontrolou, nasadí se a pushne do `main`.

**Architecture:** `scripts/check_fundamentals.py` (čistá validace starý vs. nový JSON) a `scripts/fundamentals_agent.py` (zámek, git sync, `claude -p` nad pracovní kopií, kontrola, atomické nasazení, build/restart, commit + push přes deploy key, log). Oba testované unittesty; wrapper nad dočasným git repem s falešným `claude`.

**Tech Stack:** Python 3.10 (stdlib: json, fcntl, subprocess, unittest), git, Claude Code CLI 2.1.284, cron.

**Spec:** `docs/superpowers/specs/2026-10-02-agent-fundamenty-design.md`

## Global Constraints

- Python jen stdlib, musí běžet na **Python 3.10.12** (VPS).
- Agent smí měnit jen `data/fundamentals.json`; nástroje Claude: `WebSearch WebFetch Read Edit`, zakázané `Bash Write`, `--permission-mode dontAsk`, timeout 25 min.
- Nikdy `git reset --hard` – necommitnutá data cronu (`score-market.json`, `expanded-market.json`, `score-history.json`, `calendar.json`) musí přežít každý běh.
- Commit autor `tradee-bot <bot@tradee.dejny.eu>`, zpráva `Fundamenty ověřené agentem (VPS) · <UTC>`.
- Zámek `/tmp/tradee-build.lock` sdílený s `refresh-vps.sh`.
- Cron 06:30 a 18:30 UTC – zapíná se **až po ručním běhu a souhlasu uživatele**.
- Commity v repu končí `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Agent upraví soubor mimo pracovní kopii** (např. přes `../`) – `cwd` + `--add-dir` jen pracovní složka, Bash/Write zakázané; ověřit při ručním běhu (`git status` po běhu ukáže jen `data/fundamentals.json`).
2. **Výpadek sítě při pullu ≠ konflikt** – nesmí zahodit nová data (test `push selhal` cesta není pokrytá; reviewer ověří logiku `rebase-merge` detekce).
3. **Claude vrátí 0, ale JSON prázdný/nečitelný** – kontrola odmítne (`neplatný JSON`) – pokryto Task 1.
4. **Cron bez login shellu** (PATH bez `~/.local/bin`, bez nvm) – crontab volá `bash -lc`; ověřit ručním spuštěním přesného řádku z crontabu.
5. **Dva běhy najednou / s refresh-vps.sh** – zámek; pokryto Task 2 `test_lock_busy`, refresh-vps ověřit ručně.

---

### Task 1: Kontrola výstupu agenta

**Files:** Create `scripts/check_fundamentals.py`, Test `scripts/tests/test_check_fundamentals.py`

**Interfaces:** Produces `validate(old:dict, new_text:str, now:datetime) -> (bool, str)`; CLI `check_fundamentals.py OLD NEW [--now ISO]` → exit 0/1, důvod na stdout.

- [ ] **Step 1: Testy** `scripts/tests/test_check_fundamentals.py`

```python
import copy
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check_fundamentals as cf  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OLD = json.loads((ROOT / 'data' / 'fundamentals.json').read_text(encoding='utf-8'))
NOW = datetime(2026, 10, 3, 7, 0, tzinfo=timezone.utc)


def good():
    """Platná aktualizace: nový checkedAt, změněný faktor se zdrojem, přidaný záznam historie."""
    n = copy.deepcopy(OLD)
    n['checkedAt'] = '2026-10-03T06:55:00+00:00'
    f = next(iter(n['currencies']['EUR']['factors'].values()))
    f.update(value=0.5, source='https://www.ecb.europa.eu/x', reason='Ověřeno')
    n['history'] = n['history'] + [{'at': '2026-10-03T06:55:00+00:00', 'methodVersion': n['methodVersion'], 'values': {}}]
    return n


def check(n):
    return cf.validate(OLD, json.dumps(n, ensure_ascii=False), NOW)


class Validate(unittest.TestCase):
    def test_valid_update(self):
        ok, msg = check(good())
        self.assertTrue(ok, msg)
        self.assertTrue(msg.startswith('ok: 1 měn se změnou'))

    def test_invalid_json(self):
        self.assertFalse(cf.validate(OLD, '{"currencies": ', NOW)[0])

    def test_root_not_object(self):
        self.assertFalse(cf.validate(OLD, '[]', NOW)[0])

    def test_missing_key(self):
        n = good(); del n['institutions']
        ok, msg = check(n)
        self.assertFalse(ok); self.assertIn('institutions', msg)

    def test_seven_currencies(self):
        n = good(); del n['currencies']['NZD']
        self.assertFalse(check(n)[0])

    def test_currency_without_factors(self):
        n = good(); del n['currencies']['JPY']['factors']
        self.assertFalse(check(n)[0])

    def test_method_change(self):
        n = good(); n['methodVersion'] = 'jina'
        ok, msg = check(n)
        self.assertFalse(ok); self.assertIn('methodVersion', msg)

    def test_history_shortened(self):
        n = good(); n['history'] = []
        self.assertFalse(check(n)[0])

    def test_history_rewritten(self):
        n = good(); n['history'][0] = {**n['history'][0], 'at': '2020-01-01T00:00:00Z'}
        ok, msg = check(n)
        self.assertFalse(ok); self.assertIn('historie', msg)

    def test_checked_at_not_newer(self):
        n = good(); n['checkedAt'] = OLD['checkedAt']
        self.assertFalse(check(n)[0])

    def test_checked_at_future(self):
        n = good(); n['checkedAt'] = '2026-10-03T08:00:00+00:00'
        self.assertFalse(check(n)[0])

    def test_factor_without_source(self):
        n = good(); f = next(iter(n['currencies']['USD']['factors'].values())); f.update(value=1, source='')
        ok, msg = check(n)
        self.assertFalse(ok); self.assertIn('USD', msg)

    def test_event_without_at(self):
        n = good(); n['events'] = n['events'] + [{'id': 'x-2026-10-05', 'title': 'X', 'source': 'bls-cal'}]
        self.assertFalse(check(n)[0])

    def test_halved_file(self):
        n = good(); n['observations'] = {}; n['pairObservations'] = {}; n['institutions'] = []; n['changes'] = []; n['indicators'] = []
        ok, msg = check(n)
        self.assertFalse(ok); self.assertIn('polovinu', msg)

    def test_cli_exit_codes(self):
        import subprocess, tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'n.json'; p.write_text(json.dumps(good(), ensure_ascii=False), encoding='utf-8')
            script = str(Path(cf.__file__))
            r = subprocess.run([sys.executable, script, str(ROOT / 'data' / 'fundamentals.json'), str(p), '--now', NOW.isoformat()], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout)
            p.write_text('{', encoding='utf-8')
            r = subprocess.run([sys.executable, script, str(ROOT / 'data' / 'fundamentals.json'), str(p), '--now', NOW.isoformat()], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Spusť – musí selhat**

Run: `python3 -m unittest scripts.tests.test_check_fundamentals 2>&1 | tail -3`
Expected: `ModuleNotFoundError: No module named 'check_fundamentals'`

- [ ] **Step 3: `scripts/check_fundamentals.py`**

```python
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
    """Vrátí (True, shrnutí) nebo (False, důvod)."""
    try:
        new = json.loads(new_text)
    except ValueError as e:
        return False, f'neplatný JSON: {e}'
    if not isinstance(new, dict):
        return False, 'kořen není objekt'
    missing = [k for k in old if k not in new]
    if missing:
        return False, 'chybí klíče: ' + ', '.join(missing)
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
```

- [ ] **Step 4: Spusť – musí projít**

Run: `python3 -m unittest discover -s scripts/tests -p "test_check*"`
Expected: `Ran 15 tests … OK`

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/check_fundamentals.py
git add scripts/check_fundamentals.py scripts/tests/test_check_fundamentals.py
git commit -m "Agent fundamentů: kontrola výstupu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Wrapper agenta

**Files:** Create `scripts/fundamentals_agent.py`, Test `scripts/tests/test_fundamentals_agent.py`

**Interfaces:** Consumes CLI z Task 1. Produces `run(root) -> (výsledek, detail, commit)`, `main()` (zapíše řádek do `fundamentals-agent.log`, exit 0 pro `ok`/`bez změny`/`push přeskočen – chybí deploy key`).

- [ ] **Step 1: Testy** `scripts/tests/test_fundamentals_agent.py`

```python
"""Wrapper agenta fundamentů nad dočasným git repem s falešným `claude` (bez sítě, bez buildu)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOW = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec='seconds')
MANUAL = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(timespec='seconds')
REPO = HERE.parents[1]
FAKE = '''#!/usr/bin/env python3
import json, os, sys, time, subprocess
mode = os.environ['FAKE_MODE']
p = 'fundamentals.json'
d = json.load(open(p, encoding='utf-8'))
if mode == 'sleep': time.sleep(5)
if mode == 'fail': sys.exit(3)
if mode in ('valid', 'conflict'):
    d['checkedAt'] = '2099-01-01T00:00:00+00:00' if os.environ.get('FAKE_FUTURE') else os.environ['FAKE_NOW']
    f = d['currencies']['EUR']['factors']['decision']; f.update(value=0, reason='Ověřeno agentem', source='ecb-report')
if mode == 'invalid': d['methodVersion'] = 'jina'
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
if mode == 'conflict':  # mezitím někdo pushne jinou verzi fundamentů
    subprocess.run(['bash', '-c', os.environ['FAKE_CONFLICT']], check=True)
print(json.dumps({'result': 'Aktualizováno.'}))
'''


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str), capture_output=True, text=True, check=True).stdout


class Agent(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.remote = self.tmp / 'remote.git'
        run(['git', 'init', '-q', '--bare', '-b', 'main', str(self.remote)], self.tmp)
        seed = self.tmp / 'seed'
        seed.mkdir()
        for f in ('data/fundamentals.json', 'FUNDAMENTALS.md', 'lib/fundamentals.ts', 'scripts/check_fundamentals.py', 'scripts/fundamentals_agent.py'):
            (seed / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / f, seed / f)
        run('git init -q -b main && git add -A && git -c user.name=t -c user.email=t@t commit -qm init && git remote add origin ' + str(self.remote) + ' && git push -q origin main', seed)
        self.root = self.tmp / 'root'
        run(['git', 'clone', '-q', str(self.remote), str(self.root)], self.tmp)
        (self.root / 'data' / 'score-market.json').write_text('{"cron": true}')  # necommitnutá data cronu
        fake = self.tmp / 'claude'
        fake.write_text(FAKE)
        fake.chmod(0o755)
        self.env = {**os.environ, 'TRADEE_CLAUDE_CMD': str(fake), 'TRADEE_BUILD_CMD': 'true', 'TRADEE_RESTART_CMD': 'true',
                    'TRADEE_PUSH_REMOTE': str(self.remote), 'TRADEE_LOCK': str(self.tmp / 'lock'), 'TRADEE_LOCK_WAIT': '1',
                    'TRADEE_WORKDIR': str(self.tmp / 'work'), 'TRADEE_AGENT_TIMEOUT': '2', 'FAKE_NOW': NOW}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def agent(self, mode, **extra):
        r = subprocess.run([sys.executable, 'scripts/fundamentals_agent.py'], cwd=self.root, capture_output=True, text=True,
                           env={**self.env, 'FAKE_MODE': mode, **extra})
        return r.returncode, r.stdout.strip()

    def remote_checked_at(self):
        return json.loads(run(['git', 'show', 'main:data/fundamentals.json'], self.remote))['checkedAt']

    def local(self):
        return json.loads((self.root / 'data' / 'fundamentals.json').read_text(encoding='utf-8'))

    def test_valid_deploys_and_pushes(self):
        code, out = self.agent('valid')
        self.assertEqual(code, 0, out)
        self.assertIn(' · ok · ok: 1 měn se změnou', out)
        self.assertEqual(self.local()['checkedAt'], NOW)
        self.assertEqual(self.remote_checked_at(), NOW)
        self.assertIn('tradee-bot', run(['git', 'log', '-1', '--format=%an %s', 'main'], self.remote))
        self.assertEqual((self.root / 'data' / 'score-market.json').read_text(), '{"cron": true}')
        self.assertIn(out, (self.root / 'fundamentals-agent.log').read_text())

    def test_rejected_keeps_old(self):
        before = self.local()
        code, out = self.agent('invalid')
        self.assertEqual(code, 1)
        self.assertIn('odmítnuto: změna metodiky (methodVersion)', out)
        self.assertEqual(self.local(), before)

    def test_future_checked_at_rejected(self):
        code, out = self.agent('valid', FAKE_FUTURE='1')
        self.assertIn('odmítnuto: checkedAt je v budoucnosti', out)

    def test_unchanged(self):
        code, out = self.agent('same')
        self.assertEqual(code, 0)
        self.assertIn(' · bez změny · Aktualizováno.', out)

    def test_claude_fails(self):
        self.assertIn('claude selhal', self.agent('fail')[1])

    def test_timeout(self):
        self.assertIn(' · timeout · ', self.agent('sleep')[1])

    def test_lock_busy(self):
        import fcntl
        with open(self.tmp / 'lock', 'w') as fd:
            fcntl.flock(fd, fcntl.LOCK_EX)
            self.assertIn('zámek obsazen', self.agent('valid')[1])

    def test_build_failure_restores(self):
        before = self.local()
        code, out = self.agent('valid', TRADEE_BUILD_CMD='false')
        self.assertIn('build selhal', out)
        self.assertEqual(self.local(), before)

    def test_missing_deploy_key_skips_push(self):
        code, out = self.agent('valid', TRADEE_PUSH_REMOTE='git@github.com:x/y.git', TRADEE_DEPLOY_KEY=str(self.tmp / 'nokey'))
        self.assertEqual(code, 0, out)
        self.assertIn('push přeskočen – chybí deploy key', out)
        self.assertEqual(self.local()['checkedAt'], NOW)

    def test_conflict_keeps_manual_version(self):
        other = self.tmp / 'other'
        run(['git', 'clone', '-q', str(self.remote), str(other)], self.tmp)
        script = (f"cd {other} && python3 -c \"import json;p='data/fundamentals.json';d=json.load(open(p));d['checkedAt']='{MANUAL}';"
                  f"json.dump(d,open(p,'w'),ensure_ascii=False)\" && git -c user.name=J -c user.email=j@j commit -qam rucni && git push -q origin main")
        code, out = self.agent('conflict', FAKE_CONFLICT=script)
        self.assertIn('konflikt – ponechána ruční verze', out)
        self.assertEqual(self.local()['checkedAt'], MANUAL)
        self.assertEqual(self.remote_checked_at(), MANUAL)
        self.assertEqual((self.root / 'data' / 'score-market.json').read_text(), '{"cron": true}')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Spusť – musí selhat**

Run: `python3 -m unittest scripts.tests.test_fundamentals_agent 2>&1 | tail -3`
Expected: FAIL/ERROR (soubor `scripts/fundamentals_agent.py` neexistuje → `FileNotFoundError` při kopírování do seed repa)

- [ ] **Step 3: `scripts/fundamentals_agent.py`**

```python
#!/usr/bin/env python3
"""Agent fundamentů na VPS (cron 06:30 a 18:30 UTC).

Claude Code (`claude -p`) podle FUNDAMENTALS.md aktualizuje kopii data/fundamentals.json,
scripts/check_fundamentals.py ji ověří, pak se nasadí (build + restart) a pushne do main
přes deploy key. Odmítnutý nebo spadlý běh nechá stará data. Log: fundamentals-agent.log.
Proměnné (hlavně pro testy): TRADEE_CLAUDE_CMD, TRADEE_BUILD_CMD, TRADEE_RESTART_CMD,
TRADEE_PUSH_REMOTE, TRADEE_DEPLOY_KEY, TRADEE_LOCK, TRADEE_WORKDIR, TRADEE_AGENT_TIMEOUT.
"""
import fcntl
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path('data/fundamentals.json')
PROMPT = ('Jsi ověřovatel fundamentů Tradee.ai. Přečti FUNDAMENTALS.md a lib/fundamentals.ts a aktualizuj '
          'fundamentals.json v tomto adresáři přesně podle FUNDAMENTALS.md. Používej jen veřejné primární zdroje. '
          'Měň jen soubor fundamentals.json. Na konci napiš jednu větu shrnutí česky.')
ALLOWED = 'WebSearch WebFetch Read Edit'
KEEP_LOGS = 30


def env(name, default):
    return os.environ.get(name, default)


def sh(cmd, cwd, timeout=None, extra_env=None):
    return subprocess.run(cmd if isinstance(cmd, list) else shlex.split(cmd), cwd=cwd, capture_output=True, text=True,
                          timeout=timeout, env={**os.environ, **(extra_env or {})})


def git(root, *args, extra_env=None):
    return sh(['git', '-c', 'user.name=tradee-bot', '-c', 'user.email=bot@tradee.dejny.eu', *args], root, extra_env=extra_env)


class Lock:
    """Zámek sdílený s refresh-vps.sh (flock na stejném souboru); čeká max. `wait` sekund."""
    def __init__(self, path, wait):
        self.path, self.wait, self.fd = path, wait, None

    def __enter__(self):
        self.fd = open(self.path, 'w')
        end = time.monotonic() + self.wait
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if time.monotonic() >= end:
                    self.fd.close()
                    raise TimeoutError
                time.sleep(min(5, self.wait))

    def __exit__(self, *exc):
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        self.fd.close()


def deploy(root):
    """Build + restart; vrací chybu nebo None."""
    for cmd in (env('TRADEE_BUILD_CMD', 'bash -lc "source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build"'),
                env('TRADEE_RESTART_CMD', 'sudo systemctl restart tradee')):
        r = sh(cmd, root, timeout=900)
        if r.returncode:
            return (r.stdout + r.stderr).strip()[-300:] or f'{cmd} → exit {r.returncode}'
    return None


def push(root, stamp):
    """Commit + push jen data/fundamentals.json. Vrací (výsledek, commit)."""
    key = Path(env('TRADEE_DEPLOY_KEY', str(Path.home() / '.ssh' / 'tradee_deploy')))
    remote = env('TRADEE_PUSH_REMOTE', 'git@github.com:JindrichKrizek696/Tradee.ai.git')
    ssh_env = {'GIT_SSH_COMMAND': f'ssh -i {key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'}
    git(root, 'add', str(DATA))
    if git(root, 'commit', '-m', f'Fundamenty ověřené agentem (VPS) · {stamp}', '--', str(DATA)).returncode:
        return 'commit selhal', '-'
    commit = git(root, 'rev-parse', '--short', 'HEAD').stdout.strip()
    if remote.startswith('git@') and not key.exists():
        return 'push přeskočen – chybí deploy key', commit
    pulled = git(root, 'pull', '--rebase', '--autostash', remote, 'main', extra_env=ssh_env)
    if pulled.returncode:
        if not any((root / '.git' / d).exists() for d in ('rebase-merge', 'rebase-apply')):
            return 'push selhal: ' + (pulled.stderr.strip().splitlines() or ['pull'])[-1][:200], commit
        # Konflikt: někdo (Jindřich) mezitím pushnul jiné fundamenty → přednost má ruční verze. Nikdy reset --hard.
        git(root, 'rebase', '--abort')
        git(root, 'reset', '--soft', 'HEAD~1')
        git(root, 'restore', '--staged', '--worktree', str(DATA))
        git(root, 'pull', '--rebase', '--autostash', remote, 'main', extra_env=ssh_env)
        err = deploy(root)
        return ('konflikt – ponechána ruční verze' + (f'; build selhal: {err}' if err else '')), '-'
    r = git(root, 'push', remote, 'HEAD:main', extra_env=ssh_env)
    if r.returncode:
        return 'push selhal: ' + (r.stderr.strip().splitlines() or ['?'])[-1][:200], commit
    return 'ok', commit


def run(root):
    """Jeden běh agenta. Vrací (výsledek, detail, commit)."""
    work = Path(env('TRADEE_WORKDIR', '/tmp/tradee-agent'))
    try:
        with Lock(env('TRADEE_LOCK', '/tmp/tradee-build.lock'), int(env('TRADEE_LOCK_WAIT', '1800'))):
            if git(root, 'pull', '--rebase', '--autostash').returncode:
                return 'git pull selhal', '-', '-'
            shutil.rmtree(work, ignore_errors=True)
            work.mkdir(parents=True)
            for f in ('data/fundamentals.json', 'FUNDAMENTALS.md', 'lib/fundamentals.ts'):
                shutil.copy(root / f, work / Path(f).name)
            cmd = [env('TRADEE_CLAUDE_CMD', 'claude'), '-p', PROMPT, '--allowedTools', ALLOWED,
                   '--disallowedTools', 'Bash Write', '--permission-mode', 'dontAsk', '--add-dir', str(work),
                   '--output-format', 'json']
            try:
                r = sh(cmd, work, timeout=int(env('TRADEE_AGENT_TIMEOUT', '1500')))
            except subprocess.TimeoutExpired:
                return 'timeout', '-', '-'
            save_output(root, r.stdout or r.stderr)
            if r.returncode:
                return 'claude selhal', (r.stderr or r.stdout).strip()[-200:], '-'
            new, old = work / 'fundamentals.json', root / DATA
            if same_json(new, old):
                return 'bez změny', summary(r.stdout), '-'
            c = sh([sys.executable, str(root / 'scripts' / 'check_fundamentals.py'), str(old), str(new)], root)
            if c.returncode:
                return 'odmítnuto: ' + c.stdout.strip(), '-', '-'
            backup = old.read_bytes()
            tmp = old.with_suffix('.json.tmp')
            shutil.copy(new, tmp)
            os.replace(tmp, old)
            err = deploy(root)
            if err:
                old.write_bytes(backup)
                deploy(root)
                return 'build selhal', err, '-'
            res, commit = push(root, datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'))
            return res, c.stdout.strip(), commit
    except TimeoutError:
        return 'zámek obsazen', '-', '-'


def same_json(a, b):
    try:
        return json.loads(a.read_text(encoding='utf-8')) == json.loads(b.read_text(encoding='utf-8'))
    except ValueError:
        return False


def summary(out):
    try:
        return (json.loads(out).get('result') or '').strip().replace('\n', ' ')[:200] or '-'
    except ValueError:
        return '-'


def save_output(root, text):
    d = root / 'logs'
    d.mkdir(exist_ok=True)
    (d / f"agent-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}.json").write_text(text or '', encoding='utf-8')
    for old in sorted(d.glob('agent-*.json'))[:-KEEP_LOGS]:
        old.unlink()


def main():
    start = time.monotonic()
    started = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    res, detail, commit = run(ROOT)
    line = f'{started} · {round(time.monotonic() - start)} s · {res} · {detail} · {commit}'
    with open(ROOT / 'fundamentals-agent.log', 'a', encoding='utf-8') as f:
        f.write(line + '\n')
    print(line)
    return 0 if res in ('ok', 'bez změny', 'push přeskočen – chybí deploy key') else 1


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: Spusť – musí projít**

Run: `python3 -m unittest discover -s scripts/tests`
Expected: `Ran 40 tests … OK` (15 kalendář + 15 kontrola + 10 wrapper)

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/fundamentals_agent.py
git add scripts/fundamentals_agent.py scripts/tests/test_fundamentals_agent.py
git commit -m "Agent fundamentů: wrapper (zámek, claude -p, kontrola, nasazení, push)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Zámek v refresh-vps.sh, ignorované logy, dokumentace

**Files:** Modify `scripts/refresh-vps.sh`, `.gitignore`, `README.md`, `FUNDAMENTALS.md`

- [ ] **Step 1: Zámek** – v `scripts/refresh-vps.sh` hned za řádek `source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null` vlož:

```bash
# Sdílený zámek s agentem fundamentů (scripts/fundamentals_agent.py) – build a restart nesmí běžet dvakrát.
exec 9>/tmp/tradee-build.lock
flock -w 1800 9 || { echo "!! $(date -Is) zámek obsazen, refresh přeskočen"; exit 1; }
```

- [ ] **Step 2: `.gitignore`** – přidej řádek `logs/`.

- [ ] **Step 3: `README.md`** – do „Hlavní soubory“ přidej:

```markdown
- `scripts/fundamentals_agent.py` — agent fundamentů na VPS (cron 06:30/18:30 UTC): `claude -p` podle FUNDAMENTALS.md, kontrola `scripts/check_fundamentals.py`, nasazení a push přes deploy key; log `fundamentals-agent.log`.
```

- [ ] **Step 4: `FUNDAMENTALS.md`** – na konec přidej:

```markdown
## Automatický běh na VPS

Tento postup 2× denně (06:30 a 18:30 UTC) provádí Claude Code na VPS (`scripts/fundamentals_agent.py`) nad kopií `data/fundamentals.json`. Výstup ověřuje `scripts/check_fundamentals.py` – neměň `schemaVersion`, `methodVersion`, `staleAfterHours`, `reviewCadenceHours`, nemaž ani nepřepisuj starší záznamy `history`, `checkedAt` nastav na skutečný čas kontroly. Ruční aktualizace dál fungují: před prací si stáhni `main`; když VPS narazí na tvou novější verzi, ponechá ji.
```

- [ ] **Step 5: Ověření a commit**

Run: `bash -n scripts/refresh-vps.sh && echo syntax-ok && python3 -m unittest discover -s scripts/tests 2>&1 | tail -1`
Expected: `syntax-ok`, `OK`

```bash
git add scripts/refresh-vps.sh .gitignore README.md FUNDAMENTALS.md
git commit -m "Agent fundamentů: sdílený zámek v refresh-vps.sh, dokumentace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Nasazení, první ruční běh, cron (každý krok se souhlasem uživatele)

- [ ] **Step 1: Merge a pull na VPS** (uživatel spustí nebo schválí)

```bash
git checkout main && git merge --ff-only feature/agent-fundamenty && git push origin main
ssh ubuntu@130.61.122.142 'cd ~/tradee && git pull --ff-only && python3 -m unittest discover -s scripts/tests 2>&1 | tail -1'
```
Expected: `OK` i na VPS (Python 3.10).

- [ ] **Step 2: První ostrý běh ručně**

```bash
ssh ubuntu@130.61.122.142 'cd ~/tradee && bash -lc "python3 scripts/fundamentals_agent.py"; tail -1 fundamentals-agent.log; git status -s; git log --oneline -2'
```
Expected: řádek logu s `ok` nebo `push přeskočen – chybí deploy key` (dokud Jindřich nepřidá klíč); `git status` ukazuje jen datové soubory cronu; FX skóre na webu znovu čísla. Ukázat uživateli diff `checkedAt` a změněné měny.

- [ ] **Step 3: Cron** (až po souhlasu) – přidat do crontabu `ubuntu`:

```
30 6,18 * * * cd /home/ubuntu/tradee && bash -lc "python3 scripts/fundamentals_agent.py" >> /home/ubuntu/tradee/fundamentals-agent.cron.log 2>&1
```
Expected: `crontab -l | grep fundamentals_agent` vypíše řádek.
