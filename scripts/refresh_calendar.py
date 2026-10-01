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

