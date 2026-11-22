// Interactive daily candlesticks with TradingView Lightweight Charts (Apache-2.0, vendored in ./vendor).
// The view renders an SVG chart first; this module replaces it once the library loads,
// so the SVG remains the fallback if the module cannot load.
import {fmt,compact,dateText} from './ui.mjs';

const payloads=new Map();
const active=new Set();
// Zoom and scroll per symbol and period survive re-renders, which happen on most state changes.
const ranges=new Map();
let sequence=0;
let library;

/** Store the data for one chart and return the id the view puts in `data-lw-candles`. */
export function candlePayload(payload){
 const id=`lw-candles-${++sequence}`;
 payloads.set(id,payload);
 while(payloads.size>6)payloads.delete(payloads.keys().next().value);
 return id;
}

function loadLibrary(){
 library??=import('./vendor/lightweight-charts.standalone.production.mjs').catch(error=>{
  console.warn('Lightweight Charts could not load; keeping the SVG candlestick chart.',error);
  return null;
 });
 return library;
}

function dayOf(time){
 if(typeof time==='string')return time;
 if(typeof time==='number')return new Date(time*1000).toISOString().slice(0,10);
 if(time&&typeof time==='object')return `${time.year}-${String(time.month).padStart(2,'0')}-${String(time.day).padStart(2,'0')}`;
 return null;
}

const markerStyle={
 bullish:{position:'belowBar',shape:'arrowUp',color:'--teal'},
 // Hammer shares the bullish arrow, so a letter tells them apart on the chart.
 hammer:{position:'belowBar',shape:'arrowUp',color:'--teal',text:'H'},
 bearish:{position:'aboveBar',shape:'arrowDown',color:'--red'},
 doji:{position:'aboveBar',shape:'circle',color:'--gold'},
};

/** Mount charts for any placeholders under `root`, and dispose charts whose placeholders left the page. */
export async function mountCandleCharts(root){
 for(const entry of active){
  if(!entry.container.isConnected){entry.dispose();active.delete(entry);}
 }
 const containers=[...root.querySelectorAll('[data-lw-candles]')];
 if(!containers.length)return;
 const lib=await loadLibrary();
 if(!lib)return;
 for(const container of containers){
  const payload=payloads.get(container.dataset.lwCandles);
  if(!container.isConnected||container.dataset.lwMounted||!payload)continue;
  active.add(mount(lib,container,payload));
 }
}

function mount(lib,container,payload){
 const {createChart,CandlestickSeries,HistogramSeries,createSeriesMarkers,CrosshairMode}=lib;
 const css=getComputedStyle(document.documentElement);
 const token=name=>css.getPropertyValue(name).trim();
 const up=token('--teal2')||'#36c7aa',down=token('--red')||'#ff9299',line=token('--line')||'#263244';
 container.dataset.lwMounted='1';
 const host=document.createElement('div');
 host.className='lw-host';
 const legend=document.createElement('output');
 legend.className='lw-legend';
 container.replaceChildren(host,legend);

 const chart=createChart(host,{
  autoSize:true,
  layout:{background:{type:'solid',color:'transparent'},textColor:'#93a3bb',fontFamily:token('--mono')||'monospace',fontSize:11,panes:{separatorColor:line}},
  grid:{vertLines:{color:'#1a2433'},horzLines:{color:'#1a2433'}},
  rightPriceScale:{borderColor:line},
  timeScale:{borderColor:line,rightOffset:3,minBarSpacing:1.5},
  crosshair:{mode:CrosshairMode.Normal},
 });
 const candles=chart.addSeries(CandlestickSeries,{upColor:up,downColor:down,borderUpColor:up,borderDownColor:down,wickUpColor:up,wickDownColor:down,priceLineVisible:false});
 const bars=payload.bars;
 candles.setData(bars.map(bar=>({time:bar.date,open:bar.open,high:bar.high,low:bar.low,close:bar.close})));

 const hasVolume=bars.some(bar=>bar.volume>0);
 if(hasVolume){
  const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
  volume.setData(bars.map(bar=>({time:bar.date,value:bar.volume??0,color:`${bar.close>=bar.open?up:down}66`})));
  try{chart.panes()[1]?.setHeight(64);}catch{}
 }

 const markers=[...payload.matches].flatMap(([date,items])=>items.map(item=>{
  const style=markerStyle[item.variant]??markerStyle.doji;
  return {time:date,position:style.position,shape:style.shape,color:token(style.color),size:1,id:`${date}:${item.label}`,...(style.text?{text:style.text}:{})};
 })).sort((a,b)=>a.time.localeCompare(b.time));
 if(markers.length)createSeriesMarkers(candles,markers);

 const byDate=new Map(bars.map((bar,index)=>[bar.date,{bar,index}]));
 const describe=bar=>{
  const labels=(payload.matches.get(bar.date)??[]).map(item=>item.label);
  return [dateText(bar.date,'full'),`O ${fmt(bar.open)} · H ${fmt(bar.high)} · L ${fmt(bar.low)} · C ${fmt(bar.close)}`,
   ...(bar.volume>0?[`Vol ${compact(bar.volume)}`]:[]),...labels].join(' · ');
 };
 let current=bars.length-1;
 const show=index=>{current=index;legend.textContent=bars[index]?describe(bars[index]):'';};
 show(current);
 chart.subscribeCrosshairMove(param=>{
  const hit=byDate.get(dayOf(param.time));
  show(hit?hit.index:bars.length-1);
 });

 // Keyboard: arrow keys move the crosshair bar by bar, like the other charts.
 host.tabIndex=0;
 host.setAttribute('role','img');
 host.setAttribute('aria-label',`${payload.symbol} daily candlesticks. Drag or scroll to pan and zoom. Use left and right arrow keys to inspect bars.`);
 host.addEventListener('keydown',event=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  event.preventDefault();
  const next=Math.max(0,Math.min(bars.length-1,current+(event.key==='ArrowLeft'?-1:1)));
  chart.setCrosshairPosition(bars[next].close,bars[next].date,candles);
  show(next);
 });
 host.addEventListener('blur',()=>{chart.clearCrosshairPosition();show(bars.length-1);});

 // Restore a range only when the user set it and the same bars are shown; the chart's own
 // fit and resize changes are not saved.
 const timeScale=chart.timeScale();
 const span=`${bars[0]?.date}:${bars.at(-1)?.date}:${bars.length}`;
 const saved=ranges.get(payload.key);
 if(saved&&saved.span===span)timeScale.setVisibleLogicalRange(saved.range);
 else{ranges.delete(payload.key);timeScale.fitContent();}
 let userMoved=false;
 for(const type of ['pointerdown','wheel','touchstart'])host.addEventListener(type,()=>{userMoved=true;},{passive:true,capture:true});
 timeScale.subscribeVisibleLogicalRangeChange(range=>{if(range&&userMoved)ranges.set(payload.key,{span,range});});

 return {container,dispose:()=>chart.remove()};
}
