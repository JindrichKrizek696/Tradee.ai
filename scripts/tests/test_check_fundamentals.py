import copy
import json
import sys
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check_fundamentals as cf  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OLD = json.loads((ROOT / 'data' / 'fundamentals.json').read_text(encoding='utf-8'))
# Časy odvozené od fixtury (aktuální data/fundamentals.json), aby test nezastaral s daty.
OLD_AT = cf.parse_time(OLD['checkedAt'])
NEW_AT = (OLD_AT + timedelta(minutes=1)).isoformat()
NOW = OLD_AT + timedelta(minutes=5)


def good():
    """Platná aktualizace: nový checkedAt, změněný faktor se zdrojem, přidaný záznam historie."""
    n = copy.deepcopy(OLD)
    n['checkedAt'] = NEW_AT
    f = next(iter(n['currencies']['EUR']['factors'].values()))
    f.update(value=0.5, source='https://www.ecb.europa.eu/x', reason='Ověřeno')
    n['history'] = n['history'] + [{'at': NEW_AT, 'methodVersion': n['methodVersion'], 'values': {}}]
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
        n = good(); n['checkedAt'] = (NOW + timedelta(hours=1)).isoformat()
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


    def test_wrong_type_of_key(self):
        n = good(); n['sources'] = None
        ok, msg = check(n)
        self.assertFalse(ok); self.assertIn('sources', msg)

    def test_observations_list(self):
        n = good(); n['observations'] = []
        self.assertFalse(check(n)[0])

    def test_event_not_object_has_reason(self):
        n = good(); n['events'] = n['events'] + ['x']
        ok, msg = check(n)
        self.assertFalse(ok); self.assertTrue(msg)

if __name__ == '__main__':
    unittest.main()
