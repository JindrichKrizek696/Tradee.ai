"""Public market observations. No credentials. Failed providers keep prior dates."""
import json, urllib.request, xml.etree.ElementTree as ET, datetime as dt, statistics, math, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PAIRS=['EUR/USD','AUD/USD','NZD/USD','USD/CAD','USD/JPY','EUR/AUD','EUR/NZD','EUR/CAD','EUR/JPY','AUD/NZD','AUD/CAD','AUD/JPY','NZD/CAD','NZD/JPY','CAD/JPY']
CC=['USD','EUR','NZD','AUD','CAD','JPY']
def get(url):
 with urllib.request.urlopen(url,timeout=40) as r:return r.read()
def run():
 p=ROOT/'data/fundamentals.json';d=json.loads(p.read_text());now=dt.datetime.now(dt.timezone.utc);stamp=now.isoformat();today=now.date();out=d.setdefault('pairObservations',{});failures=[]
 def put(pair,key,value,period,url,note):out.setdefault(pair,{})[key]=dict(value=value,period=period,checkedAt=stamp,sourceUrl=url,note=note)
 url='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
 try:
  xml=get(url);points=[]
  for cube in ET.fromstring(xml).iter():
   if 'time' not in cube.attrib:continue
   day=dt.date.fromisoformat(cube.attrib['time']);rates={'EUR':1.0,**{x.attrib['currency']:float(x.attrib['rate']) for x in cube}}
   if day<=today and all(c in rates and rates[c]>0 and math.isfinite(rates[c]) for c in CC):points.append((day,rates))
  points.sort();assert len(points)>2500,'Nedostatečná cenová historie';assert (today-points[-1][0]).days<=7,'Zastaralá cenová řada'
  for instrument in PAIRS+[b+'/'+a for a,b in (p.split('/') for p in PAIRS)]+CC:
   base,*quote=instrument.split('/');others=quote or [c for c in CC if c!=base]
   # Units of comparison per one base; geometric equal-weight basket for indices.
   series=[(day,math.exp(sum(math.log(r[c]/r[base]) for c in others)/len(others))) for day,r in points]
   last=series[-1][1];s50=statistics.mean(v for _,v in series[-50:]);s200=statistics.mean(v for _,v in series[-200:]);direction='Bullish' if last>s50>s200 else 'Bearish' if last<s50<s200 else 'Smíšený'
   put(instrument,'trend',f'{direction} · reference {last:.5f} · SMA50 {s50:.5f} · SMA200 {s200:.5f}',str(series[-1][0]),url,'Denní referenční kurzy ECB, nikoli závěrečné obchodovatelné ceny. Index = geometrický průměr kurzů vůči pěti ostatním měnám. SMA používá posledních 50/200 dostupných dnů.')
   end={}
   for day,v in series:end[(day.year,day.month)]=v
   returns=[]
   for y in range(today.year-10,today.year):
    m=today.month;prev=(y,m-1) if m>1 else (y-1,12)
    if (y,m) in end and prev in end:returns.append((end[(y,m)]/end[prev]-1)*100)
   if len(returns)==10:
    mean=statistics.mean(returns);sd=statistics.stdev(returns);wins=sum(v>0 for v in returns)
    put(instrument,'seasonality',f'Měsíc {today.month}: průměr {mean:+.2f} % · růst {wins}/10 let · odchylka {sd:.2f} p. b.',f'{today.year-10}–{today.year-1}',url,'Výnos od poslední reference předchozího měsíce do poslední reference daného měsíce. Pouze dokončené minulé roky; četnost není předpověď ani pravděpodobnost budoucího zisku.')
  print('ECB: trend + seasonality,',len(out),'instruments')
 except Exception as e:failures.append('ECB: '+str(e))
 # TFF values: fixed official report layout. Never guess a contract or category.
 url='https://www.cftc.gov/dea/futures/financial_lf.htm'
 try:
  raw=get(url).decode();text=re.sub('<[^>]+>',' ',raw);date_match=re.search(r'Positions as of\s+([A-Za-z]+ \d+, \d{4})',text);assert date_match,'Missing report date'
  period=dt.datetime.strptime(date_match[1],'%B %d, %Y').date();assert 0<=(today-period).days<=14,'Old report'
  for c,code in {'CAD':'090741','JPY':'097741','EUR':'099741','AUD':'232741','USD':'098662','NZD':'112741'}.items():
   match=re.search(r'CFTC Code #'+code+r'.*?Positions\s+([\d,\s]+)\s+Changes',text,re.S)
   if not match:failures.append('CFTC: contract '+c+' absent');continue
   nums=[int(x.replace(',','')) for x in re.findall(r'\d[\d,]*',match[1])];assert len(nums)==14,'Unexpected COT layout'
   long,short=nums[6:8];d['observations'][c]['cot']=dict(value=f'Leveraged funds: long {long:,} / short {short:,} · netto {long-short:+,} kontraktů',period=str(period),checkedAt=stamp,sourceUrl=url,note=f'CFTC TFF futures only, kontrakt {code}. '+('USD Index futures; odlišný měnový koš.' if c=='USD' else 'Měnový futures kontrakt.'))
  print('CFTC parsed')
 except Exception as e:failures.append('CFTC: '+str(e))
 d['marketRefresh']={'attemptedAt':stamp,'issues':failures};p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps(failures,ensure_ascii=False))
if __name__=='__main__':run()
