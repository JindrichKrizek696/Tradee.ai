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


class Fed(unittest.TestCase):
    def test_meetings(self):
        events = rc.parse_fed(fixture('fed.html'))
        self.assertEqual(len(events), 16)  # 8 schůzí 2026 + 8 schůzí 2027
        by_id = {e['id']: e for e in events}
        self.assertIn('fomc-2026-10-28', by_id)
        self.assertEqual(by_id['fomc-2026-12-09']['title'], 'FOMC • rozhodnutí o sazbách + projekce')
        self.assertEqual(by_id['fomc-2026-10-28']['title'], 'FOMC • rozhodnutí o sazbách')
        self.assertFalse(by_id['fomc-2026-10-28']['timeKnown'])
        self.assertIn('fomc-2027-03-17', by_id)


class Ecb(unittest.TestCase):
    def test_only_policy_days_with_press_conference(self):
        events = rc.parse_ecb(fixture('ecb.html'))
        self.assertEqual(ids(events)[:3], ['ecb-rates-2026-10-29', 'ecb-rates-2026-12-17', 'ecb-rates-2027-02-04'])
        self.assertNotIn('ecb-rates-2026-10-28', ids(events))  # den 1 bez tiskovky
        self.assertNotIn('ecb-rates-2026-11-25', ids(events))  # non-monetary
        self.assertEqual(events[0]['markets'], ['EUR'])


class Nyse(unittest.TestCase):
    def test_holidays(self):
        events = rc.parse_nyse(fixture('nyse.html'))
        by_id = {e['id']: e for e in events}
        self.assertEqual(len(events), 29)
        self.assertIn('nyse-holiday-2026-11-26', by_id)
        self.assertEqual(by_id['nyse-holiday-2026-12-25']['title'], 'USA • burza zavřená (Christmas Day)')
        self.assertNotIn('nyse-holiday-2028-01-01', by_id)  # „—*“ = bez svátku
        self.assertEqual(by_id['nyse-holiday-2026-11-26']['category'], 'exchange')


class Computed(unittest.TestCase):
    def test_third_friday(self):
        self.assertEqual(rc.third_friday(2026, 10), date(2026, 10, 16))
        self.assertEqual(rc.third_friday(2026, 11), date(2026, 11, 20))

    def test_weekly_and_holiday_shift(self):
        events = rc.computed(date(2026, 10, 2), {date(2026, 11, 26)})
        got = set(ids(events))
        self.assertIn('eia-oil-2026-10-07', got)
        self.assertIn('eia-gas-2026-10-08', got)
        self.assertIn('rig-count-2026-10-09', got)
        self.assertIn('opex-2026-10-16', got)
        self.assertIn('eia-gas-2026-11-27', got)       # Díkůvzdání 26. 11. → plyn o den později
        self.assertNotIn('eia-gas-2026-11-26', got)
        self.assertIn('eia-oil-2026-11-25', got)       # ropa ve středu před svátkem beze změny
        oil = next(e for e in events if e['id'] == 'eia-oil-2026-10-07')
        self.assertEqual(oil['at'], '2026-10-07T14:30:00Z')

NOW = datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc)
FILES = {rc.BLS_URL: 'bls.ics', rc.BEA_URL: 'bea.json', rc.FED_URL: 'fed.html', rc.ECB_URL: 'ecb.html', rc.NYSE_URL: 'nyse.html'}


def fake_fetch(broken=()):
    def fetch(url):
        if url in broken:
            raise OSError('HTTP Error 403: Forbidden')
        return fixture(FILES[url])
    return fetch


class Build(unittest.TestCase):
    def test_window_sorted_unique(self):
        out = rc.build({}, fake_fetch(), NOW)
        at = [e['at'] for e in out['events']]
        self.assertEqual(at, sorted(at))
        self.assertEqual(len(ids(out['events'])), len(set(ids(out['events']))))
        self.assertGreaterEqual(at[0], '2026-09-25T08:00:00Z')
        self.assertLessEqual(at[-1], '2026-12-01T08:00:00Z')
        self.assertEqual(out['generatedAt'], '2026-10-02T08:00:00Z')
        self.assertTrue(all(s['ok'] for s in out['sources'].values()))
        self.assertIn('fomc-2026-10-28', ids(out['events']))

    def test_failed_source_keeps_previous_events(self):
        first = rc.build({}, fake_fetch(), NOW)
        second = rc.build(first, fake_fetch(broken={rc.BLS_URL}), NOW)
        self.assertFalse(second['sources']['bls']['ok'])
        self.assertIn('403', second['sources']['bls']['error'])
        self.assertEqual(second['sources']['bls']['lastSuccess'], '2026-10-02T08:00:00Z')
        self.assertIn('us-cpi-2026-10-14', ids(second['events']))
        self.assertTrue(second['sources']['fed']['ok'])

    def test_failed_source_without_history(self):
        out = rc.build({}, fake_fetch(broken={rc.BLS_URL}), NOW)
        self.assertIsNone(out['sources']['bls']['lastSuccess'])
        self.assertNotIn('us-cpi-2026-10-14', ids(out['events']))
        self.assertIn('us-gdp-2026-10-29', ids(out['events']))

    def test_empty_source_is_failure(self):
        out = rc.build({}, lambda url: '' if url == rc.ECB_URL else fixture(FILES[url]), NOW)
        self.assertFalse(out['sources']['ecb']['ok'])

if __name__ == '__main__':
    unittest.main()
