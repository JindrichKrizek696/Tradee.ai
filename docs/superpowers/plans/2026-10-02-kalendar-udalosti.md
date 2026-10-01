# Kalendář událostí – implementační plán (plán 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stránka Kalendář v Tradee.ai ukazuje ~20 událostí na obrazovku (síla → datum → název), s filtry a štítkem VŠE, plněná automaticky z oficiálních kalendářů (BLS, BEA, Fed, ECB, NYSE + vypočtené EIA/Baker Hughes/expirace) a doplněná ověřenými událostmi agenta.

**Architecture:** Python skript `scripts/refresh_calendar.py` (cron přes `refresh-vps.sh`) zapisuje kostru do `data/calendar.json`. `lib/calendar.ts` ji při renderu slučuje s `data/fundamentals.json → events` (agent má přednost, páruje se podle ID nebo typu+dne). UI v `app/calendar.tsx` + `app/calendar.css`, filtry v `localStorage`.

**Tech Stack:** Python 3.10+ (stdlib: urllib, zoneinfo, unittest), TypeScript/React (vinext/Next 16, Cloudflare Worker build), Node 22 `--experimental-strip-types` pro kontrolní skripty.

**Spec:** `docs/superpowers/specs/2026-10-02-kalendar-udalosti-design.md`

## Global Constraints

- Pracuje se ve větvi `feature/kalendar`; do `main` jen přes PR.
- Python musí běžet na VPS: **Python 3.10.12**, jen standardní knihovna (žádné `pip install`).
- Node **22** (VPS přes nvm); kontrolní skripty spouštět `node --experimental-strip-types`.
- Časy v datech vždy **ISO UTC** (`2026-10-14T12:30:00Z`); v UI vždy `Europe/Prague`.
- Všechny texty v UI česky. Neznámá hodnota = „zatím neznámé“ / „—“, **nikdy** vymyšlené číslo.
- `timeKnown:false`, když zdroj neuvádí čas (Fed, ECB, NYSE).
- Stálé ID události = `{kind}-{YYYY-MM-DD}` (místní datum vydání).
- Skripty `*.sh` a `*.py` s konci řádků **LF** (CRLF shodilo cron 26. 9.–1. 10.).
- Styl kódu jako okolí: kompaktní TSX, krátké názvy, CSS třídy s prefixem (`c-` pro kalendář).
- Commity končí řádkem `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Stejná událost dvakrát** – agentův starý záznam (`us-jobs-sep`) a skriptový (`us-nfp-2026-10-02`) musí splynout do jednoho řádku s ✓ (párování `kind` + den). Test v Task 4.
2. **Výpadek zdroje** – když BLS vrátí 403 nebo prázdno, jeho události z minulého běhu zůstanou a ostatní zdroje se zpracují. Test v Task 3.
3. **Letní/zimní čas** – CPI 14. 10. je 08:30 EDT = 12:30Z, NFP 6. 11. je 08:30 EST = 13:30Z. Test v Task 1.
4. **Prázdný nebo rozbitý `localStorage`** (anonymní okno, starý formát) – stránka musí naběhnout s výchozími filtry. Test v Task 4 (`readFilters`).
5. **Vše odfiltrováno** – uživatel vypne všechny skupiny → hláška „Filtrům neodpovídá žádná událost“ + tlačítko „Zrušit filtry“, ne prázdná bílá plocha. Ověření v Task 5, krok s prohlížečem.

---

## Souborová struktura

| Soubor | Odpovědnost |
|---|---|
| `scripts/refresh_calendar.py` (nový) | stažení a parsování zdrojů, vypočtené termíny, sestavení `data/calendar.json` |
| `scripts/tests/test_refresh_calendar.py` (nový) | unittesty parserů a `build()` nad fixturami |
| `scripts/tests/fixtures/*` (už v repu) | uložené odpovědi zdrojů: `bls.ics`, `bea.json`, `fed.html`, `ecb.html`, `nyse.html` |
| `data/calendar.json` (nový, generovaný) | kostra kalendáře, v gitu snímek |
| `lib/calendar.ts` (nový) | typy, sloučení, výchozí síla, VŠE, filtry, vlaječky → trhy, relativní čas |
| `scripts/check-calendar.mjs` (nový) | kontrolní testy `lib/calendar.ts` |
| `app/calendar.tsx` (přepis) | stránka Kalendář + exportovaný řádek `EventRow` |
| `app/calendar.css` (nový) | styly kalendáře, importované z `globals.css` |
| `app/tradee.tsx`, `app/dashboard.tsx` (úprava) | předání sloučených událostí a vlaječek |
| `lib/fundamentals.ts` (úprava) | rozšířený typ `events` |
| `FUNDAMENTALS.md`, `README.md` (úprava) | pravidla pro agenta, dokumentace |
| `.gitattributes` (nový), `scripts/refresh-vps.sh` (úprava) | LF konce řádků, spuštění skriptu |

---

### Task 1: Skript – základ, BLS a BEA

**Files:**
- Create: `scripts/refresh_calendar.py`
- Create: `scripts/tests/__init__.py` (prázdný)
- Create: `scripts/tests/test_refresh_calendar.py`
- Create: `.gitattributes`

**Interfaces:**
- Produces: `event(origin, kind, local_dt, *, title, category, markets, url, time_known=True) -> dict`, `parse_bls(text) -> list[dict]`, `parse_bea(text) -> list[dict]`, konstanty `ET`, `CET`, `MONTHS`, `utc_iso(dt)`, `parse_utc(s)`. Tvar události: `{id, at, timeKnown, title, category, markets, kind, source, origin}`.

- [ ] **Step 1: `.gitattributes`**

```gitattributes
*.sh text eol=lf
*.py text eol=lf
```

- [ ] **Step 2: Napiš padající testy**

`scripts/tests/test_refresh_calendar.py`:

```python
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
```

- [ ] **Step 3: Spusť – musí selhat**

Run: `python3 -m unittest discover -s scripts/tests -v`
Expected: FAIL / ERROR `ModuleNotFoundError: No module named 'refresh_calendar'`

- [ ] **Step 4: Implementuj základ + BLS + BEA**

`scripts/refresh_calendar.py` – první část souboru (zbytek přidají Task 2 a 3; konstanty a `fetch` sem patří už teď):

```python
#!/usr/bin/env python3
"""Kostra kalendáře z oficiálních zdrojů -> data/calendar.json. Spouští scripts/refresh-vps.sh (cron 4 h).
Každý zdroj má vlastní parser; spadlý zdroj nechá svoje události z minulého běhu a ok:false."""
import calendar as cal
import html
import json
import re
import sys
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'calendar.json'
UA = 'Mozilla/5.0 (compatible; TradeeCalendar/1.0; +https://tradee.dejny.eu)'
ET = ZoneInfo('America/New_York')
CET = ZoneInfo('Europe/Berlin')
HORIZON_DAYS = 60
PAST_DAYS = 7
MONTHS = {m: i for i, m in enumerate(cal.month_name) if m}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def utc_iso(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_utc(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def event(origin, kind, local_dt, *, title, category, markets, url, time_known=True):
    """Stálé ID = typ + místní datum vydání; origin = klíč zdroje v SOURCES (pro zachování dat při výpadku)."""
    return {'id': f'{kind}-{local_dt.date().isoformat()}', 'at': utc_iso(local_dt), 'timeKnown': time_known,
            'title': title, 'category': category, 'markets': markets, 'kind': kind, 'source': url, 'origin': origin}


# --- BLS (ICS) ---------------------------------------------------------------
BLS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics'
BLS_PAGE = 'https://www.bls.gov/schedule/news_release/'
BLS_KINDS = {
    'Employment Situation': ('us-nfp', 'USA • zaměstnanost (NFP)'),
    'Consumer Price Index': ('us-cpi', 'USA • CPI'),
    'Producer Price Index': ('us-ppi', 'USA • PPI'),
    'Job Openings and Labor Turnover Survey': ('us-jolts', 'USA • JOLTS'),
    'Employment Cost Index': ('us-eci', 'USA • index nákladů práce (ECI)'),
}


def parse_ics(text):
    text = re.sub(r'\r?\n[ \t]', '', text)
    for block in text.split('BEGIN:VEVENT')[1:]:
        fields = {}
        for line in block.splitlines():
            if ':' in line:
                key, value = line.split(':', 1)
                fields[key.split(';')[0]] = value.strip()
        yield fields


def parse_bls(text):
    out = []
    for f in parse_ics(text):
        name = f.get('SUMMARY', '').strip()
        if name not in BLS_KINDS or 'DTSTART' not in f:
            continue
        dt = datetime.strptime(f['DTSTART'][:15], '%Y%m%dT%H%M%S').replace(tzinfo=ET)
        kind, title = BLS_KINDS[name]
        out.append(event('bls', kind, dt, title=title, category='macro', markets=['USD'], url=BLS_PAGE))
    return out


# --- BEA (JSON) --------------------------------------------------------------
BEA_URL = 'https://apps.bea.gov/API/signup/release_dates.json'
BEA_PAGE = 'https://www.bea.gov/news/schedule'
BEA_KINDS = {
    'Gross Domestic Product': ('us-gdp', 'USA • HDP'),
    'Personal Income and Outlays': ('us-pce', 'USA • osobní příjmy a PCE'),
    'U.S. International Trade in Goods and Services': ('us-trade', 'USA • obchodní bilance'),
}


def parse_bea(text):
    data = json.loads(text)
    out = []
    for name, (kind, title) in BEA_KINDS.items():
        for s in data.get(name, {}).get('release_dates', []):
            dt = datetime.fromisoformat(s).astimezone(ET)
            out.append(event('bea', kind, dt, title=title, category='macro', markets=['USD'], url=BEA_PAGE))
    return out

```

- [ ] **Step 5: Spusť – musí projít**

Run: `python3 -m unittest discover -s scripts/tests -v`
Expected: `Ran 4 tests … OK`

- [ ] **Step 6: Commit**

```bash
git add .gitattributes scripts/refresh_calendar.py scripts/tests/__init__.py scripts/tests/test_refresh_calendar.py scripts/tests/fixtures
git commit -m "Kalendář: skript se zdroji BLS a BEA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Skript – Fed, ECB, NYSE a vypočtené termíny

**Files:**
- Modify: `scripts/refresh_calendar.py` (připojit za BEA)
- Modify: `scripts/tests/test_refresh_calendar.py`

**Interfaces:**
- Consumes: `event`, `ET`, `CET`, `MONTHS` z Task 1.
- Produces: `parse_fed(text)`, `parse_ecb(text)`, `parse_nyse(text)`, `computed(today: date, holidays: set[date]) -> list[dict]`, `third_friday(year, month) -> date`, URL konstanty `FED_URL`, `ECB_URL`, `NYSE_URL`.

- [ ] **Step 1: Přidej padající testy** (před `if __name__`)

```python
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
```

- [ ] **Step 2: Spusť – musí selhat**

Run: `python3 -m unittest discover -s scripts/tests -v`
Expected: ERROR `AttributeError: module 'refresh_calendar' has no attribute 'parse_fed'`

- [ ] **Step 3: Implementuj** – připoj za BEA blok:

```python
# --- Fed (HTML) --------------------------------------------------------------
FED_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'


def parse_fed(text):
    out = []
    parts = re.split(r'(\d{4}) FOMC Meetings', text)
    for year, body in zip(parts[1::2], parts[2::2]):
        rows = re.findall(r'fomc-meeting__month[^>]*><strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<', body, re.S)
        for month, days in rows:
            month = month.split('/')[-1].strip()
            m = re.match(r'(\d+)(?:-(\d+))?(\*?)', days.strip())
            if not m or month not in MONTHS:
                continue
            day = int(m.group(2) or m.group(1))
            dt = datetime(int(year), MONTHS[month], day, 14, 0, tzinfo=ET)
            title = 'FOMC • rozhodnutí o sazbách' + (' + projekce' if m.group(3) else '')
            out.append(event('fed', 'fomc', dt, title=title, category='central-bank', markets=['USD'], url=FED_URL, time_known=False))
    return out


# --- ECB (HTML) --------------------------------------------------------------
ECB_URL = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html'


def parse_ecb(text):
    out = []
    for d, desc in re.findall(r'<dt[^>]*>\s*(\d{2}/\d{2}/\d{4})\s*</dt>\s*<dd[^>]*>(.*?)</dd>', text, re.S):
        desc = re.sub(r'<[^>]+>', '', desc)
        if 'non-monetary' in desc or 'monetary policy meeting' not in desc or 'press conference' not in desc:
            continue
        dt = datetime.strptime(d, '%d/%m/%Y').replace(hour=14, minute=15, tzinfo=CET)
        out.append(event('ecb', 'ecb-rates', dt, title='ECB • sazby a tisková konference', category='central-bank', markets=['EUR'], url=ECB_URL, time_known=False))
    return out


# --- NYSE svátky (HTML tabulka) -------------------------------------------------
NYSE_URL = 'https://www.nyse.com/markets/hours-calendars'


def parse_nyse(text):
    table = re.search(r'<table.*?</table>', text, re.S)
    if not table:
        return []
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table.group(0), re.S)
    years = [int(y) for y in re.findall(r'<th[^>]*>(\d{4})</th>', rows[0])]
    out = []
    for row in rows[1:]:
        cells = [html.unescape(re.sub(r'<[^>]+>', '', c)).strip() for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)]
        name = cells[0]
        for year, cell in zip(years, cells[1:]):
            m = re.match(r'\w+day, (\w+) (\d+)', cell)
            if not m or m.group(1) not in MONTHS:
                continue
            dt = datetime(year, MONTHS[m.group(1)], int(m.group(2)), 9, 30, tzinfo=ET)
            out.append(event('nyse', 'nyse-holiday', dt, title=f'USA • burza zavřená ({name})', category='exchange', markets=['INDEX', 'STOCKS'], url=NYSE_URL, time_known=False))
    return out


# --- Vypočtené pravidelné termíny ------------------------------------------------
def third_friday(year, month):
    d = date(year, month, 15)
    return d + timedelta(days=(4 - d.weekday()) % 7)


def after_holiday(d, holidays):
    """EIA posouvá týdenní data o den, když v daném týdnu do dne vydání padl svátek."""
    monday = d - timedelta(days=d.weekday())
    return d + timedelta(days=1) if any(monday + timedelta(days=i) in holidays for i in range(d.weekday() + 1)) else d


def computed(today, holidays):
    out = []
    for i in range(-PAST_DAYS, HORIZON_DAYS + 1):
        d = today + timedelta(days=i)
        wd = d.weekday()
        if wd == 2:
            r = after_holiday(d, holidays)
            out.append(event('eia', 'eia-oil', datetime.combine(r, time(10, 30), ET), title='EIA • týdenní zásoby ropy', category='commodity', markets=['OIL'], url='https://www.eia.gov/petroleum/supply/weekly/schedule.php'))
        if wd == 3:
            r = after_holiday(d, holidays)
            out.append(event('eia', 'eia-gas', datetime.combine(r, time(10, 30), ET), title='EIA • zásoby zemního plynu', category='commodity', markets=['GAS'], url='https://ir.eia.gov/ngs/schedule.html'))
        if wd == 4:
            r = d - timedelta(days=1) if d in holidays else d
            out.append(event('bakerhughes', 'rig-count', datetime.combine(r, time(13, 0), ET), title='Baker Hughes • počet vrtných souprav', category='commodity', markets=['OIL'], url='https://rigcount.bakerhughes.com/'))
        if d == third_friday(d.year, d.month):
            r = d - timedelta(days=1) if d in holidays else d
            out.append(event('cboe', 'opex', datetime.combine(r, time(16, 0), ET), title='USA • měsíční expirace opcí', category='exchange', markets=['INDEX', 'STOCKS'], url='https://www.cboe.com/about/hours/'))
    return out

```

- [ ] **Step 4: Spusť – musí projít**

Run: `python3 -m unittest discover -s scripts/tests -v`
Expected: `Ran 9 tests … OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh_calendar.py scripts/tests/test_refresh_calendar.py
git commit -m "Kalendář: Fed, ECB, svátky NYSE, EIA, Baker Hughes, expirace opcí

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Skript – sestavení, výpadky zdrojů, cron

**Files:**
- Modify: `scripts/refresh_calendar.py` (připojit na konec)
- Modify: `scripts/tests/test_refresh_calendar.py`
- Modify: `scripts/refresh-vps.sh`
- Create: `data/calendar.json` (vygenerovaný)

**Interfaces:**
- Consumes: všechny parsery a `computed` z Task 1–2.
- Produces: `SOURCES: dict[str, tuple[url, parser]]`, `build(previous: dict, fetcher: Callable[[str], str], now: datetime) -> {'generatedAt', 'sources': {name: {ok, lastSuccess, url, error}}, 'events': [...]}`; soubor `data/calendar.json` v tomto tvaru (čte ho Task 4/5).

- [ ] **Step 1: Přidej padající testy**

```python
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
```

- [ ] **Step 2: Spusť – musí selhat**

Run: `python3 -m unittest discover -s scripts/tests -v`
Expected: ERROR `AttributeError: module 'refresh_calendar' has no attribute 'build'`

- [ ] **Step 3: Implementuj** – připoj na konec souboru:

```python
SOURCES = {
    'bls': (BLS_URL, parse_bls),
    'bea': (BEA_URL, parse_bea),
    'fed': (FED_URL, parse_fed),
    'ecb': (ECB_URL, parse_ecb),
    'nyse': (NYSE_URL, parse_nyse),
}


def build(previous, fetcher, now):
    prev_events = previous.get('events', [])
    prev_sources = previous.get('sources', {})
    sources, events = {}, []
    for name, (url, parser) in SOURCES.items():
        try:
            got = parser(fetcher(url))
            if not got:
                raise ValueError('zdroj nevrátil žádné události')
            events += got
            sources[name] = {'ok': True, 'lastSuccess': utc_iso(now), 'url': url, 'error': None}
        except Exception as e:  # noqa: BLE001 – jeden spadlý zdroj nesmí shodit ostatní
            events += [x for x in prev_events if x.get('origin') == name]
            sources[name] = {'ok': False, 'lastSuccess': prev_sources.get(name, {}).get('lastSuccess'), 'url': url, 'error': f'{type(e).__name__}: {e}'[:300]}
            print(f'!! kalendář: zdroj {name} selhal: {e}', file=sys.stderr)
    holidays = {parse_utc(x['at']).astimezone(ET).date() for x in events if x.get('kind') == 'nyse-holiday'}
    events += computed(now.astimezone(ET).date(), holidays)
    start, end = now - timedelta(days=PAST_DAYS), now + timedelta(days=HORIZON_DAYS)
    unique = {e['id']: e for e in events if start <= parse_utc(e['at']) <= end}
    return {'generatedAt': utc_iso(now), 'sources': sources, 'events': sorted(unique.values(), key=lambda e: (e['at'], e['id']))}


def main():
    previous = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    data = build(previous, fetch, datetime.now(timezone.utc))
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    status = ', '.join(f"{k}={'ok' if v['ok'] else 'CHYBA'}" for k, v in data['sources'].items())
    print(f"kalendář ok: {len(data['events'])} událostí · {status}")
    return 0


if __name__ == '__main__':
    sys.exit(main())

```

- [ ] **Step 4: Spusť – musí projít**

Run: `python3 -m unittest discover -s scripts/tests -v`
Expected: `Ran 13 tests … OK`

- [ ] **Step 5: Zapoj do `scripts/refresh-vps.sh`** – za řádek s `check-score.mjs` a **před** `npm run build`:

```bash
python3 scripts/refresh_calendar.py || echo "!! refresh_calendar selhal"
```

- [ ] **Step 6: Vygeneruj první snímek naostro**

Run: `python3 scripts/refresh_calendar.py`
Expected: `kalendář ok: <40–80> událostí · bls=ok, bea=ok, fed=ok, ecb=ok, nyse=ok`. Když některý zdroj hlásí `CHYBA`, přečti `error` v `data/calendar.json` – na Macu může BLS vracet 403 bez prohlížečového User-Agentu; pak to hlásit, ne obcházet.

- [ ] **Step 7: Commit**

```bash
chmod +x scripts/refresh_calendar.py
git add scripts/refresh_calendar.py scripts/tests/test_refresh_calendar.py scripts/refresh-vps.sh data/calendar.json
git commit -m "Kalendář: sestavení calendar.json, zachování dat při výpadku zdroje, cron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `lib/calendar.ts` – sloučení, síla, VŠE, filtry

**Files:**
- Create: `lib/calendar.ts`
- Create: `scripts/check-calendar.mjs`
- Modify: `lib/fundamentals.ts:9` (typ `events`)

**Interfaces:**
- Consumes: tvar `data/calendar.json` z Task 3; `FundamentalData['events']`.
- Produces (Task 5 a 6 používají přesně tyto názvy):
  - typy `Category`, `Signal = 1|2|3`, `CalendarEvent`, `AutoEvent`, `CuratedEvent`, `Filters = {categories, markets, minSignal, showGlobal, hidePast}`
  - `categories: Record<Category,string>`, `marketLabels`, `signalLabels`, `DEFAULT_SIGNAL`, `GLOBAL_KINDS`, `defaultFilters`
  - `mergeCalendar(auto, curated) -> CalendarEvent[]` (seřazené)
  - `filterEvents(events, filters, now) -> CalendarEvent[]`
  - `readFilters(raw: string|null) -> Filters`
  - `flaggedMarkets(flags) -> Set<string>`, `filterMarket(m)`, `relative(at, now) -> string`, `upcomingCalendar(events, now, limit)`

- [ ] **Step 1: Napiš padající kontrolu** `scripts/check-calendar.mjs`

```js
// Kontrola kalendáře bez prohlížeče: node --experimental-strip-types scripts/check-calendar.mjs
import {readFileSync} from 'node:fs';
import {mergeCalendar,filterEvents,defaultFilters,readFilters,flaggedMarkets,filterMarket,relative,upcomingCalendar} from '../lib/calendar.ts';
const read=f=>JSON.parse(readFileSync(new URL('../data/'+f,import.meta.url),'utf8'));
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const now=Date.parse('2026-10-02T08:00:00Z');

const auto=[
 {id:'us-nfp-2026-10-02',at:'2026-10-02T12:30:00Z',timeKnown:true,title:'USA • zaměstnanost (NFP)',category:'macro',markets:['USD'],kind:'us-nfp',source:'https://bls',origin:'bls'},
 {id:'eia-oil-2026-10-07',at:'2026-10-07T14:30:00Z',timeKnown:true,title:'EIA • týdenní zásoby ropy',category:'commodity',markets:['OIL'],kind:'eia-oil',source:'https://eia',origin:'eia'},
 {id:'rig-count-2026-10-02',at:'2026-10-02T17:00:00Z',timeKnown:true,title:'Baker Hughes',category:'commodity',markets:['OIL'],kind:'rig-count',source:'https://bh',origin:'bakerhughes'},
 {id:'us-cpi-2026-10-14',at:'2026-10-14T12:30:00Z',timeKnown:true,title:'USA • CPI',category:'macro',markets:['USD'],kind:'us-cpi',source:'https://bls',origin:'bls'},
 {id:'us-ppi-2026-09-25',at:'2026-09-25T12:30:00Z',timeKnown:true,title:'USA • PPI',category:'macro',markets:['USD'],kind:'us-ppi',source:'https://bls',origin:'bls'},
];
const curated=[
 // starý záznam agenta: vlastní ID, currency+importance, bez kind → páruje se s us-nfp-2026-10-02
 {id:'us-jobs-sep',currency:'USD',at:'2026-10-02T12:30:00Z',title:'USA • zaměstnanost za září',source:'https://bls.gov/x',watch:'NFP a mzdy',timeKnown:true,importance:'vysoká',consensus:'+100 000',actual:null},
 // nový záznam agenta s ID skriptu: doplní sílu a poznámku, prázdné hodnoty nepřepisují
 {id:'us-cpi-2026-10-14',at:'2026-10-14T12:30:00Z',title:'USA • CPI za září',source:'',timeKnown:true,signal:3,watch:'Jádrová inflace',consensus:null},
 // čistě agentova událost
 {id:'eth-upgrade-2026-10-03',at:'2026-10-03T00:00:00Z',title:'Ethereum • upgrade',source:'https://eth',timeKnown:false,category:'crypto',markets:['ETH'],signal:3},
 // RBA ze staré struktury → centrální banka
 {id:'rba-oct',currency:'AUD',at:'2026-10-05T03:30:00Z',title:'RBA • rozhodnutí o sazbách',source:'https://rba',timeKnown:true,importance:'střední'},
];
const m=mergeCalendar(auto,curated);
const by=Object.fromEntries(m.map(e=>[e.id,e]));
check('párování starého záznamu podle typu a dne',!by['us-nfp-2026-10-02']&&by['us-jobs-sep']?.verified===true,Object.keys(by));
check('starý záznam převzal kind a VŠE',by['us-jobs-sep']?.kind==='us-nfp'&&by['us-jobs-sep']?.global===true,by['us-jobs-sep']);
check('starý záznam: importance → signal 3, currency → markets',by['us-jobs-sep']?.signal===3&&by['us-jobs-sep']?.markets.join()==='USD',by['us-jobs-sep']);
check('agent s ID skriptu: přednost + prázdný source nepřepíše',by['us-cpi-2026-10-14']?.title==='USA • CPI za září'&&by['us-cpi-2026-10-14']?.source==='https://bls'&&by['us-cpi-2026-10-14']?.verified,by['us-cpi-2026-10-14']);
check('skriptová událost: výchozí síla a ○',by['eia-oil-2026-10-07']?.signal===2&&by['eia-oil-2026-10-07']?.verified===false&&by['eia-oil-2026-10-07']?.global===false,by['eia-oil-2026-10-07']);
check('RBA → centrální banka, střední',by['rba-oct']?.category==='central-bank'&&by['rba-oct']?.signal===2,by['rba-oct']);
check('seřazeno podle času',m.every((e,i)=>!i||m[i-1].at<=e.at),m.map(e=>e.at));
check('počet po sloučení',m.length===7,m.length);

const shown=filterEvents(m,defaultFilters,now).map(e=>e.id);
check('výchozí filtr skryje sílu 1',!shown.includes('rig-count-2026-10-02')&&shown.includes('eia-oil-2026-10-07'),shown);
const noCats={...defaultFilters,categories:[]};
check('VŠE projde i bez skupin',filterEvents(m,noCats,now).map(e=>e.id).join()==='us-jobs-sep,us-cpi-2026-10-14',filterEvents(m,noCats,now).map(e=>e.id));
check('bez VŠE a bez skupin nic',filterEvents(m,{...noCats,showGlobal:false},now).length===0,filterEvents(m,{...noCats,showGlobal:false},now).length);
check('filtr trhu',filterEvents(m,{...defaultFilters,markets:['OIL'],showGlobal:false},now).map(e=>e.id).join()==='eia-oil-2026-10-07',filterEvents(m,{...defaultFilters,markets:['OIL'],showGlobal:false},now).map(e=>e.id));
check('skrýt proběhlé',!filterEvents(m,{...defaultFilters,hidePast:true},now).some(e=>e.id==='us-ppi-2026-09-25'),null);
check('ticker → Akcie',filterMarket('AAPL')==='STOCKS'&&filterMarket('OIL')==='OIL',[filterMarket('AAPL'),filterMarket('OIL')]);

check('readFilters: null',JSON.stringify(readFilters(null))===JSON.stringify(defaultFilters),readFilters(null));
check('readFilters: rozbitý JSON',JSON.stringify(readFilters('{nope'))===JSON.stringify(defaultFilters),readFilters('{nope'));
const rf=readFilters('{"categories":["macro","xxx"],"minSignal":7,"hidePast":true}');
check('readFilters: neznámé hodnoty zahodí',rf.categories.join()==='macro'&&rf.minSignal===2&&rf.hidePast===true&&rf.showGlobal===true,rf);

const fm=[...flaggedMarkets({'EUR/USD':'green','BTC-USD':'red','^NDX':'orange',AAPL:'none',USD:'green'})].sort().join();
check('vlaječky → trhy',fm==='BTC,EUR,INDEX,USD',fm);
check('relative',relative('2026-10-02T10:50:00Z',now)==='za 2 h 50 min'&&relative('2026-10-06T08:00:00Z',now)==='za 4 d'&&relative('2026-10-02T07:15:00Z',now)==='před 45 min',[relative('2026-10-02T10:50:00Z',now),relative('2026-10-06T08:00:00Z',now),relative('2026-10-02T07:15:00Z',now)]);
check('dashboard: síla ≥ 2 nebo VŠE',upcomingCalendar(m,now,5).map(e=>e.id).join()==='us-jobs-sep,eth-upgrade-2026-10-03,rba-oct,eia-oil-2026-10-07,us-cpi-2026-10-14',upcomingCalendar(m,now,5).map(e=>e.id));

// Skutečná data z repa: žádná duplicita mezi skriptem a agentem.
const real=mergeCalendar(read('calendar.json').events,read('fundamentals.json').events);
const keys=real.map(e=>(e.kind??e.id)+'@'+e.at.slice(0,10));
check('reálná data bez duplicit',new Set(keys).size===keys.length,keys.filter((k,i)=>keys.indexOf(k)!==i));
console.log('reálně',real.length,'událostí,',real.filter(e=>e.verified).length,'ověřených');
console.log(fails.length?'CHECK FAILED':'CHECK OK');
if(fails.length)process.exitCode=1;
```

- [ ] **Step 2: Spusť – musí selhat**

Run: `node --experimental-strip-types scripts/check-calendar.mjs`
Expected: `ERR_MODULE_NOT_FOUND … lib/calendar.ts`

- [ ] **Step 3: Implementuj `lib/calendar.ts`**

```ts
// Kalendář událostí: sloučení kostry ze skriptu (data/calendar.json) a ověřených událostí agenta (fundamentals.json → events).
export type Category='macro'|'central-bank'|'exchange'|'commodity'|'crypto'|'equity'|'politics';
export type Signal=1|2|3;
export type CalendarEvent={id:string;at:string;timeKnown:boolean;title:string;category:Category;markets:string[];kind?:string;signal:Signal;global:boolean;verified:boolean;source:string;watch?:string;consensus?:string|null;previous?:string|null;actual?:string|null;verifiedAt?:string};
export type AutoEvent={id:string;at:string;timeKnown:boolean;title:string;category:Category;markets:string[];kind?:string;source:string;origin?:string};
export type CuratedEvent={id:string;at:string;title:string;source:string;timeKnown:boolean;currency?:string;importance?:string;watch?:string;consensus?:string|null;actual?:string|null;category?:Category;markets?:string[];kind?:string;signal?:Signal;global?:boolean;previous?:string|null;verifiedAt?:string};
export type Filters={categories:Category[];markets:string[];minSignal:Signal;showGlobal:boolean;hidePast:boolean};

export const categories:Record<Category,string>={macro:'Makro','central-bank':'Centrální banky',exchange:'Burzy',commodity:'Komodity',crypto:'Krypto',equity:'Akcie',politics:'Politika'};
export const marketLabels:Record<string,string>={USD:'USD',EUR:'EUR',GBP:'GBP',JPY:'JPY',CHF:'CHF',AUD:'AUD',NZD:'NZD',CAD:'CAD',BTC:'BTC',ETH:'ETH',SOL:'SOL',OIL:'Ropa',GOLD:'Zlato',GAS:'Plyn',INDEX:'Indexy',STOCKS:'Akcie'};
export const signalLabels:Record<Signal,string>={1:'Slabá',2:'Střední',3:'Silná'};
// Výchozí síla podle typu, když ji agent nedoplnil.
export const DEFAULT_SIGNAL:Record<string,Signal>={'us-nfp':3,'us-cpi':3,'us-gdp':3,'us-pce':3,fomc:3,'ecb-rates':3,'us-ppi':2,'us-jolts':2,'us-eci':2,'us-trade':2,'eia-oil':2,'eia-gas':2,'rig-count':1,opex:2,'nyse-holiday':1};
// Události, které hýbou všemi trhy (štítek VŠE). Agent může VŠE přidat i jiným událostem polem global.
export const GLOBAL_KINDS=['fomc','us-nfp','us-cpi','us-gdp','ecb-rates','opec'];
// Staré záznamy agenta bez pole kind – typ odvozený z titulku.
const LEGACY_KINDS:[RegExp,string][]=[[/^FOMC/i,'fomc'],[/^USA • zaměstnanost/i,'us-nfp'],[/^USA • CPI/i,'us-cpi'],[/^USA • HDP/i,'us-gdp'],[/^USA • osobní příjmy|PCE/i,'us-pce'],[/^USA • JOLTS/i,'us-jolts'],[/^ECB/i,'ecb-rates']];
const BANKS=/^(FOMC|Fed|ECB|RBA|RBNZ|BoC|BoJ|BoE|Bank of England|Swiss National Bank|SNB)\b/i;
const STOCK=/^[A-Z][A-Z.-]{0,5}$/;

const day=(iso:string)=>iso.slice(0,10);
const legacySignal=(s?:string):Signal|undefined=>!s?undefined:/high|vysok/i.test(s)?3:/med|stř/i.test(s)?2:1;

export function normalizeCurated(e:CuratedEvent):Omit<CalendarEvent,'signal'|'global'|'markets'>&{signal?:Signal;global?:boolean;markets?:string[]}{
 const kind=e.kind??LEGACY_KINDS.find(([re])=>re.test(e.title))?.[1];
 return {id:e.id,at:e.at,timeKnown:e.timeKnown,title:e.title,source:e.source,kind,
  category:e.category??(BANKS.test(e.title)?'central-bank':'macro'),
  markets:e.markets??(e.currency?[e.currency]:undefined),
  signal:e.signal??legacySignal(e.importance),global:e.global,verified:true,
  watch:e.watch,consensus:e.consensus??null,previous:e.previous??null,actual:e.actual??null,verifiedAt:e.verifiedAt};
}

const filled=(v:unknown)=>v!==undefined&&v!==null&&v!==''&&!(Array.isArray(v)&&!v.length);

export function mergeCalendar(auto:AutoEvent[],curated:CuratedEvent[]):CalendarEvent[]{
 const byId=new Map<string,Partial<CalendarEvent>>();
 for(const a of auto)byId.set(a.id,{...a,verified:false});
 for(const raw of curated){
  const c=normalizeCurated(raw);
  // Agent použil ID skriptu, nebo jde o stejný typ ve stejný den (staré záznamy s vlastním ID).
  const match=byId.has(c.id)?c.id:c.kind?[...byId.entries()].find(([,a])=>!a.verified&&a.kind===c.kind&&day(a.at!)===day(c.at))?.[0]:undefined;
  const base=match?byId.get(match)!:{};
  if(match&&match!==c.id)byId.delete(match);
  const merged:Partial<CalendarEvent>={...base};
  for(const [k,v] of Object.entries(c))if(filled(v))(merged as Record<string,unknown>)[k]=v;
  merged.verified=true;
  byId.set(c.id,merged);
 }
 return [...byId.values()].map(e=>({
  ...e,
  markets:e.markets??[],
  signal:e.signal??DEFAULT_SIGNAL[e.kind??'']??1,
  global:e.global??GLOBAL_KINDS.includes(e.kind??''),
  verified:e.verified??false,
 } as CalendarEvent)).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}

// Akciové tickery spadají pod filtr „Akcie“.
export const filterMarket=(m:string)=>marketLabels[m]?m:STOCK.test(m)?'STOCKS':m;

export const defaultFilters:Filters={categories:Object.keys(categories) as Category[],markets:Object.keys(marketLabels),minSignal:2,showGlobal:true,hidePast:false};

export function filterEvents(events:CalendarEvent[],f:Filters,now:number){
 return events.filter(e=>{
  if(f.hidePast&&Date.parse(e.at)<now-3600000)return false;
  if(f.showGlobal&&e.global)return true;
  if(e.signal<f.minSignal)return false;
  if(!f.categories.includes(e.category))return false;
  return !e.markets.length||e.markets.some(m=>f.markets.includes(filterMarket(m)));
 });
}

// Vlaječky jsou na instrumentech (EUR/USD, USD, BTC-USD, ^NDX, AAPL) → trhy kalendáře.
export function flaggedMarkets(flags:Record<string,string>){
 const out=new Set<string>();
 for(const [id,flag] of Object.entries(flags)){
  if(!flag||flag==='none')continue;
  if(id.includes('/'))id.split('/').forEach(c=>out.add(c));
  else if(id.endsWith('-USD'))out.add(id.slice(0,-4));
  else if(id.startsWith('^'))out.add('INDEX');
  else out.add(id);
 }
 return out;
}

export function relative(at:string,now:number){
 const diff=Date.parse(at)-now,abs=Math.abs(diff),min=Math.round(abs/60000);
 const txt=min<60?min+' min':min<1440?Math.floor(min/60)+' h'+(min%60&&min<600?' '+min%60+' min':''):Math.round(min/1440)+' d';
 return diff>=0?'za '+txt:'před '+txt;
}

export function upcomingCalendar(events:CalendarEvent[],now:number,limit:number){
 return events.filter(e=>Date.parse(e.at)>=now-3*3600000&&(e.signal>=2||e.global)).slice(0,limit);
}

// Filtry z localStorage – cokoli nečitelného nebo starého vrací výchozí hodnoty.
export function readFilters(raw:string|null):Filters{
 try{
  const v=raw?JSON.parse(raw):null;
  if(!v||typeof v!=='object')return defaultFilters;
  return {
   categories:Array.isArray(v.categories)?v.categories.filter((c:string)=>c in categories):defaultFilters.categories,
   markets:Array.isArray(v.markets)?v.markets.filter((m:string)=>m in marketLabels):defaultFilters.markets,
   minSignal:[1,2,3].includes(v.minSignal)?v.minSignal:defaultFilters.minSignal,
   showGlobal:typeof v.showGlobal==='boolean'?v.showGlobal:true,
   hidePast:v.hidePast===true,
  };
 }catch{return defaultFilters}
}
```

- [ ] **Step 4: Rozšiř typ v `lib/fundamentals.ts`** – v typu `FundamentalData` nahraď definici `events:{…}[]` za:

```ts
events:{id:string;currency?:string;at:string;title:string;source:string;watch?:string;timeKnown:boolean;importance?:string;consensus?:string|null;actual?:string|null;category?:'macro'|'central-bank'|'exchange'|'commodity'|'crypto'|'equity'|'politics';markets?:string[];kind?:string;signal?:1|2|3;global?:boolean;previous?:string|null;verifiedAt?:string}[];
```

- [ ] **Step 5: Spusť – musí projít**

Run: `node --experimental-strip-types scripts/check-calendar.mjs`
Expected: poslední řádek `CHECK OK`

- [ ] **Step 6: Commit**

```bash
git add lib/calendar.ts lib/fundamentals.ts scripts/check-calendar.mjs
git commit -m "Kalendář: sloučení skriptu a agenta, síla, VŠE, filtry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Stránka Kalendář

**Files:**
- Modify (přepis): `app/calendar.tsx`
- Create: `app/calendar.css`
- Modify: `app/globals.css:5` (import)
- Modify: `app/tradee.tsx:10-11,41` (data pro stránku)

**Interfaces:**
- Consumes: z `lib/calendar.ts` vše uvedené v Task 4; `pairs` z `lib/score-engine.ts`; `flagLabels` z `lib/markets.ts`.
- Produces: `CalendarPage({events, now, flags, generatedAt})`, `EventRow({e, now, mine, open?, onToggle?, compact?})` – `EventRow` použije Task 6.

- [ ] **Step 1: `app/calendar.tsx`** (celý soubor)

```tsx
'use client';
import {Fragment,useEffect,useMemo,useState} from 'react';
import {SlidersHorizontal} from 'lucide-react';
import {pairs} from '@/lib/score-engine';
import {categories,marketLabels,signalLabels,defaultFilters,filterEvents,flaggedMarkets,readFilters,relative,type CalendarEvent,type Category,type Filters,type Signal} from '@/lib/calendar';
const KEY='tradee.calendar.filters',TZ='Europe/Prague';
const time=(s:string)=>new Date(s).toLocaleTimeString('cs-CZ',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});
const dayName=(s:string)=>new Date(s).toLocaleDateString('cs-CZ',{timeZone:TZ,weekday:'long',day:'numeric',month:'long'});
const stamp=(s:string)=>new Date(s).toLocaleString('cs-CZ',{timeZone:TZ,day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const toggle=<T,>(list:T[],v:T)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];

export function SignalBars({signal}:{signal:Signal}){return <span className={'c-sig c-s'+signal} aria-hidden="true"><i/><i/><i/></span>}

export function EventRow({e,now,mine,open,onToggle,compact}:{e:CalendarEvent;now:number;mine:Set<string>;open?:boolean;onToggle?:()=>void;compact?:boolean}){
 const past=Date.parse(e.at)<now,watched=e.markets.some(m=>mine.has(m));
 return <div className={'c-row'+(past?' c-past':'')+(open?' c-open':'')+(compact?' c-compact':'')} role={onToggle?'button':undefined} tabIndex={onToggle?0:undefined} aria-expanded={onToggle?!!open:undefined} onClick={onToggle} onKeyDown={k=>{if(onToggle&&(k.key==='Enter'||k.key===' ')){k.preventDefault();onToggle()}}}>
  <span className="c-strength"><SignalBars signal={e.signal}/>{signalLabels[e.signal]}</span>
  <span className="c-when"><b>{e.timeKnown?time(e.at):'—'}</b><small>{compact?new Date(e.at).toLocaleDateString('cs-CZ',{timeZone:TZ,day:'numeric',month:'numeric'})+' · ':''}{relative(e.at,now)}</small></span>
  <span className="c-title">{e.title}</span>
  {!compact&&<span className="c-tags">{e.global&&<span className="c-tag c-all">VŠE</span>}{e.markets.map(m=><span key={m} className="c-tag">{marketLabels[m]??m}</span>)}{watched&&<span className="c-tag c-mine">sleduješ</span>}</span>}
  {compact?e.global&&<span className="c-tag c-all">VŠE</span>:<span className={'c-ver'+(e.verified?'':' c-no')} title={e.verified?'Ověřeno agentem':'Zatím jen termín z oficiálního kalendáře'}>{e.verified?'✓':'○'}</span>}
 </div>;
}

function EventDetail({e,flags,now}:{e:CalendarEvent;flags:Record<string,string>;now:number}){
 const affected=pairs.filter(p=>p.split('/').some(c=>e.markets.includes(c)));
 const followed=affected.filter(p=>flags[p]&&flags[p]!=='none');
 return <div className="c-detail">
  <div><h4>Na co se dívat</h4><p>{e.watch||'Agent zatím nedoplnil.'}</p>{affected.length>0&&<small>Dotčené páry: {affected.slice(0,8).join(', ')}{affected.length>8?' …':''}{followed.length>0&&<> · sleduješ: <b>{followed.join(', ')}</b></>}</small>}</div>
  <div><h4>Očekávání · předchozí</h4><p><b>{e.consensus||'zatím neznámé'}</b></p><small>předchozí: {e.previous||'—'}</small><h4>Výsledek</h4><p>{e.actual||(Date.parse(e.at)<now?'čeká na ověření':'zatím neznámý')}</p></div>
  <div><h4>Zdroj</h4>{e.source?<a href={e.source} target="_blank" rel="noreferrer" onClick={x=>x.stopPropagation()}>{new URL(e.source).hostname.replace(/^www\./,'')}</a>:<p>—</p>}<small>{e.verified?'ověřeno agentem'+(e.verifiedAt?' '+stamp(e.verifiedAt):''):'jen termín z oficiálního kalendáře'}{!e.timeKnown&&' · přesný čas neověřen'}</small></div>
 </div>;
}

export function CalendarPage({events,now,flags,generatedAt}:{events:CalendarEvent[];now:number;flags:Record<string,string>;generatedAt:string}){
 const [f,setF]=useState<Filters>(defaultFilters),[open,setOpen]=useState<string|null>(null),[panel,setPanel]=useState(false);
 useEffect(()=>{let raw:string|null=null;try{raw=localStorage.getItem(KEY)}catch{}setF(readFilters(raw))},[]);
 const update=(next:Filters)=>{setF(next);try{localStorage.setItem(KEY,JSON.stringify(next))}catch{}};
 const mine=useMemo(()=>flaggedMarkets(flags),[flags]);
 const shown=useMemo(()=>filterEvents(events,f,now),[events,f,now]);
 const firstFuture=shown.find(e=>Date.parse(e.at)>=now)?.id;
 const days=new Map<string,CalendarEvent[]>();
 for(const e of shown){const k=dayName(e.at);if(!days.has(k))days.set(k,[]);days.get(k)!.push(e)}
 const today=dayName(new Date(now).toISOString());
 const chip=(on:boolean,label:string,click:()=>void,key:string)=><button key={key} type="button" className={'c-chip'+(on?' on':'')} aria-pressed={on} onClick={click}>{label}</button>;
 return <div className="c-page">
  <div className="t-page-head"><div><h1>Kalendář</h1><p>Čas v Praze · {events.length} událostí · zobrazeno {shown.length}</p></div><span className="t-val">aktualizováno {stamp(generatedAt)}</span></div>
  <button type="button" className="c-filter-toggle" aria-expanded={panel} onClick={()=>setPanel(!panel)}><SlidersHorizontal size={16}/>Filtry</button>
  <div className={'c-filters'+(panel?' open':'')}>
   <div><span className="c-flab">Skupiny</span>{(Object.keys(categories) as Category[]).map(c=>chip(f.categories.includes(c),categories[c],()=>update({...f,categories:toggle(f.categories,c)}),c))}</div>
   <div><span className="c-flab">Trhy</span>{Object.keys(marketLabels).map(m=>chip(f.markets.includes(m),marketLabels[m],()=>update({...f,markets:toggle(f.markets,m)}),m))}</div>
   <div><span className="c-flab">Síla</span>{([[1,'vše'],[2,'střední+'],[3,'jen silná']] as [Signal,string][]).map(([s,l])=>chip(f.minSignal===s,l,()=>update({...f,minSignal:s}),'s'+s))}
    <label className="c-switch"><input type="checkbox" checked={f.showGlobal} onChange={x=>update({...f,showGlobal:x.target.checked})}/>vždy ukázat <span className="c-tag c-all">VŠE</span></label>
    <label className="c-switch"><input type="checkbox" checked={f.hidePast} onChange={x=>update({...f,hidePast:x.target.checked})}/>skrýt proběhlé</label></div>
  </div>
  {shown.length?<div className="c-list">{[...days].map(([d,list])=><Fragment key={d}>
   <div className="c-day">{d}{d===today?' · dnes':''}</div>
   {list.map(e=><Fragment key={e.id}>
    {e.id===firstFuture&&<div className="c-now"><span>teď {time(new Date(now).toISOString())}</span></div>}
    <EventRow e={e} now={now} mine={mine} open={open===e.id} onToggle={()=>setOpen(open===e.id?null:e.id)}/>
    {open===e.id&&<EventDetail e={e} flags={flags} now={now}/>}
   </Fragment>)}
  </Fragment>)}</div>:<div className="t-card c-empty"><p>Filtrům neodpovídá žádná událost.</p><button type="button" className="c-chip on" onClick={()=>update(defaultFilters)}>Zrušit filtry</button></div>}
  <p className="c-note"><span className="c-ver">✓</span> ověřeno agentem · <span className="c-ver c-no">○</span> zatím jen termín z oficiálního kalendáře · <span className="c-tag c-all">VŠE</span> hýbe všemi trhy · <span className="c-tag c-mine">sleduješ</span> týká se trhu s tvou vlaječkou</p>
 </div>;
}
```

- [ ] **Step 2: `app/calendar.css`**

```css
/* Tradee.ai · kalendář událostí */
.c-filter-toggle{display:none;align-items:center;gap:6px;padding:8px 14px;border-radius:12px;border:1px solid #e3e8f2;background:#fff;font-size:13px;font-weight:600;color:#4b5563;margin-bottom:10px}
.c-filters{position:sticky;top:64px;z-index:10;display:grid;gap:8px;padding:10px 14px;margin-bottom:12px;background:#ffffffeb;backdrop-filter:blur(10px);border:1px solid #e3e8f2;border-radius:14px}
.c-filters>div{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.c-flab{width:64px;flex:none;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8b93a3}
.c-chip{padding:4px 10px;border-radius:999px;border:1px solid #e3e8f2;background:#fff;font-size:12px;font-weight:600;color:#4b5563;cursor:pointer}
.c-chip:hover{background:#f1f4fb}
.c-chip.on{background:#e8efff;border-color:#245bff55;color:#245bff}
.c-switch{display:inline-flex;align-items:center;gap:6px;margin-left:12px;font-size:12px;color:#4b5563;cursor:pointer}
.c-switch input{accent-color:#245bff}
.c-list{background:#fff;border:1px solid #e3e8f2;border-radius:14px;overflow:hidden}
.c-day{padding:6px 12px;background:#f7f9fd;border-top:1px solid #eef1f7;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7280}
.c-day:first-child{border-top:0}
.c-row{display:grid;grid-template-columns:92px 132px minmax(0,1fr) auto 18px;align-items:center;gap:10px;height:32px;padding:0 12px;border-top:1px solid #f1f4fb;font-size:13px;color:#141518}
.c-row[role=button]{cursor:pointer}
.c-row[role=button]:hover,.c-row.c-open{background:#fbfcff}
.c-row:focus-visible{outline:2px solid #245bff;outline-offset:-2px}
.c-past{opacity:.45}
.c-strength{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700}
.c-sig{display:inline-flex;align-items:flex-end;gap:2px;height:14px}
.c-sig i{width:4px;border-radius:1px;background:#e3e8f2}
.c-sig i:nth-child(1){height:5px}.c-sig i:nth-child(2){height:9px}.c-sig i:nth-child(3){height:14px}
.c-s3 i{background:#e5484d}
.c-s2 i:nth-child(-n+2){background:#f5a524}
.c-s1 i:nth-child(1){background:#8b93a3}
.c-when{display:flex;align-items:baseline;gap:6px;white-space:nowrap;overflow:hidden}
.c-when b{font-weight:700;font-variant-numeric:tabular-nums}
.c-when small{font-size:12px;color:#8b93a3}
.c-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.c-open .c-title{font-weight:600}
.c-tags{display:flex;gap:4px;justify-content:flex-end;white-space:nowrap}
.c-tag{display:inline-block;padding:1px 6px;border-radius:6px;background:#f1f4fb;color:#4b5563;font-size:11px;font-weight:600}
.c-tag.c-all{background:#141518;color:#fff}
.c-tag.c-mine{background:#fff4e5;color:#b45309}
.c-ver{font-size:12px;color:#16a34a;text-align:center}
.c-ver.c-no{color:#b8bfcc}
.c-now{position:relative;height:0;border-top:2px solid #245bff}
.c-now span{position:absolute;left:12px;top:-10px;padding:1px 6px;border-radius:4px;background:#245bff;color:#fff;font-size:10px;font-weight:700}
.c-detail{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:16px;padding:10px 12px 14px 114px;background:#fbfcff;border-top:1px dashed #e3e8f2;font-size:12px;color:#374151}
.c-detail h4{margin:0 0 3px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8b93a3}
.c-detail h4+p,.c-detail p{margin:0 0 4px}
.c-detail div>h4:not(:first-child){margin-top:8px}
.c-detail small{color:#6b7280}
.c-detail a{color:#245bff;font-weight:600}
.c-empty{text-align:center;color:#6b7280}
.c-empty p{margin:0 0 10px}
.c-note{margin-top:12px;font-size:12px;color:#6b7280}
/* kompaktní řádek ve widgetu dashboardu */
.c-list.c-compact{border:0;border-radius:0}
.c-row.c-compact{grid-template-columns:86px 120px minmax(0,1fr) auto;padding:0;height:34px}
@media (max-width:640px){
 .c-filter-toggle{display:inline-flex}
 .c-filters{display:none;position:static}
 .c-filters.open{display:grid}
 .c-row,.c-row.c-compact{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"s w v" "t t g";height:auto;row-gap:2px;padding:6px 12px}
 .c-strength{grid-area:s}.c-when{grid-area:w}.c-ver{grid-area:v}.c-title{grid-area:t;white-space:normal}.c-tags{grid-area:g}
 .c-row.c-compact .c-tag.c-all{grid-area:v}
 .c-detail{grid-template-columns:1fr;padding:10px 12px 14px}
}
```

- [ ] **Step 3: Import stylů** – v `app/globals.css` za `@import "./trades.css";` přidej:

```css
@import "./calendar.css";
```

- [ ] **Step 4: Napoj v `app/tradee.tsx`**

Za řádek `import initial from '@/data/fundamentals.json';` přidej:

```tsx
import calendarAuto from '@/data/calendar.json';
import {mergeCalendar,type AutoEvent} from '@/lib/calendar';
```

Hned za řádek s `const rowsAll=…` (řádek 38) přidej:

```tsx
 const calendar=mergeCalendar(calendarAuto.events as AutoEvent[],data.events);
```

A v JSX nahraď `<CalendarPage events={data.events} now={now}/>` za:

```tsx
<CalendarPage events={calendar} now={now} flags={flags} generatedAt={calendarAuto.generatedAt}/>
```

- [ ] **Step 5: Typová kontrola a build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: bez chyb TypeScriptu, na konci `Build complete.`

- [ ] **Step 6: Ruční kontrola v prohlížeči**

Run: `npm run dev`, otevři Kalendář (`#calendar` / položka v navigaci) a ověř:
1. Okno 1440×900: viditelných **≥ 20 řádků** (počítej i oddělovače dnů jako ne-řádky).
2. Pořadí ve řádku: síla → čas+odpočet → název → štítky → ✓/○.
3. Klik na řádek rozbalí detail se třemi sloupci; Enter na zaměřeném řádku taky.
4. Vypni všechny Skupiny → hláška „Filtrům neodpovídá žádná událost“ + tlačítko „Zrušit filtry“, které vše vrátí.
5. Události VŠE (FOMC, CPI, NFP) zůstanou vidět i při vypnutých skupinách, když je zapnuté „vždy ukázat VŠE“.
6. Reload stránky zachová filtry; v anonymním okně stránka naběhne s výchozími.
7. Šířka 390 px: žádný vodorovný scroll, filtry za tlačítkem „Filtry“, řádek na dvě linky.

- [ ] **Step 7: Commit**

```bash
git add app/calendar.tsx app/calendar.css app/globals.css app/tradee.tsx
git commit -m "Kalendář: nová stránka – hustá tabulka, filtry, detail události

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Widget na dashboardu

**Files:**
- Modify: `app/dashboard.tsx:8,24-25,54`
- Modify: `app/tradee.tsx:41` (prop)

**Interfaces:**
- Consumes: `EventRow` z `app/calendar.tsx`; `upcomingCalendar`, `flaggedMarkets`, `CalendarEvent` z `lib/calendar.ts`; `calendar` proměnná z Task 5 v `tradee.tsx`.

- [ ] **Step 1: Uprav importy v `app/dashboard.tsx`**

Z importu `@/lib/dashboard` odstraň `upcomingEvents,importanceLabel,` a přidej nové importy:

```tsx
import {EventRow} from './calendar';
import {upcomingCalendar,flaggedMarkets,type CalendarEvent} from '@/lib/calendar';
```

- [ ] **Step 2: Prop a data** – do props `Dashboard` přidej `calendar:CalendarEvent[]` (typ i destrukturalizaci) a v řádku s `health=…` nahraď `events=upcomingEvents(data,now,5)` za:

```tsx
events=upcomingCalendar(calendar,now,5),mine=flaggedMarkets(flags)
```

- [ ] **Step 3: Vykreslení** – v kartě „Kalendář“ nahraď celý obsah `<div className="t-list">…</div>` za:

```tsx
<div className="c-list c-compact">{events.length?events.map(e=><EventRow key={e.id} e={e} now={now} mine={mine} compact/>):<div className="t-empty">Žádné nadcházející události.</div>}</div>
```

- [ ] **Step 4: Předej prop v `app/tradee.tsx`** – do `<Dashboard … />` přidej `calendar={calendar}`.

- [ ] **Step 5: Build a kontrola**

Run: `npx tsc --noEmit -p . && node --experimental-strip-types scripts/check-dashboard.mjs && npm run build`
Expected: bez chyb, `CHECK OK`, `Build complete.`; v prohlížeči dashboard ukazuje 5 řádků se silou ≥ střední nebo VŠE.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard.tsx app/tradee.tsx
git commit -m "Kalendář: widget na dashboardu ze sloučených událostí

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pravidla pro agenta a dokumentace

**Files:**
- Modify: `FUNDAMENTALS.md` (za odstavec začínající „Aktualizuj data/fundamentals.json…“)
- Modify: `README.md` (sekce „Hlavní soubory“)

- [ ] **Step 1: Do `FUNDAMENTALS.md` přidej sekci**

```markdown
## Kalendář událostí

Kostru kalendáře generuje `scripts/refresh_calendar.py` do `data/calendar.json` (BLS, BEA, Fed, ECB, svátky NYSE, EIA, Baker Hughes, expirace opcí). Tento soubor ručně neupravuj.

Do `data/fundamentals.json → events` zapisuj jen to, co přidává hodnotu:
- **doplnění** události ze skriptu – použij její `id` z `calendar.json` (např. `us-cpi-2026-10-14`) a vyplň `signal`, `watch`, `consensus`, `previous`, `actual`, `verifiedAt`, případně přesný čas (`at`, `timeKnown:true`) z oficiálního zdroje;
- **nové události**, které skript neumí: krypto (upgrady sítí, SEC/ETF, velké unlocky – jen BTC/ETH/SOL), komodity (OPEC+, zlato), výsledky sledovaných a velkých technologických firem, politika (volby, G7/G20, cla), projevy guvernérů a zápisy ze zasedání, ostatní centrální banky a statistiky mimo USA, dokud je nepokrývá skript. ID ve tvaru `{kind}-{YYYY-MM-DD}`.

Pole události: `id, at (ISO UTC), timeKnown, title („Země • co“, česky), category (macro | central-bank | exchange | commodity | crypto | equity | politics), markets (USD EUR GBP JPY CHF AUD NZD CAD BTC ETH SOL OIL GOLD GAS INDEX nebo ticker), kind, signal, global, source (URL oficiálního zdroje), watch, consensus, previous, actual, verifiedAt`.

**Síla `signal`:** 3 = sazby centrálních bank G8, NFP/CPI/HDP/PCE USA, CPI a HDP velkých ekonomik, OPEC+, výsledky Nvidia/Apple/Microsoft; 2 = PMI, maloobchod, PPI, JOLTS, obchodní bilance, zásoby ropy, projevy guvernérů, výsledky ostatních sledovaných firem; 1 = ostatní.

**Štítek VŠE (`global:true`):** automaticky FOMC, NFP USA, CPI USA, HDP USA, sazby ECB, OPEC+. Ručně jen pro mimořádné události s dopadem na všechny trhy (válka, volby v USA, plošná cla) a vždy s odůvodněním ve `watch`.

Nevyplňuj neověřený konsensus ani výsledek; neznámé = `null`.
```

- [ ] **Step 2: Do `README.md`** do seznamu „Hlavní soubory“ přidej:

```markdown
- `app/calendar.tsx` + `lib/calendar.ts` — kalendář událostí (sloučení skriptu a agenta, filtry).
- `scripts/refresh_calendar.py` — kostra kalendáře z oficiálních zdrojů do `data/calendar.json`; testy `python3 -m unittest discover -s scripts/tests`.
```

- [ ] **Step 3: Commit**

```bash
git add FUNDAMENTALS.md README.md
git commit -m "Kalendář: pravidla pro agenta (síla, VŠE, ID) a dokumentace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Ověření celé větve a PR

- [ ] **Step 1: Všechny kontroly**

Run:
```bash
python3 -m unittest discover -s scripts/tests -v
node --experimental-strip-types scripts/check-calendar.mjs
node --experimental-strip-types scripts/check-dashboard.mjs
npx tsc --noEmit -p .
npm run lint
npm run build
```
Expected: unittest `OK`, oba checky `CHECK OK`, tsc a lint bez chyb, `Build complete.`

- [ ] **Step 2: Push větve a PR** (až po souhlasu uživatele – repo je veřejné a Jindřichovo)

```bash
git push -u origin feature/kalendar
gh pr create --repo JindrichKrizek696/Tradee.ai --base main --head feature/kalendar \
  --title "Kalendář událostí: hustá tabulka, filtry, automatická kostra z oficiálních zdrojů" \
  --body "Spec: docs/superpowers/specs/2026-10-02-kalendar-udalosti-design.md · Plán: docs/superpowers/plans/2026-10-02-kalendar-udalosti.md

Pozor na změny ve FUNDAMENTALS.md – nová pravidla pro agenta (ID ze skriptu, síla, VŠE).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Nasazení na VPS** (až po merge do `main`)

```bash
ssh ubuntu@130.61.122.142 'cd ~/tradee && git pull && python3 scripts/refresh_calendar.py && source ~/.nvm/nvm.sh && nvm use 22 && npm run build && sudo systemctl restart tradee'
```
Expected: `kalendář ok: …`, `Build complete.`; `https://tradee.dejny.eu` → Kalendář ukazuje nové řádky.
