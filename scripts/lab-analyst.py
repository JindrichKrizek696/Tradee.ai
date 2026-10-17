#!/usr/bin/env python3
"""Laboratoř · týdenní AI analytik agentů (jen vlastník). Neděle 18:30 Europe/Prague, po souhrnu (18:00) a evoluci (18:15).

1) scripts/lab-agents-report.mjs vytvoří markdown report do pracovní složky (statistiky agentů, nejlepší/nejhorší obchody s „proč“,
   evoluce, sweep, známé strategie, varianty A–D/S, otevřené pozice).
2) Claude Code (`claude -p`, stejný vzor jako scripts/fundamentals_agent.py) smí JEN ČÍST tento jeden soubor – žádný Bash, Write,
   Edit, web ani jiné cesty; --permission-mode dontAsk, --output-format json. Vrátí markdown.
3) scripts/lab-analyst-save.mjs uloží odpověď jako poznámku „Týdenní analýza agentů <datum>“, obnoví „Shrnutí pro AI“
   a pošle vlastníkovi krátký mail „Analýza týdne“ s verdiktem. Analytik NIC nemění (agenty, pravidla ani data).

Cron (UTC; skript sám pustí jen běh, kdy je v Praze 18 h):
  30 16,17 * * 0 cd ~/tradee && bash scripts/lab-analyst.sh >> ~/logs/lab-analyst.log 2>&1
python3 scripts/lab-analyst.py [--dry] [--force]   (--dry = report + odpověď se vypíše, nic se neuloží ani nepošle)
"""
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
NODE = ['node', '--experimental-strip-types']
PROMPT = ('Jsi analytik papírového obchodování v Tradee Laboratoři. Přečti jediný soubor report.md v této složce '
          '(nic jiného nečti a nic neměň) a napiš česky markdown analýzu týdne pro vlastníka. Struktura: '
          'první řádek „**Verdikt:** …“ (1–2 věty, co tento týden platí); pak sekce ## Co funguje, ## Co nefunguje, '
          '## Proč (s odkazem na konkrétní obchody a jejich „proč“), ## Statistická opatrnost (velikost vzorků, < 30 obchodů je slabé, '
          '< 8 = agent se učí; srovnání s hranicí náhody a s variantou A; korelace mezi agenty se stejnými trhy), '
          '## Hypotézy na příští týden (konkrétní, ověřitelné), ## Mutace k vyzkoušení (které geny kterých agentů a proč – jen návrh). '
          'Nic sám neměníš, nespouštíš ani nedoporučuješ skutečné obchody. Odpověz jen tím markdownem, bez úvodu.')
# Jen čtení jednoho souboru ('//' = absolutní cesta); vše ostatní výslovně zakázané (stejná pojistka jako fundamentals_agent.py).
DENIED = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebSearch', 'WebFetch', 'Read(~/**)', 'Edit(~/**)', 'Read(//home/**)', 'Read(//etc/**)', 'Read(//root/**)']
KEEP_LOGS = 20


def allowed_tools(work):
    return [f'Read(/{work}/report.md)']


def claude_cmd(work):
    return [os.environ.get('TRADEE_CLAUDE_CMD', 'claude'), '-p', PROMPT, '--allowedTools', *allowed_tools(work),
            '--disallowedTools', *DENIED, '--permission-mode', 'dontAsk', '--add-dir', str(work), '--output-format', 'json']


def is_run_time(now=None):
    p = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo('Europe/Prague'))
    return p.weekday() == 6 and p.hour == 18


def parse_result(out):
    """Vrátí markdown z JSON výstupu `claude -p --output-format json`, nebo None (chyba / prázdné)."""
    try:
        j = json.loads(out)
    except (ValueError, TypeError):
        return None
    if j.get('is_error'):
        return None
    text = (j.get('result') or '').strip()
    return text if len(text) >= 40 else None


def sh(cmd, cwd, timeout=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=os.environ.copy())


def save_output(text):
    d = ROOT / 'logs' / 'lab-analyst'
    d.mkdir(parents=True, exist_ok=True)
    (d / f"claude-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}.json").write_text(text or '', encoding='utf-8')
    for old in sorted(d.glob('claude-*.json'))[:-KEEP_LOGS]:
        old.unlink()


def run(dry):
    work = ROOT / '.lab-analyst'
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    report = work / 'report.md'
    r = sh([*NODE, 'scripts/lab-agents-report.mjs', '--out', str(report)], ROOT, timeout=300)
    if r.returncode != 0 or not report.exists():
        return 'report selhal', (r.stderr or r.stdout).strip()[-200:]
    try:
        c = sh(claude_cmd(work), work, timeout=int(os.environ.get('TRADEE_ANALYST_TIMEOUT', '900')))
    except subprocess.TimeoutExpired:
        return 'timeout', '-'
    except OSError as e:
        return 'claude selhal', str(e)[:200]
    save_output(c.stdout or c.stderr)
    text = parse_result(c.stdout) if c.returncode == 0 else None
    if not text:
        return 'claude selhal', (c.stderr or c.stdout).strip()[-200:]
    answer = work / 'answer.md'
    answer.write_text(text, encoding='utf-8')
    if dry:
        print(text)
        return 'dry', f'{len(text)} znaků'
    s = sh([*NODE, 'scripts/lab-analyst-save.mjs', '--file', str(answer)], ROOT, timeout=120)
    if s.returncode != 0:
        return 'uložení selhalo', (s.stderr or s.stdout).strip()[-200:]
    return 'ok', s.stdout.strip()[-200:]


def main():
    args = sys.argv[1:]
    dry, force = '--dry' in args, '--force' in args
    if not dry and not force and not is_run_time():
        print('lab-analyst: v Praze není neděle 18 h – nic nedělám')
        return 0
    start = time.monotonic()
    started = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    try:
        res, detail = run(dry)
    except Exception as e:  # noqa: BLE001 – každý běh musí skončit řádkem v logu
        res, detail = 'chyba', f'{type(e).__name__}: {e}'[:200]
    print(f'{started} · {round(time.monotonic() - start)} s · {res} · {detail}')
    return 0 if res in ('ok', 'dry') else 1


if __name__ == '__main__':
    sys.exit(main())
