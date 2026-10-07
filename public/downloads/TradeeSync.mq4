//+------------------------------------------------------------------+
//| TradeeSync.mq4 – automatický deník obchodů pro tradee.eu (MT4)    |
//| MT4 nemá události obchodů: každou sekundu porovná stav s minulým. |
//+------------------------------------------------------------------+
#property copyright "Tradee"
#property link      "https://tradee.eu"
#property version   "1.00"
#property description "Automatický deník obchodů pro tradee.eu"
#property strict

input string TradeeKey   = "";                  // Klíč z tradee.eu → Propojení s MetaTraderem
input string AccountName = "";                  // Název účtu v Tradee (volitelné)
input string Endpoint    = "https://tradee.eu"; // Adresa Tradee

#define EA_VERSION "1.0.0"
#define MAX_BATCH  500
#define FLUSH_MS   2000

string   g_queue[];
uint     g_firstQueued=0,g_failAt=0;
bool     g_failed=false;
int      g_backoff=2000;
bool     g_stopped=false;
long     g_offset=0;
datetime g_lastSnap=0,g_lastTick=0;
// minulý stav otevřených objednávek
int      g_t[],g_type[],g_root[];
double   g_lots[],g_sl[],g_tp[],g_price[],g_mfeP[],g_maeP[],g_mfeM[],g_maeM[];
string   g_sym[];

string Esc(string s){string o="";int n=StringLen(s);for(int i=0;i<n;i++){ushort c=StringGetCharacter(s,i);if(c=='"')o+="\\\"";else if(c=='\\')o+="\\\\";else if(c<32)o+=" ";else o+=ShortToString(c);}return o;}
string Q(string s){return "\""+Esc(s)+"\"";}
string N(double v){if(!MathIsValidNumber(v))return "0";string s=DoubleToString(v,8);if(StringFind(s,".")>=0){while(StringLen(s)>1&&StringGetCharacter(s,StringLen(s)-1)=='0')s=StringSubstr(s,0,StringLen(s)-1);if(StringGetCharacter(s,StringLen(s)-1)=='.')s=StringSubstr(s,0,StringLen(s)-1);}if(s=="-0")s="0";return s;}
string I(long v){return IntegerToString(v);}
string Cut(string s,int n){return StringLen(s)>n?StringSubstr(s,0,n):s;}
long   Utc(datetime serverTime){return ((long)serverTime-g_offset)*1000;}
long   NowMs(){return (long)TimeGMT()*1000+(long)(GetTickCount()%1000);}
string QueueFile(){return "TradeeSync\\"+I(AccountNumber())+".queue";}

void SaveQueue(){int h=FileOpen(QueueFile(),FILE_WRITE|FILE_TXT|FILE_ANSI,'\t',CP_UTF8);if(h==INVALID_HANDLE)return;for(int i=0;i<ArraySize(g_queue);i++)FileWriteString(h,g_queue[i]+"\n");FileClose(h);}
void LoadQueue(){ArrayResize(g_queue,0);if(!FileIsExist(QueueFile()))return;int h=FileOpen(QueueFile(),FILE_READ|FILE_TXT|FILE_ANSI,'\t',CP_UTF8);if(h==INVALID_HANDLE)return;while(!FileIsEnding(h)){string l=FileReadString(h);if(StringLen(l)>2){int n=ArraySize(g_queue);ArrayResize(g_queue,n+1);g_queue[n]=l;}}FileClose(h);if(ArraySize(g_queue)>0)g_firstQueued=GetTickCount();}
void Push(string ev){if(ev=="")return;int n=ArraySize(g_queue);ArrayResize(g_queue,n+1);g_queue[n]=ev;if(n==0)g_firstQueued=GetTickCount();}
void Enqueue(string ev){if(ev=="")return;Push(ev);SaveQueue();}
void Drop(int n){int left=ArraySize(g_queue)-n;for(int i=0;i<left;i++)g_queue[i]=g_queue[i+n];ArrayResize(g_queue,MathMax(left,0));g_firstQueued=left>0?GetTickCount():0;SaveQueue();}

string UrlEnc(string s){uchar b[];StringToCharArray(s,b,0,WHOLE_ARRAY,CP_UTF8);string o="";for(int i=0;i<ArraySize(b)-1;i++){uchar c=b[i];if((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='_'||c=='.')o+=CharToString(c);else o+=StringFormat("%%%02X",c);}return o;}
int Http(string method,string path,string body,string &resp){
   char data[],res[];string rh;
   if(body!=""){StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,ArraySize(data)-1);}
   string hdr="Content-Type: application/json\r\nAuthorization: Bearer "+TradeeKey+"\r\n";
   ResetLastError();
   int code=WebRequest(method,Endpoint+path,hdr,10000,data,res,rh);
   resp=CharArrayToString(res,0,WHOLE_ARRAY,CP_UTF8);
   if(code==-1){int err=GetLastError();if(err==4060)Comment("TradeeSync: povol adresu ",Endpoint," v Nástroje → Možnosti → Experti → Povolit WebRequest.");else Print("TradeeSync: WebRequest chyba ",err);}
   return code;
}
long JsonLong(string s,string key){int p=StringFind(s,"\""+key+"\":");if(p<0)return 0;p+=StringLen(key)+3;string num="";while(p<StringLen(s)){ushort c=StringGetCharacter(s,p);if((c>='0'&&c<='9')||c=='-')num+=ShortToString(c);else break;p++;}return StringToInteger(num);}

string AccountJson(){
   return "{\"platform\":\"mt4\",\"login\":"+Q(I(AccountNumber()))+",\"server\":"+Q(Cut(AccountServer(),64))+",\"company\":"+Q(Cut(AccountCompany(),64))+",\"currency\":"+Q(Cut(AccountCurrency(),8))+",\"leverage\":"+I(AccountLeverage())+",\"mode\":"+Q(IsDemo()?"demo":"real")+",\"name\":"+Q(Cut(AccountName,60))+",\"ea\":"+Q(EA_VERSION)+"}";
}
// Kořen řetězce dílčích uzavření: komentář „from #N“ odkazuje na předchozí ticket.
int ParseFrom(string c){int p=StringFind(c,"from #");if(p<0)return 0;return (int)StringToInteger(StringSubstr(c,p+6));}
int Idx(int t){for(int i=0;i<ArraySize(g_t);i++)if(g_t[i]==t)return i;return -1;}
// pool = MODE_TRADES / MODE_HISTORY, ve kterém volající ticket našel; po výpočtu se ticket znovu vybere
int RootOf(int ticket,string comment,int pool){
   int parent=ParseFrom(comment),guard=0;if(parent<=0)return ticket;
   int root=parent,res=-1;
   while(guard++<30){
      int k=Idx(root);if(k>=0){res=g_root[k];break;}
      if(!OrderSelect(root,SELECT_BY_TICKET,MODE_HISTORY))break;
      int up=ParseFrom(OrderComment());if(up<=0)break;root=up;
   }
   if(res<0)res=root;
   OrderSelect(ticket,SELECT_BY_TICKET,pool);
   return res;
}
string Reason4(string c){if(StringFind(c,"[sl]")>=0)return "sl";if(StringFind(c,"[tp]")>=0)return "tp";if(StringFind(c,"so:")>=0)return "so";return "client";}
// Deal z právě vybrané objednávky (OrderSelect). volume = objem této části.
string DealJson4(string entry,int root,double volume,bool live){
   string sym=OrderSymbol();int type=OrderType();
   bool out=entry=="out";
   string side=(type==OP_BUY)!=out?"buy":"sell";
   long ts=out?Utc(OrderCloseTime()):Utc(OrderOpenTime());
   double price=out?OrderClosePrice():OrderOpenPrice();
   return "{\"id\":"+Q("d4:"+I(OrderTicket())+":"+entry)+",\"type\":\"deal\",\"ts\":"+I(ts)+",\"deal\":"+Q(I(OrderTicket())+":"+entry)+",\"position\":"+Q(I(root))+",\"order\":"+Q(I(OrderTicket()))
     +",\"symbol\":"+Q(Cut(sym,32))+",\"side\":"+Q(side)+",\"entry\":"+Q(entry)+",\"volume\":"+N(volume)+",\"price\":"+N(price)
     +",\"commission\":"+N(out?OrderCommission():0)+",\"swap\":"+N(out?OrderSwap():0)+",\"fee\":0,\"profit\":"+N(out?OrderProfit():0)
     +",\"magic\":"+I(OrderMagicNumber())+",\"comment\":"+Q(Cut(OrderComment(),64))+",\"reason\":"+Q(out?Reason4(OrderComment()):"client")+",\"dealType\":\"trade\""
     +",\"sl\":"+N(OrderStopLoss())+",\"tp\":"+N(OrderTakeProfit())
     +",\"digits\":"+I((long)MarketInfo(sym,MODE_DIGITS))+",\"point\":"+N(MarketInfo(sym,MODE_POINT))+",\"tickSize\":"+N(MarketInfo(sym,MODE_TICKSIZE))+",\"tickValue\":"+N(MarketInfo(sym,MODE_TICKVALUE))
     +",\"spread\":"+I(live&&!out?(long)MarketInfo(sym,MODE_SPREAD):0)+",\"priceRequested\":0,\"balance\":"+N(live&&!out?AccountBalance():0)+"}";
}
string OrderTypeStr4(int t){switch(t){case OP_BUYLIMIT:return "buy_limit";case OP_SELLLIMIT:return "sell_limit";case OP_BUYSTOP:return "buy_stop";case OP_SELLSTOP:return "sell_stop";}return "";}
string OrderJson4(string state){
   long ts=NowMs();
   return "{\"id\":"+Q("o4:"+I(OrderTicket())+":"+state+":"+I(ts))+",\"type\":\"order\",\"ts\":"+I(ts)+",\"order\":"+Q(I(OrderTicket()))+",\"position\":\"\",\"symbol\":"+Q(Cut(OrderSymbol(),32))+",\"orderType\":"+Q(OrderTypeStr4(OrderType()))+",\"state\":"+Q(state)
     +",\"volume\":"+N(OrderLots())+",\"priceOpen\":"+N(OrderOpenPrice())+",\"priceRequested\":"+N(OrderOpenPrice())+",\"sl\":"+N(OrderStopLoss())+",\"tp\":"+N(OrderTakeProfit())+",\"expiration\":"+I(OrderExpiration()>0?Utc(OrderExpiration()):0)+",\"comment\":"+Q(Cut(OrderComment(),64))+",\"magic\":"+I(OrderMagicNumber())+"}";
}
string ModifyJson4(int k,double sl,double tp){
   long ts=NowMs();
   return "{\"id\":"+Q("m:"+I(g_root[k])+":"+I(g_t[k])+":"+I(ts))+",\"type\":\"position_modify\",\"ts\":"+I(ts)+",\"position\":"+Q(I(g_root[k]))+",\"symbol\":"+Q(Cut(g_sym[k],32))+",\"slOld\":"+N(g_sl[k])+",\"slNew\":"+N(sl)+",\"tpOld\":"+N(g_tp[k])+",\"tpNew\":"+N(tp)+",\"price\":"+N(OrderClosePrice())+"}";
}
string StateJson4(int k,bool full){
   string side=g_type[k]==OP_SELL?"sell":"buy";double vol=0,po=0,pc=0,pf=0,sw=0;long ots=0;
   if(full){vol=OrderLots();po=OrderOpenPrice();pc=OrderClosePrice();pf=OrderProfit();sw=OrderSwap();ots=Utc(OrderOpenTime());}
   return "\"position\":"+Q(I(g_root[k]))+",\"symbol\":"+Q(Cut(g_sym[k],32))+",\"side\":"+Q(side)+",\"volume\":"+N(vol)+",\"priceOpen\":"+N(po)+",\"priceCurrent\":"+N(pc)+",\"sl\":"+N(g_sl[k])+",\"tp\":"+N(g_tp[k])+",\"profit\":"+N(pf)+",\"swap\":"+N(sw)
     +",\"mfePrice\":"+N(g_mfeP[k])+",\"maePrice\":"+N(g_maeP[k])+",\"mfeMoney\":"+N(g_mfeM[k])+",\"maeMoney\":"+N(g_maeM[k])+",\"spread\":"+I((long)MarketInfo(g_sym[k],MODE_SPREAD))+(ots>0?",\"openTs\":"+I(ots):"");
}
void ResizeAll(int n){ArrayResize(g_t,n);ArrayResize(g_type,n);ArrayResize(g_root,n);ArrayResize(g_lots,n);ArrayResize(g_sl,n);ArrayResize(g_tp,n);ArrayResize(g_price,n);ArrayResize(g_sym,n);ArrayResize(g_mfeP,n);ArrayResize(g_maeP,n);ArrayResize(g_mfeM,n);ArrayResize(g_maeM,n);}
void AddCurrent(int root){int k=ArraySize(g_t);ResizeAll(k+1);g_t[k]=OrderTicket();g_type[k]=OrderType();g_root[k]=root;g_lots[k]=OrderLots();g_sl[k]=OrderStopLoss();g_tp[k]=OrderTakeProfit();g_price[k]=OrderOpenPrice();g_sym[k]=OrderSymbol();g_mfeP[k]=OrderClosePrice();g_maeP[k]=OrderClosePrice();g_mfeM[k]=OrderProfit();g_maeM[k]=OrderProfit();}
void RemoveAt(int i){int l=ArraySize(g_t)-1;g_t[i]=g_t[l];g_type[i]=g_type[l];g_root[i]=g_root[l];g_lots[i]=g_lots[l];g_sl[i]=g_sl[l];g_tp[i]=g_tp[l];g_price[i]=g_price[l];g_sym[i]=g_sym[l];g_mfeP[i]=g_mfeP[l];g_maeP[i]=g_maeP[l];g_mfeM[i]=g_mfeM[l];g_maeM[i]=g_maeM[l];ResizeAll(l);}

// Porovnání aktuálního stavu s minulým → události.
void Poll(){
   int n=OrdersTotal();int cur[];ArrayResize(cur,0);
   for(int i=0;i<n;i++){
      if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;
      int t=OrderTicket(),type=OrderType(),k=Idx(t);
      int m=ArraySize(cur);ArrayResize(cur,m+1);cur[m]=t;
      bool market=type<=OP_SELL;
      if(k<0){
         if(market){int root=RootOf(t,OrderComment(),MODE_TRADES);if(root==t)Enqueue(DealJson4("in",root,OrderLots(),true));AddCurrent(root);}
         else{Enqueue(OrderJson4("placed"));AddCurrent(t);}
         continue;
      }
      if(market&&g_type[k]>OP_SELL){ // čekající pokyn se vyplnil
         Enqueue(OrderJson4("filled"));Enqueue(DealJson4("in",t,OrderLots(),true));
         g_type[k]=type;g_root[k]=t;g_lots[k]=OrderLots();g_sl[k]=OrderStopLoss();g_tp[k]=OrderTakeProfit();continue;
      }
      if(market){
         double sl=OrderStopLoss(),tp=OrderTakeProfit();
         if(MathAbs(sl-g_sl[k])>1e-10||MathAbs(tp-g_tp[k])>1e-10){Enqueue(ModifyJson4(k,sl,tp));g_sl[k]=sl;g_tp[k]=tp;}
         double pf=OrderProfit(),pr=OrderClosePrice();
         if(pf>g_mfeM[k]){g_mfeM[k]=pf;g_mfeP[k]=pr;}
         if(pf<g_maeM[k]){g_maeM[k]=pf;g_maeP[k]=pr;}
      }else if(MathAbs(OrderOpenPrice()-g_price[k])>1e-10||MathAbs(OrderStopLoss()-g_sl[k])>1e-10||MathAbs(OrderTakeProfit()-g_tp[k])>1e-10||MathAbs(OrderLots()-g_lots[k])>1e-10){
         Enqueue(OrderJson4("modified"));g_price[k]=OrderOpenPrice();g_sl[k]=OrderStopLoss();g_tp[k]=OrderTakeProfit();g_lots[k]=OrderLots();
      }
   }
   // zmizelé objednávky → uzavření / zrušení
   for(int i=ArraySize(g_t)-1;i>=0;i--){
      bool f=false;for(int j=0;j<ArraySize(cur);j++)if(cur[j]==g_t[i]){f=true;break;}
      if(f)continue;
      if(OrderSelect(g_t[i],SELECT_BY_TICKET,MODE_HISTORY)){
         if(g_type[i]<=OP_SELL){
            long ts=Utc(OrderCloseTime())-1;
            Push("{\"id\":"+Q("p:"+I(g_root[i])+":"+I(ts))+",\"type\":\"position_state\",\"ts\":"+I(ts)+","+StateJson4(i,false)+"}");
            Enqueue(DealJson4("out",g_root[i],OrderLots(),true));
         }else Enqueue(OrderJson4(OrderExpiration()>0&&OrderCloseTime()>=OrderExpiration()?"expired":"canceled"));
      }
      RemoveAt(i);
   }
}
// Dorovnání historie po startu: in pro každý kořen (objem = součet řetězce), out pro každou uzavřenou část.
void Reconcile(){
   string resp,path="/api/mt/state?login="+I(AccountNumber())+"&server="+UrlEnc(AccountServer());
   int code=Http("GET",path,"",resp);
   if(code==401||code==403){g_stopped=true;Comment("TradeeSync zastaven: ",resp);return;}
   long last=code==200?JsonLong(resp,"lastDealTs"):0;
   int tk[],rt[];double lots[];bool open[];int cnt=0;
   for(int pass=0;pass<2;pass++){
      int total=pass==0?OrdersHistoryTotal():OrdersTotal();
      for(int i=0;i<total;i++){
         if(!OrderSelect(i,SELECT_BY_POS,pass==0?MODE_HISTORY:MODE_TRADES))continue;
         if(OrderType()>OP_SELL)continue;
         ArrayResize(tk,cnt+1);ArrayResize(rt,cnt+1);ArrayResize(lots,cnt+1);ArrayResize(open,cnt+1);
         int ot=OrderTicket();double ol=OrderLots();string oc=OrderComment();
         tk[cnt]=ot;rt[cnt]=RootOf(ot,oc,pass==0?MODE_HISTORY:MODE_TRADES);lots[cnt]=ol;open[cnt]=pass==1;cnt++;
      }
   }
   for(int i=0;i<cnt;i++){
      bool isOpen=open[i];
      if(!OrderSelect(tk[i],SELECT_BY_TICKET,isOpen?MODE_TRADES:MODE_HISTORY))continue;
      bool recent=isOpen||Utc(OrderCloseTime())>=last-60000;
      if(!recent)continue;
      if(rt[i]==tk[i]){double sum=0;for(int j=0;j<cnt;j++)if(rt[j]==tk[i])sum+=lots[j];Push(DealJson4("in",tk[i],sum,false));}
      if(!isOpen)Push(DealJson4("out",rt[i],lots[i],false));
   }
   SaveQueue();
}
void InitState(){
   ResizeAll(0);
   for(int i=0;i<OrdersTotal();i++){if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;AddCurrent(OrderType()<=OP_SELL?RootOf(OrderTicket(),OrderComment(),MODE_TRADES):OrderTicket());}
}
string SnapshotJson(){
   string ps="";
   for(int k=0;k<ArraySize(g_t);k++){if(g_type[k]>OP_SELL||!OrderSelect(g_t[k],SELECT_BY_TICKET,MODE_TRADES))continue;ps+=(ps==""?"":",")+"{"+StateJson4(k,true)+"}";}
   return "{\"ts\":"+I(NowMs())+",\"balance\":"+N(AccountBalance())+",\"equity\":"+N(AccountEquity())+",\"margin\":"+N(AccountMargin())+",\"positions\":["+ps+"]}";
}
int OpenMarket(){int c=0;for(int k=0;k<ArraySize(g_type);k++)if(g_type[k]<=OP_SELL)c++;return c;}
void Flush(bool withSnapshot){
   if(g_stopped)return;
   int n=MathMin(ArraySize(g_queue),MAX_BATCH);
   if(n==0&&!withSnapshot)return;
   string ev="";for(int i=0;i<n;i++)ev+=(i>0?",":"")+g_queue[i];
   string body="{\"v\":1,\"account\":"+AccountJson()+",\"events\":["+ev+"]"+(withSnapshot?",\"snapshot\":"+SnapshotJson():"")+"}";
   string resp;int code=Http("POST","/api/mt/ingest",body,resp);
   if(code==200){if(n>0)Drop(n);g_backoff=2000;g_failed=false;Comment("TradeeSync ",EA_VERSION,": synchronizováno ",TimeToString(TimeLocal(),TIME_SECONDS));return;}
   if(code==401||code==403){g_stopped=true;Comment("TradeeSync zastaven: ",resp);Print("TradeeSync: ",code," ",resp);return;}
   if(code==400||code==413){Print("TradeeSync: server odmítl dávku (",code,"): ",resp);if(n>0)Drop(n);return;}
   g_backoff=MathMin(g_backoff*2,300000);g_failAt=GetTickCount();g_failed=true;
}

void CalcOffset(){long off=(long)(TimeCurrent()-TimeGMT());g_offset=(long)MathRound(off/900.0)*900;}
int OnInit(){
   if(StringLen(TradeeKey)<20){Alert("TradeeSync: vlož klíč z tradee.eu (Propojení s MetaTraderem)");return INIT_PARAMETERS_INCORRECT;}
   CalcOffset();
   FolderCreate("TradeeSync");
   LoadQueue();InitState();Reconcile();
   EventSetTimer(1);g_lastSnap=0;
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();SaveQueue();Comment("");}
void OnTimer(){
   if(g_stopped)return;
   // TimeCurrent() je čas posledního ticku: offset se přepočítá jen při čerstvém ticku
   datetime tc=TimeCurrent();if(tc!=g_lastTick){g_lastTick=tc;CalcOffset();}
   Poll();
   uint now=GetTickCount();
   int every=OpenMarket()>0?120:900;
   bool snap=(TimeGMT()-g_lastSnap)>=every;
   bool due=ArraySize(g_queue)>0&&now-g_firstQueued>=FLUSH_MS;
   bool ready=!g_failed||now-g_failAt>=(uint)g_backoff;
   if((due||snap)&&ready){Flush(snap);if(snap)g_lastSnap=TimeGMT();}
}
//+------------------------------------------------------------------+
