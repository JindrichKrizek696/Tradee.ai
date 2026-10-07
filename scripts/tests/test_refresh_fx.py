import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('refresh_fx', Path(__file__).resolve().parents[1] / 'refresh_fx.py')
fx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fx)

XML = '''<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<Cube><Cube time="2026-10-06"><Cube currency="USD" rate="1.1702"/><Cube currency="CZK" rate="24.31"/></Cube>
<Cube time="2026-10-03"><Cube currency="USD" rate="1.1650"/></Cube></Cube></gesmes:Envelope>'''


class ParseTest(unittest.TestCase):
    def test_rates_and_eur(self):
        rows = fx.parse_rates(XML)
        self.assertIn(('2026-10-06', 'USD', 1.1702), rows)
        self.assertIn(('2026-10-06', 'CZK', 24.31), rows)
        self.assertIn(('2026-10-03', 'USD', 1.165), rows)
        # EUR = 1 pro každý den, aby šel přepočet z/do EUR stejnou cestou
        self.assertIn(('2026-10-06', 'EUR', 1.0), rows)
        self.assertIn(('2026-10-03', 'EUR', 1.0), rows)
        self.assertEqual(len(rows), 5)

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            fx.parse_rates('<xml>nic</xml>')


class BatchTest(unittest.TestCase):
    def test_batches_of_5000(self):
        parts = list(fx.batches(list(range(12001))))
        self.assertEqual([len(p) for p in parts], [5000, 5000, 2001])
        self.assertEqual(sum(parts, []), list(range(12001)))


if __name__ == '__main__':
    unittest.main()
