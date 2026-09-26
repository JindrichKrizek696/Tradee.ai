"""Public Legacy COT and daily market history. Failed refreshes preserve old timestamps."""
import json,datetime as dt,urllib.request,urllib.parse,math,statistics as st,calendar,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CODES={'CAD':'090741','JPY':'097741','EUR':'099741','AUD':'232741','USD':'098662','NZD':'112741','GBP':'096742','CHF':'092741'}
ASSETS={'BTC-USD':'Bitcoin','ETH-USD':'Ethereum','SOL-USD':'Solana','^NDX':'Nasdaq 100','^GSPC':'S&P 500','AAPL':'Apple','MSFT':'Microsoft','NVDA':'NVIDIA','AMZN':'Amazon','GOOGL':'Alphabet','META':'Meta','TSLA':'Tesla','BRK-B':'Berkshire Hathaway','JPM':'JPMorgan Chase','AVGO':'Broadcom'}
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 Tradee.ai Research'}),timeout=40) as r:return json.load(r)
def run():
 now=dt.datetime.now(dt.timezone.utc);today=now.date();stamp=now.isoformat();issues=[]
 p=ROOT/'data/expanded-market.json';d=json.loads(p.read_text()) if p.exists() else {'legacy':{},'prices':{}}
 try:
  url='https://publicreporting.cftc.gov/resource/6dca-aqww.json?'+urllib.parse.urlencode({'$where':"cftc_contract_market_code in ("+','.join("'"+x+"'" for x in CODES.values())+")",'$order':'report_date_as_yyyy_mm_dd DESC','$limit':'480'})
  rows=get(url)
  for cc,code in CODES.items():
   rr=sorted([r for r in rows if r['cftc_contract_market_code']==code],key=lambda r:r['report_date_as_yyyy_mm_dd']);assert len(rr)>=26
   history=[]
   for r in rr:
    groups={}
    for name,a,b,c in [('commercial','comm_positions_long_all','comm_positions_short_all',None),('noncommercial','noncomm_positions_long_all','noncomm_positions_short_all','noncomm_postions_spread_all'),('nonreportable','nonrept_positions_long_all','nonrept_positions_short_all',None)]:
     l,s=int(r[a]),int(r[b]);groups[name]={'long':l,'short':s,'spread':int(r[c]) if c else 0,'net':l-s}
    history.append({'date':r['report_date_as_yyyy_mm_dd'][:10],'openInterest':int(r['open_interest_all']),'groups':groups})
   assert 0<=(today-dt.date.fromisoformat(history[-1]['date'])).days<=14
   d['legacy'][cc]={'contract':rr[-1]['contract_market_name'],'code':code,'isProxy':cc=='USD','sourceUrl':'https://publicreporting.cftc.gov/d/6dca-aqww','checkedAt':stamp,'history':history[-56:]}
  print('Legacy:',len(d['legacy']),flush=True)
 except Exception as e:issues.append('Legacy COT: '+str(e))
 def price(symbol):
  url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(symbol)+'?range=15y&interval=1d'
  raw=get(url)['chart']['result'][0];adj=raw['indicators'].get('adjclose',[{}])[0].get('adjclose',raw['indicators']['quote'][0]['close']);tz=dt.timezone(dt.timedelta(seconds=raw['meta']['gmtoffset']))
  series=[(dt.datetime.fromtimestamp(t,tz).date(),math.log(v)) for t,v in zip(raw['timestamp'],adj) if v and v>0 and dt.datetime.fromtimestamp(t,tz).date()<today];assert len(series)>=200
  assert 0<=(today-series[-1][0]).days<=7,'stale close'
  g50=st.mean(v for _,v in series[-50:]);g200=st.mean(v for _,v in series[-200:]);last=series[-1][1];months={}
  for m in range(1,13):
   years=[]
   for y in range(today.year-10,today.year):
    start=dt.date(y,m,1);before=[v for day,v in series if day<start];values={day.day:v for day,v in series if day.year==y and day.month==m}
    if not before or not values:continue
    prior=before[-1];v=prior;path=[]
    for day in range(1,32):v=values.get(day,v);path.append(round((v-prior)*100,5))
    years.append({'year':y,'path':path,'logReturn':path[-1]})
   months[str(m)]={'years':years}
  prior=[v for day,v in series if day<today.replace(day=1)][-1];values={day.day:v for day,v in series if day.year==today.year and day.month==today.month};v=prior;current=[]
  for day in range(1,series[-1][0].day+1):v=values.get(day,v);current.append(round((v-prior)*100,5))
  return symbol,{'asOf':str(series[-1][0]),'checkedAt':stamp,'sourceUrl':'https://finance.yahoo.com/quote/'+urllib.parse.quote(symbol)+'/history/','reference':round(math.exp(last),6),'gma50':round(math.exp(g50),6),'gma200':round(math.exp(g200),6),'trend':sum(1 if a>b else -1 if a<b else 0 for a,b in [(last,g50),(last,g200),(g50,g200)])/3,'months':months,'currentMonth':today.month,'currentYear':today.year,'currentPath':current,'trendPath':[{'date':str(series[i][0]),'value':sum(1 if a>b else -1 if a<b else 0 for a,b in [(series[i][1],st.mean(v for _,v in series[i-49:i+1])),(series[i][1],st.mean(v for _,v in series[i-199:i+1])),(st.mean(v for _,v in series[i-49:i+1]),st.mean(v for _,v in series[i-199:i+1]))])/3} for i in range(max(199,len(series)-60),len(series))],'pricePath':[{'date':str(day),'value':round(math.exp(v),6)} for day,v in series[-200:]]}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  jobs={pool.submit(price,s):s for s in ASSETS}
  for job in concurrent.futures.as_completed(jobs):
   try:s,v=job.result();d['prices'][s]=v;print(s,v['asOf'],flush=True)
   except Exception as e:issues.append(jobs[job]+': '+str(e))
 d['refresh']={'attemptedAt':stamp,'issues':issues};p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');print(issues)
if __name__=='__main__':run()
