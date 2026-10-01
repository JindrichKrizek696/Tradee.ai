#!/usr/bin/env python3
"""Kostra kalendáře z oficiálních zdrojů -> data/calendar.json. Spouští scripts/refresh-vps.sh (cron 4 h).
Každý zdroj má vlastní parser; spadlý zdroj nechá svoje události z minulého běhu a ok:false."""
import calendar as cal
import html
import json
import os
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
            # Částečně rozbitý zdroj (změněný název vydání, jiné HTML): typy, které minule měly budoucí
            # události a teď chybí, převezmeme z minulého běhu a zapíšeme varování.
            kinds = {e['kind'] for e in got}
            lost = [x for x in prev_events if x.get('origin') == name and x['kind'] not in kinds and parse_utc(x['at']) >= now]
            missing = sorted({x['kind'] for x in lost})
            events += got + lost
            sources[name] = {'ok': True, 'lastSuccess': utc_iso(now), 'url': url,
                             'error': f"chybí typy: {', '.join(missing)} (ponechána minulá data)" if missing else None}
            if missing:
                print(f"!! kalendář: zdroj {name} – chybí typy {', '.join(missing)}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 – jeden spadlý zdroj nesmí shodit ostatní
            events += [x for x in prev_events if x.get('origin') == name]
            sources[name] = {'ok': False, 'lastSuccess': prev_sources.get(name, {}).get('lastSuccess'), 'url': url, 'error': f'{type(e).__name__}: {e}'[:300]}
            print(f'!! kalendář: zdroj {name} selhal: {e}', file=sys.stderr)
    holidays = {parse_utc(x['at']).astimezone(ET).date() for x in events if x.get('kind') == 'nyse-holiday'}
    events += computed(now.astimezone(ET).date(), holidays)
    start, end = now - timedelta(days=PAST_DAYS), now + timedelta(days=HORIZON_DAYS)
    unique = {e['id']: e for e in events if start <= parse_utc(e['at']) <= end}
    return {'generatedAt': utc_iso(now), 'sources': sources, 'events': sorted(unique.values(), key=lambda e: (e['at'], e['id']))}


def load_previous(path):
    """Minulý běh; poškozený nebo chybějící soubor nesmí zastavit další obnovu."""
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def write_atomic(path, data):
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def main():
    data = build(load_previous(OUT), fetch, datetime.now(timezone.utc))
    write_atomic(OUT, data)
    status = ', '.join(f"{k}={'ok' if v['ok'] else 'CHYBA'}" for k, v in data['sources'].items())
    print(f"kalendář ok: {len(data['events'])} událostí · {status}")
    return 0


if __name__ == '__main__':
    sys.exit(main())

