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
if os.environ.get('FAKE_ARGV'): json.dump(sys.argv[1:], open(os.environ['FAKE_ARGV'], 'w'))
if mode == 'error': print(json.dumps({'is_error': True, 'result': 'Usage limit reached'})); sys.exit(0)
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
        (seed / 'data' / 'score-market.json').write_text('{"seed": true}')  # sledovaný datový soubor cronu
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

    def test_rejected_deploy_key_skips_push(self):
        key = self.tmp / 'key'
        key.write_text('k')
        fake_ssh = self.tmp / 'bin' / 'ssh'
        fake_ssh.parent.mkdir()
        fake_ssh.write_text('#!/bin/sh\necho "git@github.com: Permission denied (publickey)." >&2\nexit 255\n')
        fake_ssh.chmod(0o755)
        code, out = self.agent('valid', TRADEE_PUSH_REMOTE='git@github.com:x/y.git', TRADEE_DEPLOY_KEY=str(key),
                               PATH=f"{fake_ssh.parent}:{os.environ['PATH']}")
        self.assertEqual(code, 0, out)
        self.assertIn('push přeskočen – deploy key není přidaný v repu', out)
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


    def test_upstream_cron_data_no_conflict(self):
        """Jindřich pushne i datový soubor cronu – VPS verze zůstane a nevzniknou konfliktní značky."""
        other = self.tmp / 'other2'
        run(['git', 'clone', '-q', str(self.remote), str(other)], self.tmp)
        (other / 'data' / 'score-market.json').write_text('{"upstream": true}')
        run('git add -A && git -c user.name=J -c user.email=j@j commit -qm data && git push -q origin main', other)
        (self.root / 'data' / 'score-market.json').write_text('{"cron": "vps"}')
        code, out = self.agent('valid')
        self.assertEqual(code, 0, out)
        self.assertEqual((self.root / 'data' / 'score-market.json').read_text(), '{"cron": "vps"}')
        self.assertEqual(self.local()['checkedAt'], NOW)
        self.assertEqual(run(['git', 'stash', 'list'], self.root), '')

    def test_claude_tools_scoped_to_workdir(self):
        argv_file = self.tmp / 'argv.json'
        self.agent('same', FAKE_ARGV=str(argv_file))
        argv = json.loads(argv_file.read_text())
        allowed = argv[argv.index('--allowedTools') + 1:argv.index('--disallowedTools')]
        denied = argv[argv.index('--disallowedTools') + 1:argv.index('--permission-mode')]
        work = str(self.tmp / 'work')
        self.assertIn(f'Read(/{work}/**)', allowed)
        self.assertIn(f'Edit(/{work}/fundamentals.json)', allowed)
        self.assertNotIn('Read', allowed)
        self.assertNotIn('Edit', allowed)
        for rule in ('Bash', 'Write', 'Read(~/**)', 'Edit(~/**)', 'Read(//home/**)', 'Edit(//home/**)'):
            self.assertIn(rule, denied)

    def test_claude_is_error_is_failure(self):
        code, out = self.agent('error')
        self.assertEqual(code, 1)
        self.assertIn('claude selhal · Usage limit reached', out)

    def test_claude_missing_logged(self):
        code, out = self.agent('valid', TRADEE_CLAUDE_CMD=str(self.tmp / 'neni'))
        self.assertEqual(code, 1)
        self.assertIn('claude selhal', out)
        self.assertIn(out, (self.root / 'fundamentals-agent.log').read_text())
        self.assertEqual(run(['git', 'status', '--porcelain', '--', 'data/fundamentals.json'], self.root), '')

    def test_build_timeout_restores(self):
        before = self.local()
        code, out = self.agent('valid', TRADEE_BUILD_CMD='sleep 5', TRADEE_DEPLOY_TIMEOUT='1')
        self.assertIn('build selhal', out)
        self.assertEqual(self.local(), before)
        self.assertEqual(run(['git', 'status', '--porcelain', '--', 'data/fundamentals.json'], self.root), '')

    def test_other_dirty_file_reported(self):
        (self.root / 'FUNDAMENTALS.md').write_text('rozepsáno')
        code, out = self.agent('valid')
        self.assertIn('git pull selhal · fail: necommitnuté změny: FUNDAMENTALS.md', out)

    def test_unpushed_commit_then_manual_upstream(self):
        nokey = {'TRADEE_PUSH_REMOTE': 'git@github.com:x/y.git', 'TRADEE_DEPLOY_KEY': str(self.tmp / 'nokey')}
        self.assertIn('push přeskočen', self.agent('valid', **nokey)[1])
        other = self.tmp / 'other3'
        run(['git', 'clone', '-q', str(self.remote), str(other)], self.tmp)
        script = (f"python3 -c \"import json;p='data/fundamentals.json';d=json.load(open(p));d['checkedAt']='{MANUAL}';"
                  f"json.dump(d,open(p,'w'),ensure_ascii=False)\" && git -c user.name=J -c user.email=j@j commit -qam rucni && git push -q origin main")
        run(script, other)
        code, out = self.agent('valid', **nokey)
        self.assertEqual(code, 0, out)
        self.assertIn('push přeskočen', out)
        self.assertIn('rucni', run(['git', 'log', '--format=%s', '-3'], self.root))
        self.assertEqual(run(['git', 'rev-list', '--count', 'origin/main..HEAD'], self.root).strip(), '1')

    def test_unpushed_commit_then_upstream_other_file(self):
        # Někdo pushne změnu jiného souboru (kód, FUNDAMENTALS.md), zatímco commit agenta čeká na push → běh nesmí spadnout.
        nokey = {'TRADEE_PUSH_REMOTE': 'git@github.com:x/y.git', 'TRADEE_DEPLOY_KEY': str(self.tmp / 'nokey')}
        self.assertIn('push přeskočen', self.agent('valid', **nokey)[1])
        other = self.tmp / 'other4'
        run(['git', 'clone', '-q', str(self.remote), str(other)], self.tmp)
        run("echo 'nové pravidlo' >> FUNDAMENTALS.md && git -c user.name=J -c user.email=j@j commit -qam pravidla && git push -q origin main", other)
        code, out = self.agent('valid', **nokey)
        self.assertEqual(code, 0, out)
        self.assertNotIn('git pull selhal', out)
        self.assertIn('nové pravidlo', (self.root / 'FUNDAMENTALS.md').read_text(encoding='utf-8'))
        self.assertEqual(run(['git', 'status', '--porcelain', '--', 'FUNDAMENTALS.md'], self.root), '')
        self.assertEqual(run(['git', 'rev-list', '--count', 'origin/main..HEAD'], self.root).strip(), '1')

if __name__ == '__main__':
    unittest.main()
