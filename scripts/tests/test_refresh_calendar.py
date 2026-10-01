import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_calendar as rc  # noqa: E402

FIX = Path(__file__).resolve().parent / 'fixtures'


def fixture(name):
    return (FIX / name).read_text(encoding='utf-8')


def ids(events):
    return [e['id'] for e in events]


class Bls(unittest.TestCase):
    def setUp(self):
        self.events = rc.parse_bls(fixture('bls.ics'))

    def test_only_tracked_releases(self):
        self.assertEqual({e['kind'] for e in self.events}, {'us-nfp', 'us-cpi', 'us-ppi', 'us-jolts', 'us-eci'})

    def test_daylight_saving(self):
        by_id = {e['id']: e for e in self.events}
        self.assertEqual(by_id['us-cpi-2026-10-14']['at'], '2026-10-14T12:30:00Z')  # EDT
        self.assertEqual(by_id['us-nfp-2026-11-06']['at'], '2026-11-06T13:30:00Z')  # EST
        self.assertEqual(by_id['us-jolts-2026-11-03']['at'], '2026-11-03T15:00:00Z')

    def test_shape(self):
        e = next(x for x in self.events if x['id'] == 'us-nfp-2026-10-02')
        self.assertEqual(e, {'id': 'us-nfp-2026-10-02', 'at': '2026-10-02T12:30:00Z', 'timeKnown': True,
                             'title': 'USA • zaměstnanost (NFP)', 'category': 'macro', 'markets': ['USD'],
                             'kind': 'us-nfp', 'source': 'https://www.bls.gov/schedule/news_release/', 'origin': 'bls'})


class Bea(unittest.TestCase):
    def test_releases(self):
        events = rc.parse_bea(fixture('bea.json'))
        by_id = {e['id']: e for e in events}
        self.assertEqual(by_id['us-gdp-2026-10-29']['at'], '2026-10-29T12:30:00Z')
        self.assertEqual(by_id['us-pce-2026-10-29']['title'], 'USA • osobní příjmy a PCE')
        self.assertEqual(by_id['us-trade-2026-10-06']['markets'], ['USD'])


if __name__ == '__main__':
    unittest.main()
