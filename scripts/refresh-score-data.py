"""Structured public observations for score-v2; failures retain original timestamps."""
import json, math, statistics as st, datetime as dt, calendar, urllib.request, urllib.parse, xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CC=['USD','EUR','NZD','AUD','CAD','JPY','GBP','CHF']
CODES={'CAD':'090741','JPY':'097741','EUR':'099741','AUD':'232741','USD':'098662','NZD':'112741','GBP':'096742','CHF':'092741'}
ECB='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
CFTC='https://publicreporting.cftc.gov/resource/gpe5-46if.json'
def get(url):
 with urllib.request.urlopen(url,timeout=45) as r:return r.read()
def run():
 p=ROOT/'data/score-market.json';data=json.loads(p.read_text()) if p.exists() else {'prices':{},'cot':{}}
 now=dt.datetime.now(dt.timezone.utc);today=now.date();stamp=now.isoformat();issues=[]
 try:
  points=[]
  for cube in ET.fromstring(get(ECB)).iter():
   if 'time' not in cube.attrib:continue
   day=dt.date.fromisoformat(cube.attrib['time']);r={'EUR':1.,**{c.attrib['currency']:float(c.attrib['rate']) for c in cube}}
   if day<=today and all(c in r and math.isfinite(r[c]) and r[c]>0 for c in CC):points.append((day,r))
  points.sort();assert len(points)>2500 and 0<=(today-points[-1][0]).days<=7,'ECB history missing or stale'
  prices={}
  for instrument in [a+'/'+b for a in CC for b in CC if a!=b]+CC:
   base,*quote=instrument.split('/');others=quote or [c for c in CC if c!=base]
   series=[(day,sum(math.log(r[c]/r[base]) for c in others)/len(others)) for day,r in points]
   last=series[-1][1];g50=st.mean(v for _,v in series[-50:]);g200=st.mean(v for _,v in series[-200:])
   months={}
   for m in range(1,13):
    years=[]
    for y in range(today.year-10,today.year):
     start=dt.date(y,m,1);n=calendar.monthrange(y,m)[1];before=[v for day,v in series if day<start];vals={day.day:v for day,v in series if day.year==y and day.month==m}
     if not before or not vals:continue
     prior=before[-1];v=prior;path=[]
     for day in range(1,32):
      v=vals.get(day,v);path.append(round((v-prior)*100,5))
     years.append({'year':y,'path':path,'logReturn':path[-1]})
    months[str(m)]={'years':years}
   start=today.replace(day=1);prior=[v for day,v in series if day<start][-1];current=[];vals={day.day:v for day,v in series if day.year==today.year and day.month==today.month};v=prior
   for day in range(1,series[-1][0].day+1 if series[-1][0]>=start else 1):
    v=vals.get(day,v);current.append(round((v-prior)*100,5))
   prices[instrument]={'asOf':str(series[-1][0]),'checkedAt':stamp,'sourceUrl':ECB,'reference':round(math.exp(last),6),'gma50':round(math.exp(g50),6),'gma200':round(math.exp(g200),6),'trend':sum(1 if a>b else -1 if a<b else 0 for a,b in [(last,g50),(last,g200),(g50,g200)])/3,'months':months,'currentMonth':today.month,'currentYear':today.year,'currentPath':current,'trendPath':[{'date':str(series[i][0]),'value':sum(1 if a>b else -1 if a<b else 0 for a,b in [(series[i][1],st.mean(v for _,v in series[i-49:i+1])),(series[i][1],st.mean(v for _,v in series[i-199:i+1])),(st.mean(v for _,v in series[i-49:i+1]),st.mean(v for _,v in series[i-199:i+1]))])/3} for i in range(max(199,len(series)-60),len(series))],'pricePath':[{'date':str(day),'value':round(math.exp(v),6)} for day,v in series[-200:]]}
  data['prices']=prices;print('ECB structured:',len(prices),'instruments')
 except Exception as e:issues.append('ECB: '+str(e))
 try:
  query={'$where':"cftc_contract_market_code in ('090741','097741','099741','232741','098662','112741','096742','092741')",'$order':'report_date_as_yyyy_mm_dd DESC','$limit':'480'}
  url=CFTC+'?'+urllib.parse.urlencode(query);rows=json.loads(get(url));assert isinstance(rows,list) and rows,'No CFTC rows'
  groups={'leveraged':('lev_money_positions_long','lev_money_positions_short','lev_money_positions_spread'),'assetManagers':('asset_mgr_positions_long','asset_mgr_positions_short','asset_mgr_positions_spread'),'dealers':('dealer_positions_long_all','dealer_positions_short_all','dealer_positions_spread_all'),'other':('other_rept_positions_long','other_rept_positions_short','other_rept_positions_spread'),'nonreportable':('nonrept_positions_long_all','nonrept_positions_short_all',None)}
  for currency,code in CODES.items():
   rr=sorted([r for r in rows if r['cftc_contract_market_code']==code],key=lambda r:r['report_date_as_yyyy_mm_dd'])
   if not rr:issues.append('CFTC: missing '+currency);continue
   history=[]
   for r in rr:
    day=r['report_date_as_yyyy_mm_dd'][:10]
    if dt.date.fromisoformat(day)>today:continue
    oi=int(r['open_interest_all']);assert oi>0
    parsed={}
    for name,(a,b,c) in groups.items():
     l,s,sp=int(r[a]),int(r[b]),int(r[c]) if c else 0;assert min(l,s,sp)>=0
     parsed[name]={'long':l,'short':s,'spread':sp,'net':l-s}
    history.append({'date':day,'openInterest':oi,'groups':parsed})
   assert len(history)>=5,'Insufficient CFTC history';assert 0<=(today-dt.date.fromisoformat(history[-1]['date'])).days<=14,'CFTC stale source'
   data['cot'][currency]={'contract':rr[-1]['contract_market_name'],'code':code,'isProxy':currency=='USD','sourceUrl':'https://publicreporting.cftc.gov/stories/s/TFF-Futures-Only/98ig-3k9y/','apiUrl':url,'checkedAt':stamp,'history':history[-56:]}
  print('CFTC structured:',len(data['cot']),'contracts')
 except Exception as e:issues.append('CFTC: '+str(e))
 data['refresh']={'attemptedAt':stamp,'issues':issues};p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n');print(json.dumps(issues,ensure_ascii=False))
if __name__=='__main__':run()
