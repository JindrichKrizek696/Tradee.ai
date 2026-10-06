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
          'Nejdřív obnov checkedAt zdrojů rozhodnutí bank od nejstaršího (oficiální RSS jako záloha, viz FUNDAMENTALS.md), až potom nová data. '
          'Měň jen soubor fundamentals.json. Na konci napiš jednu větu shrnutí česky.')
# Read/Edit jen v pracovní složce ('//' = absolutní cesta); domov, /home, /etc a /root výslovně zakázané.
# Bez těchto omezení by podvržená webová stránka mohla agenta přimět přečíst deploy key nebo upravit ~/.bashrc
# (ověřeno na VPS 5. 10. 2026: holé 'Read' klíč přečetlo, omezená pravidla ho zamítla).
DENIED = ['Bash', 'Write', 'NotebookEdit', 'Read(~/**)', 'Edit(~/**)', 'Read(//home/**)', 'Edit(//home/**)', 'Read(//etc/**)', 'Read(//root/**)']


def allowed_tools(work):
    return ['WebSearch', 'WebFetch', f'Read(/{work}/**)', f'Edit(/{work}/fundamentals.json)']
KEEP_LOGS = 30
# Datové soubory, které na VPS přepisuje refresh-vps.sh; VPS verze má přednost před verzí z GitHubu.
CRON_DATA = ['data/score-market.json', 'data/expanded-market.json', 'data/score-history.json', 'data/calendar.json']


def env(name, default):
    return os.environ.get(name, default)


def sh(cmd, cwd, timeout=None, extra_env=None):
    return subprocess.run(cmd if isinstance(cmd, list) else shlex.split(cmd), cwd=cwd, capture_output=True, text=True,
                          timeout=timeout, env={**os.environ, **(extra_env or {})})


def git(root, *args, extra_env=None):
    return sh(['git', '-c', 'user.name=tradee-bot', '-c', 'user.email=bot@tradee.eu', *args], root, extra_env=extra_env)


def sync(root, *args, extra_env=None):
    """git pull --rebase tak, aby necommitnutá data cronu zůstala ve VPS verzi (bez konfliktních značek).
    Vrací 'ok', 'conflict' (rebase přerušen, nic nezměněno) nebo 'fail: <důvod>'."""
    changed = [line[3:] for line in git(root, 'status', '--porcelain', '--untracked-files=no').stdout.splitlines()]
    other = [f for f in changed if f not in CRON_DATA]
    if other:
        return 'fail: necommitnuté změny: ' + ', '.join(other)
    dirty = [f for f in CRON_DATA if f in changed]
    if dirty and git(root, 'stash', 'push', '-q', '-m', 'tradee-cron-data', '--', *dirty).returncode:
        return 'fail: stash dat cronu'
    pulled = git(root, 'pull', '--rebase', *args, extra_env=extra_env)
    status = 'ok'
    if pulled.returncode:
        if any((root / '.git' / d).exists() for d in ('rebase-merge', 'rebase-apply')):
            git(root, 'rebase', '--abort')
            status = 'conflict'
        else:
            status = 'fail: ' + (pulled.stderr.strip().splitlines() or ['pull'])[-1][:200]
    if dirty:
        git(root, 'checkout', 'stash@{0}', '--', *dirty)
        git(root, 'reset', '-q', '--', *dirty)
        git(root, 'stash', 'drop', '-q')
    return status


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


def drop_local_commits(root, ref):
    """Zahodí nepushnuté commity agenta nad `ref` (smí měnit jen fundamentals.json). Vrací True, když je strom čistý."""
    if not git(root, 'rev-list', f'{ref}..HEAD').stdout.strip():
        return True
    files = set(git(root, 'diff', '--name-only', ref, 'HEAD').stdout.split())
    if files - {str(DATA)}:
        return False
    git(root, 'reset', '-q', '--soft', ref)
    git(root, 'restore', '--staged', '--worktree', str(DATA))
    return True


def deploy(root):
    """Build + restart; vrací chybu nebo None."""
    for cmd in (env('TRADEE_BUILD_CMD', 'bash -lc "source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build"'),
                env('TRADEE_RESTART_CMD', 'sudo systemctl restart tradee')):
        try:
            r = sh(cmd, root, timeout=int(env('TRADEE_DEPLOY_TIMEOUT', '900')))
        except subprocess.TimeoutExpired:
            return f'{cmd} → timeout'
        except OSError as e:
            return f'{cmd} → {e}' 
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
        git(root, 'restore', '--staged', '--worktree', str(DATA))
        deploy(root)
        return 'commit selhal', '-'
    commit = git(root, 'rev-parse', '--short', 'HEAD').stdout.strip()
    if remote.startswith('git@') and not key.exists():
        return 'push přeskočen – chybí deploy key', commit
    # Klíč na VPS je, ale v repu ještě není přidaný (GitHub ho odmítne) → stejné jako chybějící klíč, ne chyba.
    probe = git(root, 'ls-remote', remote, 'main', extra_env=ssh_env)
    if probe.returncode and 'Permission denied' in probe.stderr:
        return 'push přeskočen – deploy key není přidaný v repu', commit
    status = sync(root, remote, 'main', extra_env=ssh_env)
    if status.startswith('fail'):
        return 'push selhal: ' + status[6:], commit
    if status == 'conflict':
        # Někdo (Jindřich) mezitím pushnul jiné fundamenty → přednost má ruční verze. Nikdy reset --hard;
        # zahodí se všechny nepushnuté commity agenta (FETCH_HEAD = právě stažený main).
        if not drop_local_commits(root, 'FETCH_HEAD'):
            return 'konflikt – lokální commity mění i jiné soubory, nutný ruční zásah', commit
        again = sync(root, remote, 'main', extra_env=ssh_env)
        if again != 'ok':
            return f'konflikt – převzetí ruční verze selhalo: {again}', '-'
        err = deploy(root)
        return ('konflikt – ponechána ruční verze' + (f'; build selhal: {err}' if err else '')), '-'
    r = git(root, 'push', remote, 'HEAD:main', extra_env=ssh_env)
    if r.returncode:
        return 'push selhal: ' + (r.stderr.strip().splitlines() or ['?'])[-1][:200], commit
    return 'ok', commit


def run(root):
    """Jeden běh agenta. Vrací (výsledek, detail, commit). Nikdy nespadne bez výsledku a nenechá rozpracovaná data."""
    work = Path(env('TRADEE_WORKDIR', '/tmp/tradee-agent'))
    try:
        with Lock(env('TRADEE_LOCK', '/tmp/tradee-build.lock'), int(env('TRADEE_LOCK_WAIT', '1800'))):
            return attempt(root, work)
    except TimeoutError:
        return 'zámek obsazen', '-', '-'
    except Exception as e:  # noqa: BLE001 – každý běh musí skončit řádkem v logu
        return 'chyba', f'{type(e).__name__}: {e}'[:200], '-'


def attempt(root, work):
    # Nepushnuté commity agenta z minula (chyběl klíč, push selhal) by blokovaly pull, když se změní upstream.
    git(root, 'fetch', '-q', 'origin')
    if not drop_local_commits(root, 'origin/main'):
        return 'git pull selhal', 'lokální commity mění i jiné soubory než fundamentals.json', '-'
    pulled = sync(root)
    if pulled != 'ok':
        return 'git pull selhal', pulled, '-'
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    for f in ('data/fundamentals.json', 'FUNDAMENTALS.md', 'lib/fundamentals.ts'):
        shutil.copy(root / f, work / Path(f).name)
    cmd = [env('TRADEE_CLAUDE_CMD', 'claude'), '-p', PROMPT, '--allowedTools', *allowed_tools(work),
           '--disallowedTools', *DENIED, '--permission-mode', 'dontAsk', '--add-dir', str(work), '--output-format', 'json']
    try:
        r = sh(cmd, work, timeout=int(env('TRADEE_AGENT_TIMEOUT', '1500')))
    except subprocess.TimeoutExpired:
        return 'timeout', '-', '-'
    except OSError as e:
        return 'claude selhal', str(e)[:200], '-'
    save_output(root, r.stdout or r.stderr)
    if r.returncode:
        return 'claude selhal', (r.stderr or r.stdout).strip()[-200:], '-'
    if claude_error(r.stdout):
        return 'claude selhal', summary(r.stdout), '-'
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
    try:
        err = deploy(root)
        if err:
            old.write_bytes(backup)
            deploy(root)
            return 'build selhal', err, '-'
        res, commit = push(root, datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'))
        return res, c.stdout.strip(), commit
    except Exception:
        # Necommitnutá nová data by blokovala každý další pull – vrátit a nasadit původní.
        if git(root, 'status', '--porcelain', '--', str(DATA)).stdout.strip():
            old.write_bytes(backup)
            deploy(root)
        raise


def claude_error(out):
    try:
        return bool(json.loads(out).get('is_error'))
    except Exception:  # noqa: BLE001
        return False


def same_json(a, b):
    try:
        return json.loads(a.read_text(encoding='utf-8')) == json.loads(b.read_text(encoding='utf-8'))
    except ValueError:
        return False


def summary(out):
    try:
        return (json.loads(out).get('result') or '').strip().replace('\n', ' ')[:200] or '-'
    except Exception:  # noqa: BLE001
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
    return 0 if res in ('ok', 'bez změny') or res.startswith('push přeskočen') else 1


if __name__ == '__main__':
    sys.exit(main())
