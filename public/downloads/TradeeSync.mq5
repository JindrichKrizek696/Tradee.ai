//+------------------------------------------------------------------+
//| TradeeSync.mq5 – automatický deník obchodů pro tradee.eu          |
//| Posílá každý deal, posun SL/TP, čekající pokyny a stav účtu.      |
//+------------------------------------------------------------------+
#property copyright "Tradee"
#property link      "https://tradee.eu"
#property version   "1.00"
#property description "Automatický deník obchodů pro tradee.eu"

input string TradeeKey   = "";                  // Klíč z tradee.eu → Propojení s MetaTraderem
input string AccountName = "";                  // Název účtu v Tradee (volitelné)
input string Endpoint    = "https://tradee.eu"; // Adresa Tradee

#define EA_VERSION "1.1.0"
#define MAX_BATCH  500
#define FLUSH_MS   2000
#define BARS_EVERY    300            // jak často (s) se ptát Tradee, ke kterým obchodům chybí svíčky
#define BARS_PER_POST 10

string   g_queue[];
ulong    g_firstQueued=0,g_nextTry=0;
int      g_backoff=2000;
bool     g_stopped=false;
bool     g_connected=false;          // spojení s brokerem a úvodní dorovnání proběhlo
long     g_login=0;                  // účet, ke kterému patří fronta a sledovaný stav
long     g_offset=0;                 // čas serveru brokera − UTC (s)
datetime g_lastSnap=0;
datetime g_lastBars=0;               // poslední dotaz na chybějící svíčky (TimeGMT)
// sledované otevřené pozice (podle POSITION_IDENTIFIER)
long     g_pos[];                    // POSITION_IDENTIFIER
ulong    g_tk[];                     // POSITION_TICKET (pro PositionSelectByTicket)
string   g_sym[];
double   g_sl[],g_tp[],g_mfeP[],g_maeP[],g_mfeM[],g_maeM[];
bool     g_out[];                    // od poslední kontroly přišel uzavírací deal (DEAL_ADD)
// pozice zavřené bez DEAL_ADD (offline), jejichž uzavírací deal v historii ještě není
long     g_pend[];
int      g_pendTry[];
ulong    g_pendNext=0;
// sledované čekající pokyny (kvůli rozlišení skutečné úpravy)
ulong    g_ord[];
string   g_ordSig[];

//--- JSON pomocníci
string Esc(string s){string o="";int n=StringLen(s);for(int i=0;i<n;i++){ushort c=StringGetCharacter(s,i);if(c=='"')o+="\\\"";else if(c=='\\')o+="\\\\";else if(c<32)o+=" ";else o+=ShortToString(c);}return o;}
string Q(string s){return "\""+Esc(s)+"\"";}
string N(double v){if(!MathIsValidNumber(v))return "0";string s=DoubleToString(v,8);if(StringFind(s,".")>=0){while(StringLen(s)>1&&StringGetCharacter(s,StringLen(s)-1)=='0')s=StringSubstr(s,0,StringLen(s)-1);if(StringGetCharacter(s,StringLen(s)-1)=='.')s=StringSubstr(s,0,StringLen(s)-1);}if(s=="-0")s="0";return s;}
string I(long v){return IntegerToString(v);}
string Cut(string s,int n){return StringLen(s)>n?StringSubstr(s,0,n):s;}
long   Utc(long serverMs){return serverMs-g_offset*1000;}
long   NowMs(){static long last=0;long t=(long)TimeGMT()*1000+(long)(GetTickCount64()%1000);if(t<=last)t=last+1;last=t;return t;}
string QueueFile(){return "TradeeSync\\"+I(g_login)+".queue";}

//--- fronta (přežije restart terminálu)
void SaveQueue(){if(g_login<=0)return;int h=FileOpen(QueueFile(),FILE_WRITE|FILE_TXT|FILE_ANSI,'\t',CP_UTF8);if(h==INVALID_HANDLE)return;for(int i=0;i<ArraySize(g_queue);i++)FileWriteString(h,g_queue[i]+"\n");FileClose(h);}
void LoadQueue(){ArrayResize(g_queue,0);g_firstQueued=0;if(g_login<=0)return;if(!FileIsExist(QueueFile()))return;int h=FileOpen(QueueFile(),FILE_READ|FILE_TXT|FILE_ANSI,'\t',CP_UTF8);if(h==INVALID_HANDLE)return;while(!FileIsEnding(h)){string l=FileReadString(h);if(StringLen(l)>2){int n=ArraySize(g_queue);ArrayResize(g_queue,n+1);g_queue[n]=l;}}FileClose(h);if(ArraySize(g_queue)>0)g_firstQueued=GetTickCount64();}
void Push(string ev){if(ev=="")return;int n=ArraySize(g_queue);ArrayResize(g_queue,n+1);g_queue[n]=ev;if(n==0)g_firstQueued=GetTickCount64();}
void Enqueue(string ev){if(ev=="")return;Push(ev);SaveQueue();}
void Drop(int n){int left=ArraySize(g_queue)-n;for(int i=0;i<left;i++)g_queue[i]=g_queue[i+n];ArrayResize(g_queue,MathMax(left,0));g_firstQueued=left>0?GetTickCount64():0;SaveQueue();}

//--- HTTP
string UrlEnc(string s){uchar b[];StringToCharArray(s,b,0,WHOLE_ARRAY,CP_UTF8);string o="";for(int i=0;i<ArraySize(b)-1;i++){uchar c=b[i];if((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='_'||c=='.')o+=CharToString(c);else o+=StringFormat("%%%02X",c);}return o;}
int Http(string method,string path,string body,string &resp){
   char data[],res[];string rh;
   if(body!=""){StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,ArraySize(data)-1);}
   string hdr="Content-Type: application/json\r\nAuthorization: Bearer "+TradeeKey+"\r\n";
   ResetLastError();
   int code=WebRequest(method,Endpoint+path,hdr,10000,data,res,rh);
   resp=CharArrayToString(res,0,WHOLE_ARRAY,CP_UTF8);
   if(code==-1){int err=GetLastError();if(err==4014)Comment("TradeeSync: povol adresu ",Endpoint," v Nástroje → Možnosti → Experti → Povolit WebRequest.");else Print("TradeeSync: WebRequest chyba ",err);}
   return code;
}
long JsonLong(string s,string key){int p=StringFind(s,"\""+key+"\":");if(p<0)return 0;p+=StringLen(key)+3;string num="";while(p<StringLen(s)){ushort c=StringGetCharacter(s,p);if((c>='0'&&c<='9')||c=='-')num+=ShortToString(c);else break;p++;}return StringToInteger(num);}
// pole řetězců "key":["a","b"] (tickety neobsahují uvozovky ani ])
int JsonStrArr(string s,string key,string &out[]){
   ArrayResize(out,0);
   int p=StringFind(s,"\""+key+"\":[");if(p<0)return 0;p+=StringLen(key)+4;
   int e=StringFind(s,"]",p);if(e<0)return 0;
   while(p<e){
      int a=StringFind(s,"\"",p);if(a<0||a>=e)break;
      int b=StringFind(s,"\"",a+1);if(b<0||b>e)break;
      int n=ArraySize(out);ArrayResize(out,n+1);out[n]=StringSubstr(s,a+1,b-a-1);p=b+1;
   }
   return ArraySize(out);
}

//--- účet a události
string AccountJson(){
   long mode=AccountInfoInteger(ACCOUNT_TRADE_MODE);
   return "{\"platform\":\"mt5\",\"login\":"+Q(I(g_login))+",\"server\":"+Q(Cut(AccountInfoString(ACCOUNT_SERVER),64))+",\"company\":"+Q(Cut(AccountInfoString(ACCOUNT_COMPANY),64))+",\"currency\":"+Q(Cut(AccountInfoString(ACCOUNT_CURRENCY),8))+",\"leverage\":"+I(AccountInfoInteger(ACCOUNT_LEVERAGE))+",\"mode\":"+Q(mode==ACCOUNT_TRADE_MODE_DEMO?"demo":mode==ACCOUNT_TRADE_MODE_CONTEST?"contest":"real")+",\"name\":"+Q(Cut(AccountName,60))+",\"ea\":"+Q(EA_VERSION)+"}";
}
string ReasonStr(long r){switch((int)r){case DEAL_REASON_CLIENT:return "client";case DEAL_REASON_MOBILE:return "mobile";case DEAL_REASON_WEB:return "web";case DEAL_REASON_EXPERT:return "expert";case DEAL_REASON_SL:return "sl";case DEAL_REASON_TP:return "tp";case DEAL_REASON_SO:return "so";case DEAL_REASON_ROLLOVER:return "rollover";case DEAL_REASON_VMARGIN:return "vmargin";case DEAL_REASON_SPLIT:return "split";}return "other";}
string DealJson(ulong t,bool live){
   if(!HistoryDealSelect(t))return "";
   string sym=HistoryDealGetString(t,DEAL_SYMBOL);
   long type=HistoryDealGetInteger(t,DEAL_TYPE),entry=HistoryDealGetInteger(t,DEAL_ENTRY);
   string dt=(type==DEAL_TYPE_BUY||type==DEAL_TYPE_SELL)?"trade":type==DEAL_TYPE_BALANCE?"balance":type==DEAL_TYPE_CREDIT?"credit":type==DEAL_TYPE_BONUS?"bonus":type==DEAL_TYPE_COMMISSION?"commission":"charge";
   string ent=entry==DEAL_ENTRY_IN?"in":entry==DEAL_ENTRY_OUT?"out":entry==DEAL_ENTRY_INOUT?"inout":"out_by";
   ulong ord=(ulong)HistoryDealGetInteger(t,DEAL_ORDER);double req=0;if(ord>0&&HistoryOrderSelect(ord))req=HistoryOrderGetDouble(ord,ORDER_PRICE_OPEN);
   long ts=Utc(HistoryDealGetInteger(t,DEAL_TIME_MSC));
   return "{\"id\":"+Q("d:"+I((long)t))+",\"type\":\"deal\",\"ts\":"+I(ts)+",\"deal\":"+Q(I((long)t))+",\"position\":"+Q(I(HistoryDealGetInteger(t,DEAL_POSITION_ID)))+",\"order\":"+Q(I((long)ord))
     +",\"symbol\":"+Q(Cut(sym,32))+",\"side\":"+Q(type==DEAL_TYPE_SELL?"sell":"buy")+",\"entry\":"+Q(ent)+",\"volume\":"+N(HistoryDealGetDouble(t,DEAL_VOLUME))+",\"price\":"+N(HistoryDealGetDouble(t,DEAL_PRICE))
     +",\"commission\":"+N(HistoryDealGetDouble(t,DEAL_COMMISSION))+",\"swap\":"+N(HistoryDealGetDouble(t,DEAL_SWAP))+",\"fee\":"+N(HistoryDealGetDouble(t,DEAL_FEE))+",\"profit\":"+N(HistoryDealGetDouble(t,DEAL_PROFIT))
     +",\"magic\":"+I(HistoryDealGetInteger(t,DEAL_MAGIC))+",\"comment\":"+Q(Cut(HistoryDealGetString(t,DEAL_COMMENT),64))+",\"reason\":"+Q(ReasonStr(HistoryDealGetInteger(t,DEAL_REASON)))+",\"dealType\":"+Q(dt)
     +",\"sl\":"+N(HistoryDealGetDouble(t,DEAL_SL))+",\"tp\":"+N(HistoryDealGetDouble(t,DEAL_TP))
     +",\"digits\":"+I(sym==""?0:SymbolInfoInteger(sym,SYMBOL_DIGITS))+",\"point\":"+N(sym==""?0:SymbolInfoDouble(sym,SYMBOL_POINT))+",\"tickSize\":"+N(sym==""?0:SymbolInfoDouble(sym,SYMBOL_TRADE_TICK_SIZE))+",\"tickValue\":"+N(sym==""?0:SymbolInfoDouble(sym,SYMBOL_TRADE_TICK_VALUE))
     +",\"spread\":"+I(live&&sym!=""?SymbolInfoInteger(sym,SYMBOL_SPREAD):0)+",\"priceRequested\":"+N(req)+",\"balance\":"+N(live?AccountInfoDouble(ACCOUNT_BALANCE):0)+"}";
}
string OrderTypeStr(ENUM_ORDER_TYPE t){switch(t){case ORDER_TYPE_BUY_LIMIT:return "buy_limit";case ORDER_TYPE_SELL_LIMIT:return "sell_limit";case ORDER_TYPE_BUY_STOP:return "buy_stop";case ORDER_TYPE_SELL_STOP:return "sell_stop";case ORDER_TYPE_BUY_STOP_LIMIT:return "buy_stop_limit";case ORDER_TYPE_SELL_STOP_LIMIT:return "sell_stop_limit";}return "";}
int OrdIdx(ulong o){for(int i=0;i<ArraySize(g_ord);i++)if(g_ord[i]==o)return i;return -1;}
string OrderJson(const MqlTradeTransaction &t){
   string ot=OrderTypeStr(t.order_type);if(ot=="")return "";   // jen čekající pokyny; tržní pokyny pokrývají dealy
   string sig=N(t.price)+"|"+N(t.price_sl)+"|"+N(t.price_tp)+"|"+N(t.volume),st="";
   int k=OrdIdx(t.order);
   switch(t.order_state){
      case ORDER_STATE_PLACED: if(k<0){st="placed";k=ArraySize(g_ord);ArrayResize(g_ord,k+1);ArrayResize(g_ordSig,k+1);g_ord[k]=t.order;g_ordSig[k]=sig;}else if(g_ordSig[k]!=sig){st="modified";g_ordSig[k]=sig;}break;
      case ORDER_STATE_CANCELED: st="canceled";break;
      case ORDER_STATE_EXPIRED: st="expired";break;
      case ORDER_STATE_FILLED: st="filled";break;
      case ORDER_STATE_REJECTED: st="rejected";break;
   }
   if(st=="")return "";
   if(st!="placed"&&st!="modified"&&k>=0){int last=ArraySize(g_ord)-1;g_ord[k]=g_ord[last];g_ordSig[k]=g_ordSig[last];ArrayResize(g_ord,last);ArrayResize(g_ordSig,last);}
   long ts=NowMs();
   return "{\"id\":"+Q("o:"+I((long)t.order)+":"+st+":"+I(ts))+",\"type\":\"order\",\"ts\":"+I(ts)+",\"order\":"+Q(I((long)t.order))+",\"position\":"+Q(I((long)t.position))+",\"symbol\":"+Q(Cut(t.symbol,32))+",\"orderType\":"+Q(ot)+",\"state\":"+Q(st)
     +",\"volume\":"+N(t.volume)+",\"priceOpen\":"+N(t.price)+",\"priceRequested\":"+N(t.price)+",\"sl\":"+N(t.price_sl)+",\"tp\":"+N(t.price_tp)+",\"expiration\":"+I(t.time_expiration>0?Utc((long)t.time_expiration*1000):0)+",\"comment\":\"\",\"magic\":0}";
}

//--- sledování pozic: SL/TP a MFE/MAE
int PosIdx(long p){for(int i=0;i<ArraySize(g_pos);i++)if(g_pos[i]==p)return i;return -1;}
void Resize(int n){ArrayResize(g_out,n);ArrayResize(g_pos,n);ArrayResize(g_tk,n);ArrayResize(g_sym,n);ArrayResize(g_sl,n);ArrayResize(g_tp,n);ArrayResize(g_mfeP,n);ArrayResize(g_maeP,n);ArrayResize(g_mfeM,n);ArrayResize(g_maeM,n);}
void AddPos(){int k=ArraySize(g_pos);Resize(k+1);g_out[k]=false;g_pos[k]=PositionGetInteger(POSITION_IDENTIFIER);g_tk[k]=(ulong)PositionGetInteger(POSITION_TICKET);g_sym[k]=PositionGetString(POSITION_SYMBOL);g_sl[k]=PositionGetDouble(POSITION_SL);g_tp[k]=PositionGetDouble(POSITION_TP);double pr=PositionGetDouble(POSITION_PRICE_CURRENT),m=PositionGetDouble(POSITION_PROFIT);g_mfeP[k]=pr;g_maeP[k]=pr;g_mfeM[k]=m;g_maeM[k]=m;}
void RemoveAt(int i){int l=ArraySize(g_pos)-1;g_out[i]=g_out[l];g_pos[i]=g_pos[l];g_tk[i]=g_tk[l];g_sym[i]=g_sym[l];g_sl[i]=g_sl[l];g_tp[i]=g_tp[l];g_mfeP[i]=g_mfeP[l];g_maeP[i]=g_maeP[l];g_mfeM[i]=g_mfeM[l];g_maeM[i]=g_maeM[l];Resize(l);}
// Všechny dealy pozice z historie do fronty – jen když už historie obsahuje uzavření (duplicity server zahodí).
bool PushPositionDeals(long pid){
   if(pid<=0||!HistorySelectByPosition(pid))return false;
   int n=HistoryDealsTotal();ulong tks[];ArrayResize(tks,n);bool closed=false;
   for(int i=0;i<n;i++){
      tks[i]=HistoryDealGetTicket(i);if(tks[i]==0)continue;
      long e=HistoryDealGetInteger(tks[i],DEAL_ENTRY);
      if(e==DEAL_ENTRY_OUT||e==DEAL_ENTRY_INOUT||e==DEAL_ENTRY_OUT_BY)closed=true;
   }
   if(!closed)return false;
   // tickety zkopírované předem: HistoryDealSelect v DealJson přepisuje výběr
   for(int i=0;i<n;i++)if(tks[i]>0)Push(DealJson(tks[i],false));
   return true;
}
void AddPending(long pid){for(int i=0;i<ArraySize(g_pend);i++)if(g_pend[i]==pid)return;int n=ArraySize(g_pend);ArrayResize(g_pend,n+1);ArrayResize(g_pendTry,n+1);g_pend[n]=pid;g_pendTry[n]=0;}
// pozice zmizela bez uzavíracího DEAL_ADD (zavřena offline / během výpadku) → dealy z historie, jinak zkusit později
void Vanished(long pid){if(PushPositionDeals(pid))SaveQueue();else AddPending(pid);}
void CheckPending(){
   if(ArraySize(g_pend)==0||GetTickCount64()<g_pendNext)return;
   g_pendNext=GetTickCount64()+10000;
   bool pushed=false;
   for(int i=ArraySize(g_pend)-1;i>=0;i--){
      bool done=PosIdx(g_pend[i])>=0;              // znovu otevřená v terminálu = není co dohledávat
      if(!done&&PushPositionDeals(g_pend[i])){done=true;pushed=true;}
      if(!done&&++g_pendTry[i]>=30){Print("TradeeSync: uzavření pozice ",g_pend[i]," se v historii nenašlo, vzdávám to");done=true;}
      if(done){int l=ArraySize(g_pend)-1;g_pend[i]=g_pend[l];g_pendTry[i]=g_pendTry[l];ArrayResize(g_pend,l);ArrayResize(g_pendTry,l);}
   }
   if(pushed)SaveQueue();
}
void TrackPositions(){
   int n=PositionsTotal();long cur[];ArrayResize(cur,n);
   for(int i=0;i<n;i++){ulong t=PositionGetTicket(i);cur[i]=t>0?PositionGetInteger(POSITION_IDENTIFIER):0;}
   for(int i=ArraySize(g_pos)-1;i>=0;i--){
      bool f=false;for(int j=0;j<n;j++)if(cur[j]==g_pos[i]){f=true;break;}
      if(f){g_out[i]=false;continue;}             // dílčí uzavření: pozice trvá, příznak zpět
      long pid=g_pos[i];bool seen=g_out[i];RemoveAt(i);
      if(!seen)Vanished(pid);
   }
   for(int j=0;j<n;j++)if(cur[j]>0&&PosIdx(cur[j])<0&&PositionSelectByTicket(PositionGetTicket(j)))AddPos();
}
string StateJson(int i,long ts,bool full){
   string side="buy";double vol=0,po=0,pc=0,sl=g_sl[i],tp=g_tp[i],pf=0,sw=0;long ots=0;
   if(full){side=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_SELL?"sell":"buy";vol=PositionGetDouble(POSITION_VOLUME);po=PositionGetDouble(POSITION_PRICE_OPEN);pc=PositionGetDouble(POSITION_PRICE_CURRENT);pf=PositionGetDouble(POSITION_PROFIT);sw=PositionGetDouble(POSITION_SWAP);ots=Utc(PositionGetInteger(POSITION_TIME_MSC));}
   return "\"position\":"+Q(I(g_pos[i]))+",\"symbol\":"+Q(Cut(g_sym[i],32))+",\"side\":"+Q(side)+",\"volume\":"+N(vol)+",\"priceOpen\":"+N(po)+",\"priceCurrent\":"+N(pc)+",\"sl\":"+N(sl)+",\"tp\":"+N(tp)+",\"profit\":"+N(pf)+",\"swap\":"+N(sw)
     +",\"mfePrice\":"+N(g_mfeP[i])+",\"maePrice\":"+N(g_maeP[i])+",\"mfeMoney\":"+N(g_mfeM[i])+",\"maeMoney\":"+N(g_maeM[i])+",\"spread\":"+I(SymbolInfoInteger(g_sym[i],SYMBOL_SPREAD))+(ots>0?",\"openTs\":"+I(ots):"");
}
void CheckPos(int i){
   if(!PositionSelectByTicket(g_tk[i]))return;
   double sl=PositionGetDouble(POSITION_SL),tp=PositionGetDouble(POSITION_TP),pr=PositionGetDouble(POSITION_PRICE_CURRENT),m=PositionGetDouble(POSITION_PROFIT);
   if(MathAbs(sl-g_sl[i])>1e-10||MathAbs(tp-g_tp[i])>1e-10){
      long ts=NowMs();
      Enqueue("{\"id\":"+Q("m:"+I(g_pos[i])+":"+I(ts))+",\"type\":\"position_modify\",\"ts\":"+I(ts)+",\"position\":"+Q(I(g_pos[i]))+",\"symbol\":"+Q(Cut(g_sym[i],32))+",\"slOld\":"+N(g_sl[i])+",\"slNew\":"+N(sl)+",\"tpOld\":"+N(g_tp[i])+",\"tpNew\":"+N(tp)+",\"price\":"+N(pr)+"}");
      g_sl[i]=sl;g_tp[i]=tp;
   }
   if(m>g_mfeM[i]){g_mfeM[i]=m;g_mfeP[i]=pr;}
   if(m<g_maeM[i]){g_maeM[i]=m;g_maeP[i]=pr;}
}
string SnapshotJson(){
   string ps="";
   for(int i=0;i<ArraySize(g_pos);i++){if(!PositionSelectByTicket(g_tk[i]))continue;ps+=(ps==""?"":",")+"{"+StateJson(i,0,true)+"}";}
   return "{\"ts\":"+I(NowMs())+",\"balance\":"+N(AccountInfoDouble(ACCOUNT_BALANCE))+",\"equity\":"+N(AccountInfoDouble(ACCOUNT_EQUITY))+",\"margin\":"+N(AccountInfoDouble(ACCOUNT_MARGIN))+",\"positions\":["+ps+"]}";
}

//--- odeslání
void Flush(bool withSnapshot){
   if(g_stopped)return;
   int n=MathMin(ArraySize(g_queue),MAX_BATCH);
   if(n==0&&!withSnapshot)return;
   string ev="";for(int i=0;i<n;i++)ev+=(i>0?",":"")+g_queue[i];
   string body="{\"v\":1,\"account\":"+AccountJson()+",\"events\":["+ev+"]"+(withSnapshot?",\"snapshot\":"+SnapshotJson():"")+"}";
   string resp;int code=Http("POST","/api/mt/ingest",body,resp);
   if(code==200){if(n>0)Drop(n);g_backoff=2000;g_nextTry=0;Comment("TradeeSync ",EA_VERSION,": synchronizováno ",TimeToString(TimeLocal(),TIME_SECONDS));return;}
   if(code==401||code==403){g_stopped=true;Comment("TradeeSync zastaven: ",resp);Print("TradeeSync: ",code," ",resp);return;}
   if(code==400||code==413){Print("TradeeSync: server odmítl dávku (",code,"): ",resp);if(n>0)Drop(n);return;}
   g_backoff=MathMin(g_backoff*2,300000);g_nextTry=GetTickCount64()+(ulong)g_backoff;
}
void Reconcile(){
   string resp,path="/api/mt/state?login="+I(g_login)+"&server="+UrlEnc(AccountInfoString(ACCOUNT_SERVER));
   int code=Http("GET",path,"",resp);
   if(code==401||code==403){g_stopped=true;Comment("TradeeSync zastaven: ",resp);return;}
   if(code!=200){Print("TradeeSync: stav účtu nezjištěn (",code,"), dorovnám po připojení celou historii");}
   long last=code==200?JsonLong(resp,"lastDealTs"):0;
   // pozice, které Tradee vede jako otevřené, ale v terminálu už nejsou → uzavření z historie
   string srv[];int no=code==200?JsonStrArr(resp,"openPositions",srv):0;
   for(int i=0;i<no;i++){
      string t=srv[i];int c=StringFind(t,":r");if(c>0)t=StringSubstr(t,0,c);
      long pid=StringToInteger(t);
      if(pid>0&&PosIdx(pid)<0)Vanished(pid);
   }
   datetime from=last>0?(datetime)((last+g_offset*1000)/1000-60):0;
   if(!HistorySelect(from,TimeCurrent()+86400))return;
   // nejdřív zkopírovat všechny tickety: HistoryDealSelect uvnitř cyklu přepisuje výběr z HistorySelect
   ulong tks[];int n=HistoryDealsTotal();ArrayResize(tks,n);
   for(int i=0;i<n;i++)tks[i]=HistoryDealGetTicket(i);
   for(int i=0;i<n;i++){if(tks[i]>0)Push(DealJson(tks[i],false));}
   SaveQueue();
}
//--- svíčky k uzavřeným obchodům (graf v deníku Tradee)
ENUM_TIMEFRAMES TfOf(string s){if(s=="M1")return PERIOD_M1;if(s=="M5")return PERIOD_M5;if(s=="M15")return PERIOD_M15;if(s=="M30")return PERIOD_M30;if(s=="H1")return PERIOD_H1;if(s=="H4")return PERIOD_H4;if(s=="D1")return PERIOD_D1;return PERIOD_CURRENT;}
// položka barsWanted "pozice|symbol|tf|od|do" (od/do v s UTC) → událost bars; "" = historie ještě není stažená, zkusí se příště
string BarsJson(string item){
   string p[];if(StringSplit(item,'|',p)!=5)return "";
   ENUM_TIMEFRAMES tf=TfOf(p[2]);if(tf==PERIOD_CURRENT)return "";
   SymbolSelect(p[1],true);
   datetime from=(datetime)(StringToInteger(p[3])+g_offset),to=(datetime)(StringToInteger(p[4])+g_offset);
   MqlRates r[];ResetLastError();
   int n=CopyRates(p[1],tf,from,to,r);int err=GetLastError();
   // neúplná/nesynchronizovaná historie by se uložila navždy → "" a server se zeptá znovu
   if(n<0||err!=0||SeriesInfoInteger(p[1],tf,SERIES_SYNCHRONIZED)==0)return "";
   int start=MathMax(0,n-1000);string bars="";
   for(int i=start;i<n;i++)bars+=(i>start?",":"")+"["+I(((long)r[i].time-g_offset)*1000)+","+N(r[i].open)+","+N(r[i].high)+","+N(r[i].low)+","+N(r[i].close)+"]";
   return "{\"id\":"+Q("b:"+p[0]+":"+p[2])+",\"type\":\"bars\",\"ts\":"+I(NowMs())+",\"position\":"+Q(p[0])+",\"symbol\":"+Q(p[1])+",\"tf\":"+Q(p[2])+",\"bars\":["+bars+"]}";
}
void PostBars(string ev){
   string resp;int code=Http("POST","/api/mt/ingest","{\"v\":1,\"account\":"+AccountJson()+",\"events\":["+ev+"]}",resp);
   if(code!=200)Print("TradeeSync: svíčky neodeslány (",code,"), Tradee o ně požádá znovu");
}
void SyncBars(){
   g_lastBars=TimeGMT();
   string resp,path="/api/mt/state?login="+I(g_login)+"&server="+UrlEnc(AccountInfoString(ACCOUNT_SERVER));
   int code=Http("GET",path,"",resp);
   if(code==401||code==403){g_stopped=true;Comment("TradeeSync zastaven: ",resp);return;}
   if(code!=200)return;
   string want[];int nw=JsonStrArr(resp,"barsWanted",want);
   string ev="";int k=0;
   for(int i=0;i<nw;i++){
      string j=BarsJson(want[i]);if(j=="")continue;
      ev+=(k>0?",":"")+j;k++;
      if(k==BARS_PER_POST){PostBars(ev);ev="";k=0;}
   }
   if(k>0)PostBars(ev);
}

// volat jen při spojení: bez něj TimeTradeServer() neodpovídá serveru brokera
void CalcOffset(){long off=(long)(TimeTradeServer()-TimeGMT());g_offset=(long)MathRound(off/900.0)*900;}
// stávající čekající pokyny, aby pozdější úprava byla „modified“, ne „placed“
void InitOrders(){
   ArrayResize(g_ord,0);ArrayResize(g_ordSig,0);
   for(int i=0;i<OrdersTotal();i++){
      ulong t=OrderGetTicket(i);if(t==0)continue;
      if(OrderTypeStr((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE))=="")continue;
      int k=ArraySize(g_ord);ArrayResize(g_ord,k+1);ArrayResize(g_ordSig,k+1);
      g_ord[k]=t;g_ordSig[k]=N(OrderGetDouble(ORDER_PRICE_OPEN))+"|"+N(OrderGetDouble(ORDER_SL))+"|"+N(OrderGetDouble(ORDER_TP))+"|"+N(OrderGetDouble(ORDER_VOLUME_CURRENT));
   }
}

// vyčistit stav v paměti (start EA, přepnutí účtu); fronta je už uložená v souboru
void ResetState(){
   ArrayResize(g_queue,0);g_firstQueued=0;g_nextTry=0;g_backoff=2000;g_lastSnap=0;g_lastBars=0;
   Resize(0);ArrayResize(g_ord,0);ArrayResize(g_ordSig,0);ArrayResize(g_pend,0);ArrayResize(g_pendTry,0);g_pendNext=0;
   g_login=0;g_connected=false;
}
// po připojení (i po každém obnovení spojení): offset, stav pozic a pokynů, dorovnání historie
void ConnectedInit(){
   long login=AccountInfoInteger(ACCOUNT_LOGIN);
   if(login!=g_login){g_login=login;LoadQueue();}   // fronta jen jednou pro daný účet
   CalcOffset();
   TrackPositions();InitOrders();
   g_connected=true;
   Reconcile();
}

//--- události terminálu
int OnInit(){
   if(StringLen(TradeeKey)<20){Alert("TradeeSync: vlož klíč z tradee.eu (Propojení s MetaTraderem)");return INIT_PARAMETERS_INCORRECT;}
   FolderCreate("TradeeSync");
   g_stopped=false;ResetState();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();Comment("");}   // fronta je uložená při každé změně
void OnTimer(){
   if(g_stopped)return;
   // bez spojení s brokerem (nebo bez přihlášení) se nic nedělá; historie a čas serveru nejsou spolehlivé
   long login=AccountInfoInteger(ACCOUNT_LOGIN);
   if(TerminalInfoInteger(TERMINAL_CONNECTED)==0||login==0){Comment("TradeeSync: čekám na spojení s brokerem…");g_connected=false;return;}
   if(g_login!=0&&login!=g_login){Print("TradeeSync: přepnutý účet ",g_login," → ",login);SaveQueue();ResetState();}
   if(!g_connected){ConnectedInit();if(g_stopped)return;}
   CalcOffset();
   TrackPositions();for(int i=0;i<ArraySize(g_pos);i++)CheckPos(i);
   CheckPending();
   ulong now=GetTickCount64();
   int every=ArraySize(g_pos)>0?120:900;
   bool snap=(TimeGMT()-g_lastSnap)>=every;
   bool due=ArraySize(g_queue)>0&&now-g_firstQueued>=FLUSH_MS;
   if((due||snap)&&now>=g_nextTry){Flush(snap);if(snap)g_lastSnap=TimeGMT();}
   if(!g_stopped&&TimeGMT()-g_lastBars>=BARS_EVERY)SyncBars();
}
void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result){
   if(g_stopped||!g_connected)return;   // co přijde před úvodním dorovnáním, dorovná Reconcile
   if(trans.type==TRADE_TRANSACTION_DEAL_ADD){
      if(HistoryDealSelect(trans.deal)){
         long entry=HistoryDealGetInteger(trans.deal,DEAL_ENTRY),pid=HistoryDealGetInteger(trans.deal,DEAL_POSITION_ID);
         int k=PosIdx(pid);
         // poslední MFE/MAE před uzavřením, ať se neztratí průběh od posledního snímku
         if(k>=0&&(entry==DEAL_ENTRY_OUT||entry==DEAL_ENTRY_INOUT||entry==DEAL_ENTRY_OUT_BY)){g_out[k]=true;long ts=Utc(HistoryDealGetInteger(trans.deal,DEAL_TIME_MSC))-1;Push("{\"id\":"+Q("p:"+I(pid)+":"+I(ts))+",\"type\":\"position_state\",\"ts\":"+I(ts)+","+StateJson(k,ts,false)+"}");}
      }
      Enqueue(DealJson(trans.deal,true));TrackPositions();
   }
   else if(trans.type==TRADE_TRANSACTION_ORDER_ADD||trans.type==TRADE_TRANSACTION_ORDER_UPDATE||trans.type==TRADE_TRANSACTION_ORDER_DELETE||trans.type==TRADE_TRANSACTION_HISTORY_ADD){string j=OrderJson(trans);if(j!="")Enqueue(j);}
   else if(trans.type==TRADE_TRANSACTION_POSITION){int k=PosIdx((long)trans.position);if(k>=0)CheckPos(k);}
}
//+------------------------------------------------------------------+
