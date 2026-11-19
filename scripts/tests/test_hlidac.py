"""Testy rozhodovací logiky hlídače (scripts/hlidac.py) – bez sítě, bez systemctl."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hlidac  # noqa: E402

NOW = datetime(2026, 11, 19, 17, 0, tzinfo=timezone.utc)


def ts(delta_h):
    return (NOW - timedelta(hours=delta_h)).strftime('%Y-%m-%dT%H:%M:%SZ')


def test_agent_ok_recent():
    log = f'{ts(30)} · 4 s · git pull selhal · x · -\n{ts(2)} · 265 s · ok · ok: 1 měn se změnou · 7cba03a\n'
    assert hlidac.check_agent(log, NOW) == []


def test_agent_failed_and_stale():
    log = f'{ts(20)} · 55 s · claude selhal · Failed to authenticate · -\n'
    out = hlidac.check_agent(log, NOW)
    assert len(out) == 2 and 'claude selhal' in out[0] and 'neběžel 20 h' in out[1]


def test_agent_manual_line_counts_as_ok():
    log = f'{ts(1)} · ruční nasazení (checkedAt opraveno) · ok · ok: 7 měn · 66761d8\n'
    assert hlidac.check_agent(log, NOW) == []


def test_agent_rejected_is_problem():
    log = f'{ts(1)} · 1556 s · odmítnuto: checkedAt je v budoucnosti · - · -\n'
    assert any('odmítnuto' in p for p in hlidac.check_agent(log, NOW))


def test_fundamentals_null_factor_and_age():
    data = {'currencies': {'NZD': {'factors': {'decision': {'value': 0}, 'labor': {'value': None}}},
                           'USD': {'factors': {'decision': {'value': 1}}}}}
    out = hlidac.check_fundamentals(data, NOW - timedelta(hours=40), NOW)
    assert any('40 h starý' in p for p in out)
    assert any(p.startswith('NZD: prázdné faktory labor') for p in out)
    assert not any(p.startswith('USD') for p in out)


def test_refresh_markers():
    refresh = f'== {ts(6).replace("Z", "+00:00")} refresh start\nECB structured\n== {ts(1).replace("Z", "+00:00")} refresh start\n'
    live = f'== {ts(0.25).replace("Z", "+00:00")} live\nlive ok\n'
    assert hlidac.check_refresh(refresh, live, NOW) == []
    assert hlidac.check_refresh(refresh, f'== {ts(2).replace("Z", "+00:00")} live\n', NOW) == ['refresh-live.sh neběžel 2 h (každých 15 min)']


def test_decide_sends_once_then_repeats_after_24h():
    kind, st = hlidac.decide(['a'], {}, NOW)
    assert kind == 'problem'
    kind, st = hlidac.decide(['a'], st, NOW + timedelta(hours=1))
    assert kind is None
    kind, st = hlidac.decide(['a', 'b'], st, NOW + timedelta(hours=2))  # jiná sada → znovu
    assert kind == 'problem'
    kind, st = hlidac.decide(['a', 'b'], st, NOW + timedelta(hours=27))  # po 24 h znovu
    assert kind == 'problem'
    kind, st = hlidac.decide([], st, NOW + timedelta(hours=28))  # uzdravení
    assert kind == 'ok'
    kind, st = hlidac.decide([], st, NOW + timedelta(hours=29))  # trvalé OK → ticho
    assert kind is None
