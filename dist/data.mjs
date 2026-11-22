// Reproducible, fictional prices for exploring the interface without a feed.
// All UI output using these records is marked sample. No interpolation across other tickers.
const instruments={
  SPY:{name:'SPDR S&P 500 ETF Trust',type:'ETF',exchange:'NYSE Arca',base:596.84,change:0.67,iv:.184,step:5,description:'An exchange-traded fund that seeks to track the S&P 500 Index.'},
  QQQ:{name:'Invesco QQQ Trust',type:'ETF',exchange:'Nasdaq',base:515.72,change:1.14,iv:.231,step:5,description:'An exchange-traded fund that seeks to track the Nasdaq-100 Index.'},
  AAPL:{name:'Apple Inc.',type:'Stock',exchange:'Nasdaq',base:234.58,change:-.43,iv:.261,step:5,description:'Consumer electronics, software and digital services.'},
  NVDA:{name:'NVIDIA Corporation',type:'Stock',exchange:'Nasdaq',base:148.21,change:1.82,iv:.493,step:2.5,description:'Accelerated computing, graphics and AI infrastructure.'},
  MSFT:{name:'Microsoft Corporation',type:'Stock',exchange:'Nasdaq',base:442.33,change:.22,iv:.277,step:5,description:'Software, cloud services and enterprise computing.'},
  IWM:{name:'iShares Russell 2000 ETF',type:'ETF',exchange:'NYSE Arca',base:218.36,change:-.36,iv:.251,step:2,description:'An exchange-traded fund that seeks to track the Russell 2000 Index.'}
};
const sampleDate='2026-01-09', sampleTime=sampleDate+'T21:00:00Z';
const days=[7,14,21,42,70,98,161,252];
const mul=(n,i)=>Math.sin(i*1.267+n*.157)*.61+Math.sin(i*2.349+n*.97)*.39;
const round=(n,d=2)=>Number(n.toFixed(d));
const dateShift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
const env=(data,extra={})=>({ok:true,data,provider:'Synthetic sample',asOf:sampleTime,fetchedAt:null,warnings:[],...extra});
const no=(what)=>({ok:false,data:[],error:{message:what},provider:'Synthetic sample',asOf:null,fetchedAt:null});
export const demoTickers=Object.keys(instruments);
export function sampleData(endpoint,symbol){
  if(endpoint==='search')return env(demoTickers.filter(s=>s.includes(symbol.toUpperCase())||instruments[s].name.toLowerCase().includes(symbol.toLowerCase())).map(s=>({symbol:s,name:instruments[s].name,type:instruments[s].type,exchange:instruments[s].exchange})));
  const o=instruments[symbol];
  if(!o)return no('This ticker is outside the six-symbol sample. Connect OpenBB to look it up.');
  const seed=demoTickers.indexOf(symbol)+1;
  if(endpoint==='quote')return env([{symbol,name:o.name,exchange:o.exchange,currency:'USD',price:o.base,change_percent:o.change,change:round(o.base-o.base/(1+o.change/100)),prev_close:round(o.base/(1+o.change/100)),open:round(o.base*.994),day_high:round(o.base*1.004),day_low:round(o.base*.989),volume:Math.round(45200000*seed/6),fifty_two_week_high:round(o.base*1.042),fifty_two_week_low:round(o.base*.826),iv30:o.iv,iv30_annual_low:o.iv*.58,iv30_annual_high:o.iv*1.48,asset_type:o.type,last_trade_timestamp:sampleTime}]);
  if(endpoint==='profile')return env([{symbol,name:o.name,description:o.description,exchange:o.exchange,currency:'USD',asset_type:o.type,sector:o.type==='ETF'?null:'Technology'}]);
  if(endpoint==='history'){
    let date=sampleDate;const rows=[];
    for(let i=0;i<270;i++){
      const day=new Date(date+'T00:00:00Z').getUTCDay();
      if(day>0&&day<6){const phase=i/270; const close=round(o.base*(1-.175*phase+.019*(Math.cos(i*.066)-1)+.015*(Math.sin(i*.117))+.008*(mul(seed,i)-mul(seed,0))));rows.push({date,close,open:round(close*(1+.005*mul(seed+1,i))),high:round(close*1.007),low:round(close*.993),volume:Math.round(6500000+18000000*Math.abs(mul(seed,i)))});}
      date=dateShift(date,-1);
    }
    return env(rows.reverse(),{asOf:sampleDate});
  }
  if(endpoint==='chain'){
    const center=Math.round(o.base/o.step)*o.step, rows=[];
    for(const [j,d] of days.entries())for(let i=-15;i<=15;i++)for(const side of ['call','put']){
      const exp=dateShift(sampleDate,d), k=round(center+i*o.step), isCall=side==='call';
      const intrinsic=Math.max(isCall?o.base-k:k-o.base,0);
      const iv=round(o.iv+.004*j+.0019*Math.abs(i)+.0029*Math.max(-i,0)+(isCall?0:.005),4);
      const dist=Math.abs(k-o.base), scale=o.base*iv*Math.sqrt(d/365), centerPremium=scale*.405;
      const ext=centerPremium*Math.exp(-dist/(scale*.70));
      const mid=intrinsic+ext, width=.05+mid*.023+Math.abs(i)*.011;
      const bid=round(Math.max(0,mid-width)),ask=round(mid+width),impulse=Math.abs(mul(seed+j,i+(isCall?21:32)));
      const spike=(i===3&&isCall&&j<2)||(i===-2&&!isCall&&j===1)?4:1;
      const vol=Math.round((220+impulse*27000)*Math.exp(-Math.abs(i)/6)*spike/(1+j*.64)), oi=Math.round((370+impulse*41000)*Math.exp(-Math.abs(i)/7)/(1+j*.33)+(j+1)*111);
      const dCall=1/(1+Math.exp((k-o.base)/(scale*.47)));
      rows.push({contract_symbol:symbol+exp.slice(2).replaceAll('-','')+(isCall?'C':'P')+String(Math.round(k*1000)).padStart(8,'0'),underlying_symbol:symbol,expiration:exp,option_type:side,strike:k,bid,ask,last_trade_price:round(mid+mul(seed,i)*width*.6),volume:vol,open_interest:oi,implied_volatility:iv,delta:round(isCall?dCall:dCall-1,4),gamma:round(dCall*(1-dCall)/(scale*.47),4),theta:round(-ext/d*.51,4),vega:round(ext/iv*.012,4),multiplier:100,quote_time:sampleTime});
    }
    return env(rows);
  }
  return no('This dataset is available only from a connected provider. The sample does not invent corporate records.');
}

export const getPreference=(key,fallback)=>{try{return JSON.parse(localStorage.getItem('strikebook:'+key))??fallback;}catch{return fallback;}};
export function setPreference(key,value){try{localStorage.setItem('strikebook:'+key,JSON.stringify(value));}catch{}}

export function isLoopbackOrigin(origin){
  try {
    const url=new URL(origin);
    return url.protocol==='http:' && ['127.0.0.1','localhost'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function getApi(endpoint,params={},origin='',signal){
  const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null));
  const options={signal,headers:{Accept:'application/json'}};
  if(origin){
    options.redirect='error';
    if(isLoopbackOrigin(origin))options.targetAddressSpace='loopback';
  }
  try{
    const res=await fetch(`${origin}/api/${endpoint}${query.size?'?'+query:''}`,options);
    if(!res.ok||!res.headers.get('content-type')?.includes('json'))throw new Error('No Strikebook bridge responded at this address.');
    const reply=await res.json();
    if(typeof reply.ok!=='boolean')throw new Error('The server did not return a Strikebook response.');
    return reply;
  }catch(error){
    if(signal?.aborted||error?.name==='AbortError')throw error;
    return {ok:false,data:[],error:{message:error.message},provider:null,asOf:null,fetchedAt:null,bridgeError:true};
  }
}

export function normalizeOrigin(value){
  const input=String(value??'').trim();
  if(!input)return '';
  let u;
  try{u=new URL(input);}catch{throw new Error('Enter the full bridge address, including http:// or https://.');}
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Enter only the bridge origin, without a path, credentials, or query.');
  if(u.protocol==='https:')return u.origin;
  if(isLoopbackOrigin(u.origin)&&u.port)return u.origin;
  throw new Error('Enter an HTTPS bridge address or the local HTTP address and port printed by the Windows launcher.');
}
