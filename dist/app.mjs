import * as ui from './ui.mjs';
import {getApi,sampleData,getPreference,setPreference,normalizeOrigin,isLoopbackOrigin} from './data.mjs';
import {overviewView,chainView,volatilityView,activityView,strategyView,prepareChain,spotOf,expiryList,contractFor,contractDialog,newLeg,applyPreset,downloadChain,patternPicker,defaultPatternIds} from './options.mjs';
import {researchView} from './research.mjs';
import {mountCandleCharts} from './candles.mjs';

const {icon,esc,numeric,fmt,money,signed,dateText,src,value,panel,kv,empty,pill,btn,bindCharts}=ui;
const $=x=>document.getElementById(x);
const labels={overview:'Overview',chain:'Options Chain',volatility:'Volatility',activity:'Activity Screener',strategy:'Strategy Lab',fundamentals:'Fundamentals',events:'Events & News',methods:'Data & methodology'};
const topTabs=['overview','chain','volatility','activity','strategy','fundamentals','events'];
const sections=[['WORKSPACE',['overview','chain','volatility','activity','strategy']],['SECURITY RESEARCH',['fundamentals','events']]];
const base=['quote','history','chain'];
const periodDatasets=new Set(['history','patterns']);
const periods=new Set(['1M','3M','6M','1Y','2Y','5Y']);
const detectorId=/^(?:doji|hammer|engulfing|CDL[A-Z0-9]+)$/;
const onLocalPage=isLoopbackOrigin(location.origin);
const defaultLoopbackOrigin='http://127.0.0.1:8765';
const repoUrl='https://github.com/yestertommorrow-a11y/Trading-Desk';
const launcherZipUrl=`${repoUrl}/releases/latest/download/Strikebook-windows.zip`;
const setupGuideUrl=`${repoUrl}#live-data-on-your-pc`;
const externalLink=(href,text)=>`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const hostedSetup=`<p><b>Live data needs a free helper app on your Windows PC.</b> It fetches the market data; this website only shows it.</p>
 <ol class="setup-steps">
  <li>${externalLink(launcherZipUrl,'Download Strikebook for Windows')} (a ZIP file).</li>
  <li>Open your <b>Downloads</b> folder, right-click the ZIP and choose <b>Extract All</b>, then <b>Extract</b>.</li>
  <li>In the new folder, double-click <b>Start Strikebook.cmd</b>. The first time, it downloads and sets up its data library by itself (about 300 MB, 5–15 minutes; answer <b>Y</b> if it offers to install Python). You don’t install anything else. Then Strikebook opens in your browser with live data. <b>Done.</b></li>
 </ol>
 <p class="note">Keep the black Strikebook window open while you use it. To use <i>this</i> website with live data instead, choose <b>Connect this PC</b> below and click <b>Allow</b> when Chrome or Edge asks. Stuck? See the ${externalLink(setupGuideUrl,'step-by-step guide with fixes')}.</p>`;
const localDashboardLink=`<a class="btn" href="${defaultLoopbackOrigin}/" target="_blank" rel="noopener noreferrer">Open local dashboard</a>`;
const optional={fundamentals:['profile','financials','dividends','fund','holdings','balance','cash','ratios','filings'],events:['profile','dividends','earnings','earnings-calendar','news']};
const symbolRe=/^[A-Z0-9][A-Z0-9.\-/^=]{0,23}$/;
const startSymbol=new URLSearchParams(location.search).get('symbol')?.toUpperCase();
const initialTab=location.hash.slice(1);
const state={symbol:symbolRe.test(startSymbol||'')?startSymbol:'AAPL',tab:Object.hasOwn(labels,initialTab)?initialTab:'overview',mode:'checking',origin:getPreference('bridge',''),bridgeState:null,results:{},rows:[],keys:{},expiry:'',period:'6M',columns:'standard',side:'both',strikeCount:21,minOI:0,minVol:0,activityExpiry:'all',activitySide:'both',activityRatio:.5,activityVolume:100,activityOI:1,scenarioSpot:'',rate:4,divYield:0,scenarioIV:'',scenarioDTE:'',legs:[],watch:getPreference('watch',['AAPL','SPY','QQQ','NVDA','MSFT','IWM']),cache:new Map(),ctrl:null,searchItems:[],selectedSearch:-1,
 historyChart:getPreference('history-chart','line')==='candles'?'candles':'line',
 patternCatalog:null,patternSelection:defaultPatternIds,patternMatchesExpanded:false,patternMatchesHidden:false};
if(!Array.isArray(state.watch))state.watch=[];
state.watch=state.watch.filter(s=>typeof s==='string'&&symbolRe.test(s)).slice(0,25);
let startup=0, connectionAttempt, toastTimer, searchTimer, searchCtrl;
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},3250);}
const quoteRow=()=>state.results.quote?.data?.[0]??{};
const profile=()=>state.results.profile?.data?.[0]??{};
function changeOf(q){const direct=numeric(value(q,'change','price_change','net_change','change_amount','regular_market_change')),previous=numeric(value(q,'prev_close','previous_close','prev_close_price','regular_market_previous_close','close_previous','previous_close_price')),price=numeric(value(q,'price','last_price','last_trade_price','last_sale_price','last_sale')),change=direct??(previous>0&&price!=null?price-previous:null);const raw=numeric(value(q,'change_percent','percent_change','change_pct','regular_market_change_percent'));return {change,pct:previous>0&&change!=null?change/previous*100:state.mode==='sample'?raw:raw==null?null:raw*100};}
function instrumentType(q,p){const x=String(value(q,'asset_type','instrument_type','quote_type','security_type','type')??value(p,'asset_type','instrument_type','quote_type','security_type','type')??'');if(/ETF|exchange.traded fund/i.test(x)||p.is_etf===true||q.is_etf===true||state.results.fund?.ok&&state.results.fund.data?.length)return 'ETF';if(/equity|stock|common/i.test(x))return 'Stock';return x||null;}
function renderInstrument(){const q=quoteRow(),p=profile(),price=spotOf(state),{change,pct}=changeOf(q),watched=state.watch.includes(state.symbol),currency=value(q,'currency')??value(p,'currency')??'USD',exchange=value(q,'exchange','exchange_name','exchange_code')??value(p,'exchange','exchange_name'),name=value(q,'name','company_name','security_name','long_name','short_name')??value(p,'name','company_name','company','long_name')??state.keys[state.symbol]?.name,type=instrumentType(q,p)??state.keys[state.symbol]?.type,meta=state.results.quote?.ok?state.results.quote:state.results.chain;
 const nclass=pct==null||pct===0?'':pct>0?'teal':'red';
 $('instrument').innerHTML=`<div class="instrument-left"><div class="instrument-mark" aria-hidden="true">${esc(state.symbol.slice(0,3))}</div><div><div class="symbol-line"><h1>${esc(state.symbol)}</h1>${type?pill(type):''}${exchange?pill(exchange):''}</div><p>${esc(name||'Security research')}<span class="muted">${name&&currency?' · ':''}${esc(currency)}</span></p></div></div><div class="instrument-right"><div><div class="hero-quote"><strong>${price==null?'—':money(price,currency)}</strong>${pct==null?'':pill(`${change==null?'':signed(change)+' '}${signed(pct)}%`,nclass)}</div><div class="quote-meta">${price==null?(state.mode==='checking'||state.results.quote?.loading?'Awaiting quote…':'No underlying quote'):`${src(meta)}${state.mode==='sample'?' · synthetic':''}${!meta?.asOf?' · timestamp not supplied':''}`}</div></div><div class="instrument-actions"><button type="button" class="btn ${watched?'positive':''}" data-action="watch" aria-pressed="${watched}" aria-label="${watched?'Remove from':'Add to'} watchlist">${icon('star')}<span class="action-label">${watched?'Watching':'Watch'}</span></button></div></div>`;
}
function renderNavigation(){
 $('navigation').innerHTML=sections.map(([title,tabs])=>`<section class="nav-section"><div class="nav-label">${title}</div>${tabs.map(id=>`<button type="button" class="nav-button ${state.tab===id?'active':''}" data-tab="${id}" title="${labels[id]}" ${state.tab===id?'aria-current="page"':''}>${icon(id)}${labels[id]}</button>`).join('')}</section>`).join('');
 $('tabs').innerHTML=topTabs.map(id=>`<button class="tab ${state.tab===id?'active':''}" type="button" data-tab="${id}" ${state.tab===id?'aria-current="page"':''}>${labels[id]}</button>`).join('');
 $('breadcrumb').textContent=labels[state.tab];
 const row=(s)=>state.mode==='sample'?sampleData('quote',s).data?.[0]:s===state.symbol?quoteRow():cacheGet(`${s}|quote`)?.data?.[0];
 $('watchlist').innerHTML=state.watch.map(s=>{const n=changeOf(row(s)).pct;return `<button type="button" class="watch-item ${s===state.symbol?'active':''}" data-symbol="${esc(s)}" title="Research ${esc(s)}"><b>${esc(s)}</b><em class="${n>0?'positive':n<0?'negative':'muted'}">${n==null?'—':signed(n)+'%'}</em></button>`;}).join('')||'<p class="watch-empty">Pin a ticker to build your list.</p>';
}
function renderNotice(){
 const status=$('feed-button'), label=$('feed-label');
 const connectionLost=state.mode==='openbb'&&base.every(key=>state.results[key]?.bridgeError);
 const offline=state.mode==='offline'||connectionLost;
 status.classList.toggle('sample',state.mode==='sample');
 status.classList.toggle('offline',offline);
 label.textContent=state.mode==='checking'?'Checking OpenBB':state.mode==='sample'?'Sample mode':offline?'OpenBB offline':'OpenBB';
 if(state.mode==='sample'){
  const instructions=onLocalPage?'Choose Data connection to use OpenBB.':'For live data, run Strikebook on your PC: choose Data connection for the download and steps.';
  $('notice').innerHTML=`<div class="notice"><span class="notice-dot"></span><span><b>Sample mode.</b> Simulated prices and options for six symbols. ${instructions}</span><button type="button" data-action="connection">Data connection</button></div>`;
 }else if(offline){
  const instructions=state.bridgeState?.error?.message||'Check that Start Strikebook.cmd is running, then reconnect.';
  $('notice').innerHTML=`<div class="notice error"><span class="notice-dot"></span><span><b>OpenBB is disconnected.</b> ${esc(instructions)}</span><button type="button" data-action="connection">Reconnect</button></div>`;
 }else if(state.mode==='openbb'&&base.every(key=>state.results[key]&&!state.results[key].loading&&!state.results[key].ok)){
  $('notice').innerHTML='<div class="notice error"><span class="notice-dot"></span><span><b>OpenBB returned no quote, history, or chain for this symbol.</b> Check the provider messages below or try another ticker.</span><button type="button" data-action="tab:methods">Data status</button></div>';
 }else $('notice').innerHTML='';
}
function methodsView(){const co=state.results;const datasets=Object.keys(co).length?kv(Object.entries(co).map(([k,e])=>[k,e.loading?'Loading…':e.ok?`${src(e)} · ${Array.isArray(e.data)?fmt(e.data.length,0):'—'} rows`:esc(e.error?.message||'Unavailable')])):empty('No datasets loaded','Choose a symbol or connect a feed.');
 return `<div class="methods"><div class="method-grid">${panel('Data connection','Source, coverage and freshness',`<div class="panel-body"><p>Strikebook uses an OpenBB bridge for market data. A source name and its as-of timestamp appear with each dataset when supplied. The fetch time is not the market timestamp, and this interface does not claim a real-time options entitlement.</p>${btn('Manage connection','connection','info')}<p class="row-gap">A blank value means the field was unavailable or could not be calculated. Results depend on provider, security, and exchange.</p></div>`)}${panel('Calculation conventions','Expiry, liquidity and model inputs',`<div class="panel-body"><ul><li>ATM IV uses the nearest available strike; expected move = spot × ATM IV × √(calendar DTE / 365). It is a one-standard-deviation model, not a prediction. Date-only 0DTE has no modeled move.</li><li>Put/call ratios are puts divided by calls. Missing fields are not zeros. Totals describe returned contracts, which may be an incomplete chain.</li><li>Quote midpoint requires two valid sides. Last trade and open interest can be from other sessions. Provider Greeks are shown as supplied.</li><li>Strategy uses European Black–Scholes for indicative prices and Greeks, and explicit premiums for expiration P/L.</li></ul></div>`)}</div><div class="method-grid">${panel('Current dataset status',`${esc(state.symbol)} · ${state.mode==='sample'?'Synthetic example':'Provider results'}`,`<div class="panel-body">${datasets}</div>`)}${panel('Feature coverage','Reference workflows and source documentation',`<div class="panel-body"><p>Market Chameleon inspired the ticker, chain and research workflow. Brokerage execution, classified order flow, trade prints, marketwide scans, stored IV rank and historical option backtests need separate data or systems.</p><ul><li><a href="./coverage.html">Detailed feature-by-feature coverage</a></li><li><a href="https://marketchameleon.com/Learn/SiteFeatures" rel="noopener noreferrer" target="_blank">Market Chameleon public feature guide</a></li><li><a href="https://docs.openbb.co/odp/python/reference/derivatives/options/chains/" rel="noopener noreferrer" target="_blank">OpenBB options chains documentation</a></li><li><a href="https://www.optionseducation.org/advancedconcepts/black-scholes-formula" rel="noopener noreferrer" target="_blank">Options Industry Council: Black–Scholes</a></li></ul></div>`)}</div></div>`;
}
const views={overview:overviewView,chain:chainView,volatility:volatilityView,activity:activityView,strategy:strategyView,fundamentals:s=>researchView('fundamentals',s,ui),events:s=>researchView('events',s,ui),methods:methodsView};
const chartFullscreenDialog=$('chart-fullscreen');
const chartFullscreenContent=$('chart-fullscreen-content');
let fullscreenChart=null;

function setChartFullscreenButton(button, expanded){
 const label=expanded?'Exit fullscreen':'Fullscreen chart';
 button.dataset.action=expanded?'chart-restore':'chart-maximize';
 button.setAttribute('aria-label',label);
 button.title=label;
 button.innerHTML=icon(expanded?'minimize':'maximize');
}

function mountFullscreenPanel(chartPanel){
 const placeholder=document.createElement('div');
 placeholder.setAttribute('aria-hidden','true');
 placeholder.style.height=`${chartPanel.offsetHeight}px`;
 chartPanel.replaceWith(placeholder);
 fullscreenChart.placeholder=placeholder;
 chartFullscreenContent.replaceChildren(chartPanel);
 chartFullscreenDialog.setAttribute('aria-label',chartPanel.querySelector('h2').textContent);
 setChartFullscreenButton($(`chart-maximize-${fullscreenChart.key}`),true);
}

function maximizeChart(trigger){
 const chartPanel=trigger.closest('[data-chart-panel]');
 if(!chartPanel||fullscreenChart)return;
 fullscreenChart={key:chartPanel.dataset.chartPanel,native:false};
 mountFullscreenPanel(chartPanel);
 chartFullscreenDialog.showModal();
 trigger.focus({preventScroll:true});
 if(document.fullscreenEnabled && chartFullscreenContent.requestFullscreen){
  void chartFullscreenContent.requestFullscreen().catch(()=>{});
 }
}

function restoreChart(){
 if(!fullscreenChart)return;
 const {key,placeholder}=fullscreenChart;
 fullscreenChart=null;
 const chartPanel=chartFullscreenContent.firstElementChild;
 const trigger=$(`chart-maximize-${key}`);
 if(placeholder.isConnected){
  placeholder.replaceWith(chartPanel);
  setChartFullscreenButton(trigger,false);
 }else chartPanel.remove();
 if(chartFullscreenDialog.open)chartFullscreenDialog.close();
 const focus=()=>{
  if(!fullscreenChart && !$('dialog').open && trigger.isConnected)trigger.focus({preventScroll:true});
 };
 if(document.fullscreenElement===chartFullscreenContent){
  void document.exitFullscreen().catch(()=>{}).finally(focus);
 }else focus();
}

function renderView(){
 const parent=$('view'),active=document.activeElement,id=active?.id;
 const scroller=parent.querySelector('.table-scroll');
 const scroll=scroller?[scroller.scrollLeft,scroller.scrollTop]:null;
 const chartScroll=fullscreenChart?chartFullscreenContent.scrollTop:0;
 parent.innerHTML=state.mode==='offline'
  ? panel('Market data unavailable','',empty('Reconnect OpenBB','Restore the data connection to continue researching this symbol.'),btn('Reconnect','connection','refresh'))
  : (views[state.tab]||overviewView)(state);
 bindCharts(parent);
 void mountCandleCharts(parent);
 if(fullscreenChart){
  const chartPanel=parent.querySelector(`[data-chart-panel="${fullscreenChart.key}"]`);
  if(chartPanel){
   mountFullscreenPanel(chartPanel);
   chartFullscreenContent.scrollTop=chartScroll;
  }else restoreChart();
 }
 const next=parent.querySelector('.table-scroll');
 if(scroll&&next){next.scrollLeft=scroll[0];next.scrollTop=scroll[1];}
 if(id&&active!==document.activeElement){
  const node=$(id);
  if(node&&(parent.contains(node)||chartFullscreenContent.contains(node)))node.focus({preventScroll:true});
 }
}
// A change event fires before Tab or a click moves focus. Rendering after the move lets
// renderView restore focus to the field the user went to, not the one they left.
let viewRenderPending=false;
function renderViewAfterFocus(){
 if(viewRenderPending)return;
 viewRenderPending=true;
 setTimeout(()=>{viewRenderPending=false;renderView();});
}
function render(){renderInstrument();renderNavigation();renderNotice();renderView();document.title=`${state.symbol} · ${labels[state.tab]} | Strikebook`;}
function replacePath(){const url=new URL(location.href);url.searchParams.set('symbol',state.symbol);url.hash=state.tab;history.replaceState({},'',url);}
// Provider snapshots expire so revisiting a symbol does not show an old quote or chain.
const cacheTtl=key=>key==='quote'||key==='chain'?60_000:300_000;
function cacheGet(cacheKey){
 const entry=state.cache.get(cacheKey);
 if(!entry)return null;
 if(entry.expires<=Date.now()){state.cache.delete(cacheKey);return null;}
 return entry.result;
}
function cachePut(cacheKey,key,result){
 state.cache.delete(cacheKey);
 state.cache.set(cacheKey,{result,expires:state.mode==='sample'?Infinity:Date.now()+cacheTtl(key)});
 if(state.cache.size>110)state.cache.delete(state.cache.keys().next().value);
}
function loadResult(key,{refresh=false}={}){
 const {symbol,ctrl,mode}=state;
 if(!ctrl||mode==='checking'||mode==='offline')return;
 const period=periodDatasets.has(key)?state.period:null;
 const detectors=key==='patterns'&&state.patternCatalog ? state.patternSelection.join(',')||'none' : null;
 const cacheKey=[symbol,key,period,detectors].filter(part=>part!==null).join('|');
 const active=state.results[key];
 if(!refresh){
  const cached=cacheGet(cacheKey);
  if(cached){state.results[key]=cached;return;}
  if(active?.loading&&active.cacheKey===cacheKey)return;
  if(!period&&active)return;
 }
 if(mode==='sample'){
  state.results[key]=sampleData(key,symbol);
  cachePut(cacheKey,key,state.results[key]);
  return;
 }
 const request={loading:true,data:[],cacheKey};
 state.results[key]=request;
 const params={symbol,period,detectors,...(refresh?{refresh:1}:{})};
 getApi(key,params,state.origin,ctrl.signal).then(result=>{
  if(ctrl.signal.aborted||state.results[key]!==request||(period&&state.period!==period))return;
  state.results[key]=result;
  if(result.ok)cachePut(cacheKey,key,result);
  if(key==='chain')prepareChain(state);
  refreshRender();
 }).catch(error=>{if(!ctrl.signal.aborted)console.error(error);});
}
function loadTabData({refresh=false}={}){
 for(const key of optional[state.tab]??[])loadResult(key,{refresh});
 if(state.tab==='overview'&&state.historyChart==='candles')loadResult('patterns',{refresh});
}
let scheduled=false;function refreshRender(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;render();});}
function startSymbolLoad({reset=true,refresh=false}={}){state.ctrl?.abort();state.ctrl=new AbortController();state.results={};state.rows=[];if(reset){state.expiry='';state.legs=[];state.scenarioSpot='';}for(const key of base)loadResult(key,{refresh});loadTabData({refresh});prepareChain(state);render();}
function tabTo(tab){if(!Object.hasOwn(labels,tab))return;const changed=state.tab!==tab;state.tab=tab;loadTabData();replacePath();render();if(changed)window.scrollTo(0,0);document.querySelector('.sidebar').classList.remove('open');$('mobile-menu').setAttribute('aria-expanded','false');}
function choose(item){const obj=typeof item==='string'?{symbol:item}:item;const s=String(obj?.symbol??'').trim().toUpperCase();if(!symbolRe.test(s))return toast('Enter a valid exchange ticker.');if(obj.name||obj.type)state.keys[s]={name:obj.name,type:obj.type};const changed=s!==state.symbol;state.symbol=s;$('symbol-search').value='';closeSearch();if(changed){startSymbolLoad();replacePath();window.scrollTo(0,0);}else render();}
function applyConnection(mode,status){
 startup++;
 searchCtrl?.abort();
 state.mode=mode;
 state.bridgeState=status;
 const catalog=status?.data?.pattern_catalog;
 state.patternCatalog=Array.isArray(catalog) ? catalog.filter(item=>
  typeof item?.id==='string'&&detectorId.test(item.id)&&typeof item.label==='string'&&typeof item.available==='boolean'
 ) : null;
 const preferred=getPreference('candlestick-patterns',defaultPatternIds);
 const selection=Array.isArray(preferred)?preferred:defaultPatternIds;
 state.patternSelection=state.patternCatalog
  ? state.patternCatalog.filter(item=>selection.includes(item.id)).map(item=>item.id)
  : defaultPatternIds;
 state.cache.clear();
 startSymbolLoad();
}

async function checkBridge(origin,signal){
 const status=await getApi('status',{},origin,signal);
 if(status.ok&&status.data?.connected===false){
  return {...status,ok:false,error:{message:'Strikebook is running, but its data library (OpenBB) isn’t installed yet. Close the black Strikebook window and double-click Start Strikebook.cmd again; it finishes the setup.'}};
 }
 if(status.ok&&status.data&&typeof status.data.backend==='string')return status;
 if(onLocalPage)return {ok:false,error:{message:'Strikebook stopped answering. Check that the black Strikebook window is still open. If you closed it, double-click Start Strikebook.cmd again, then reconnect.'}};
 if(isLoopbackOrigin(origin))return {ok:false,error:{message:await loopbackHelp()}};
 return {ok:false,error:{message:'This address did not return a Strikebook bridge status. Check the HTTPS address and its browser access settings.'}};
}

// Explain, in plain words, why a hosted page could not reach Strikebook on this PC.
async function loopbackHelp(){
 const ua=navigator.userAgent;
 if(/Firefox\//.test(ua)||(/Safari\//.test(ua)&&!/Chrome\/|Chromium\/|Edg\//.test(ua))){
  return 'This browser can’t let websites talk to apps on your PC. Click “Open local dashboard” below instead (it has live data), or use Chrome or Edge.';
 }
 let permission='';
 for(const name of ['loopback-network','local-network-access','local-network']){
  try{permission=(await navigator.permissions.query({name})).state;break;}catch{}
 }
 if(permission==='denied'){
  return 'Your browser is blocking this website from reaching Strikebook on your PC. Click the icon at the left of the address bar, open Site settings, set “Local network access” to Allow, reload this page and try again. Or click “Open local dashboard” below.';
 }
 return 'Can’t find Strikebook on this PC. 1) Is the black Strikebook window open? If not, double-click Start Strikebook.cmd and wait until your browser opens Strikebook. 2) Downloaded before 24 Nov 2026? Download it again; older copies can’t connect to this website. 3) Still stuck? Click “Open local dashboard” below; it always works while the window is open.';
}

async function detect(preferred='auto'){
 if(preferred==='sample'||(!onLocalPage&&!state.origin)){
  // Older hosted releases saved OpenBB mode even with no address to connect to.
  if(preferred==='openbb')setPreference('preferred-mode','auto');
  applyConnection('sample',null);
  return;
 }

 const seq=++startup;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 state.ctrl?.abort();
 state.mode='checking';
 state.results={};
 state.rows=[];
 render();
 let status;
 try{
  status=await checkBridge(state.origin,controller.signal);
 }catch{
  status={ok:false,error:{message:'The connection check timed out. Open Data connection to retry.'}};
 }finally{
  clearTimeout(timeout);
 }
 if(seq===startup)applyConnection(status.ok?'openbb':'offline',status);
}
function openDialog(title,body){$('dialog-content').innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-btn" type="button" aria-label="Close dialog" data-action="close">${icon('x')}</button></div><div class="dialog-body">${body}</div>`;if(!$('dialog').open)$('dialog').showModal();}
const detectorInputs=form=>[...form.querySelectorAll('input[name="detector"]')];
function updatePatternCount(form){
 const count=$('pattern-picker-count');
 if(count)count.textContent=`${detectorInputs(form).filter(input=>input.checked).length} selected`;
}
function filterPatternOptions(input){
 const terms=input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
 let found=false;
 for(const option of input.form.querySelectorAll('[data-pattern-option]')){
  const searchable=`${option.textContent} ${option.querySelector('input')?.value??''}`.toLowerCase();
  option.hidden=!terms.every(term=>searchable.includes(term));
  found ||= !option.hidden;
 }
 const empty=$('pattern-picker-empty');
 if(empty)empty.hidden=found;
}
function resetPatternDraft(form,selection){
 for(const input of detectorInputs(form))input.checked=selection.includes(input.value);
 updatePatternCount(form);
}
function savePatternSelection(form){
 if(!state.patternCatalog)return;
 const checked=new Set(detectorInputs(form).filter(input=>input.checked).map(input=>input.value));
 const selection=state.patternCatalog.filter(item=>checked.has(item.id)).map(item=>item.id);
 $('dialog').close();
 if(selection.join(',')===state.patternSelection.join(','))return;
 state.patternSelection=selection;
 setPreference('candlestick-patterns',selection);
 loadTabData();
 renderView();
 $('candle-pattern-picker')?.focus({preventScroll:true});
}
function connection(){
 connectionAttempt?.abort();
 const instructions=onLocalPage
  ?'<p>Leave the address blank to use the bridge started by this launcher.</p>'
  :hostedSetup;
 const placeholder=onLocalPage?'This dashboard’s address':defaultLoopbackOrigin;
 openDialog('Data connection',`${instructions}
  ${state.bridgeState?.error?.message?`<p class="negative">${esc(state.bridgeState.error.message)}</p>`:''}
  <form id="bridge-form">
   <label class="control" for="bridge-origin">Bridge address<input class="field text-field" id="bridge-origin" type="url" placeholder="${placeholder}" value="${esc(state.origin)}"></label>
   <p id="bridge-message" role="status" class="note"></p>
   <p id="bridge-error" role="alert" class="negative"></p>
   <div class="dialog-buttons"><button class="btn primary-btn" type="submit">${onLocalPage?'Connect OpenBB':'Connect bridge'}</button>${onLocalPage?'':btn('Connect this PC','connect-local')}${btn('Use sample mode','sample-mode')}${onLocalPage?'':localDashboardLink}</div>
  </form>`);
}

async function submitConnection(form){
 const feedback=form.querySelector('#bridge-error');
 const message=form.querySelector('#bridge-message');
 let origin;
 try{
  origin=normalizeOrigin(form.querySelector('#bridge-origin').value);
  if(!onLocalPage&&!origin)throw new Error('Enter a bridge address, or run the Windows launcher and choose Connect this PC.');
 }catch(error){
  feedback.textContent=error.message;
  return;
 }

 connectionAttempt?.abort();
 const controller=new AbortController();
 connectionAttempt=controller;
 const timeout=setTimeout(()=>controller.abort('timeout'),45000);
 const controls=[...form.querySelectorAll('button[type=submit], [data-action=connect-local]')];
 controls.forEach(control=>{control.disabled=true;});
 feedback.textContent='';
 message.textContent='Connecting…';
 // A pending browser permission prompt holds the request; tell the user where to look.
 const hint=isLoopbackOrigin(origin)&&!onLocalPage?setTimeout(()=>{if(connectionAttempt===controller)message.textContent='Still connecting… If your browser shows a pop-up near the address bar asking to access devices on your local network, click Allow.';},2500):0;
 try{
  const status=await checkBridge(origin,controller.signal);
  if(controller.signal.aborted||!form.isConnected||!$('dialog').open)return;
  if(!status.ok){feedback.textContent=status.error.message;return;}
  state.origin=origin;
  setPreference('bridge',origin);
  setPreference('preferred-mode','openbb');
  $('dialog').close();
  applyConnection('openbb',status);
 }catch{
  if(controller.signal.reason==='timeout'&&form.isConnected)feedback.textContent='No answer after 45 seconds. If your browser asked about local network access, click Allow. Check that the black Strikebook window is open, then click Connect this PC again.';
 }finally{
  clearTimeout(timeout);
  clearTimeout(hint);
  if(connectionAttempt===controller){
   connectionAttempt=null;
   message.textContent='';
   controls.forEach(control=>{control.disabled=false;});
  }
 }
}
function closeSearch(){$('search-results').hidden=true;$('symbol-search').setAttribute('aria-expanded','false');$('symbol-search').removeAttribute('aria-activedescendant');state.selectedSearch=-1;}
function showResults(items,query){state.searchItems=items;state.selectedSearch=-1;const el=$('search-results');el.innerHTML=items.map((r,i)=>`<button type="button" role="option" id="search-item-${i}" aria-selected="false" data-search-index="${i}"><b>${esc(r.symbol)}</b><span>${esc(r.name??'Look up exact ticker')}</span>${r.type?`<small>${esc(r.type)}</small>`:''}</button>`).join('')||`<p class="search-hint">${query?'No matches. You can enter an exact exchange ticker.':'Enter a ticker or company name.'}</p>`;el.hidden=false;$('symbol-search').setAttribute('aria-expanded','true');}
async function performSearch(query){searchCtrl?.abort();searchCtrl=new AbortController();const q=query.trim(), exact=q.toUpperCase(), c=searchCtrl;let items;if(!q){showResults(state.watch.map(s=>({symbol:s,name:'Watchlist'})),q);return;}if(state.mode==='sample')items=sampleData('search',q).data;else if(state.mode!=='openbb')items=[];else{if(symbolRe.test(exact))showResults([{symbol:exact,name:'Look up exact ticker'}],q);const res=await getApi('search',{q},state.origin,c.signal).catch(()=>null);if(!res||c.signal.aborted||$('symbol-search').value.trim()!==q||document.activeElement!==$('symbol-search'))return;items=res.data;}
 const normalized=(Array.isArray(items)?items:[]).map(r=>({symbol:String(value(r,'symbol','ticker')??'').toUpperCase(),name:value(r,'name','company_name','security_name','security','long_name'),type:instrumentType(r,r)})).filter(x=>symbolRe.test(x.symbol));const unique=[...new Map(normalized.map(x=>[x.symbol,x])).values()];if(symbolRe.test(exact)&&!normalized.some(r=>r.symbol===exact))unique.unshift({symbol:exact});else unique.sort((a,b)=>Number(b.symbol===exact)-Number(a.symbol===exact));showResults(unique.slice(0,12),q);}
document.addEventListener('click',e=>{const target=e.target.closest('button,a');if(!$('search-form').contains(e.target))closeSearch();if(!target)return;const {tab,symbol,contract,addContract,action,searchIndex}=target.dataset;
 if(tab){tabTo(tab);return;}if(symbol){choose(symbol);return;}if(searchIndex!=null){choose(state.searchItems[Number(searchIndex)]);return;}
 if(contract){const r=contractFor(state,contract);if(r){const d=contractDialog(state,r);openDialog(d.title,d.html);}return;}
 if(addContract){const r=contractFor(state,addContract);if(r?.adjusted){toast('This series may have a nonstandard deliverable. Strategy Lab models standard contracts.');return;}if(r&&state.legs.length<12){state.legs.push(newLeg(state,{side:r.side,strike:r.strike,premium:r.mid??'',expiration:r.expiration,multiplier:r.multiplier??100}));$('dialog').close();tabTo('strategy');toast('Contract added to Strategy Lab.');}return;}
 if(!action)return;
 if(action.startsWith('tab:'))tabTo(action.slice(4));
 else if(action==='chart-maximize')maximizeChart(target);
 else if(action==='chart-restore')restoreChart();
 else if(action==='pattern-matches-toggle'||action==='pattern-matches-disclose'){
  if(action==='pattern-matches-toggle')state.patternMatchesExpanded=!state.patternMatchesExpanded;
  else state.patternMatchesHidden=!state.patternMatchesHidden;
  renderView();
  $(target.id)?.focus({preventScroll:true});
 }
 else if(action==='watch'){state.watch=state.watch.includes(state.symbol)?state.watch.filter(s=>s!==state.symbol):[state.symbol,...state.watch].slice(0,25);setPreference('watch',state.watch);render();toast(state.watch.includes(state.symbol)?'Added to watchlist.':'Removed from watchlist.');}
 else if(action==='connection')connection();
 else if(action==='pattern-picker'&&state.patternCatalog){
  openDialog('Choose candlestick patterns',patternPicker(state));
  $('pattern-picker-search')?.focus();
 }
 else if(action==='pattern-defaults'||action==='pattern-clear'){
  const form=$('pattern-picker-form');
  if(form)resetPatternDraft(form,action==='pattern-defaults'?defaultPatternIds:[]);
 }
 else if(action==='close')$('dialog').close();
 else if(action==='sample-mode'){$('dialog').close();setPreference('preferred-mode','sample');applyConnection('sample',null);}
 else if(action==='connect-local'){
  const input=$('bridge-origin');
  if(input){input.value=defaultLoopbackOrigin;void submitConnection(input.form);}
 }
 else if(action==='export-chain'){if(!downloadChain(state))toast('No contracts match the selected filters.');}
 else if(action==='add-leg'){if(state.legs.length<12){state.legs.push(newLeg(state));renderView();}else toast('Strategy Lab supports 12 legs.');}
 else if(action.startsWith('remove-leg:')){state.legs.splice(Number(action.split(':')[1]),1);renderView();}
 else if(action.startsWith('preset:')){applyPreset(state,action.split(':')[1]);renderView();}
 else if(action==='history-chart:line'||action==='history-chart:candles'){
  state.historyChart=action.slice('history-chart:'.length);
  setPreference('history-chart',state.historyChart);
  loadTabData();
  renderView();
 }
 else if(action.startsWith('period:')){
  const period=action.slice('period:'.length);
  if(!periods.has(period)||period===state.period)return;
  state.period=period;
  loadResult('history');
  loadTabData();
  renderView();
 }
});
document.addEventListener('change',e=>{
 const el=e.target;
 if(el.name==='detector'&&el.form?.id==='pattern-picker-form'){updatePatternCount(el.form);return;}
 const keys={expiry:'expiry','strike-count':'strikeCount','chain-columns':'columns','chain-side':'side','min-vol':'minVol','min-oi':'minOI','activity-expiry':'activityExpiry','activity-side':'activitySide','activity-volume':'activityVolume','activity-oi':'activityOI','activity-ratio':'activityRatio','scenario-spot':'scenarioSpot','scenario-rate':'rate','scenario-yield':'divYield','scenario-iv':'scenarioIV','scenario-dte':'scenarioDTE'};const key=keys[el.id];if(key){state[key]=el.type==='number'?(el.value===''&&el.id.startsWith('scenario-')?'':Math.max(el.min===''?-Infinity:Number(el.min),numeric(el.value)??0)):el.id==='strike-count'?Number(el.value):el.value;if(el.id==='strike-count'&&state.tab==='overview'){tabTo('chain');return;}renderViewAfterFocus();return;}const leg=/^leg-(action|side|expiration|strike|premium|quantity|multiplier)-(\d+)$/.exec(el.id);if(leg&&state.legs[+leg[2]]){state.legs[+leg[2]][leg[1]]=el.value;renderViewAfterFocus();}
});
document.addEventListener('input',e=>{
 if(e.target.id==='pattern-picker-search')filterPatternOptions(e.target);
});
document.addEventListener('submit',e=>{
 if(e.target.id==='pattern-picker-form'){e.preventDefault();savePatternSelection(e.target);return;}
 if(e.target.id==='bridge-form'){e.preventDefault();void submitConnection(e.target);return;}
 if(e.target.id==='search-form'){e.preventDefault();const selected=state.searchItems[state.selectedSearch];const q=$('symbol-search').value.trim();if(selected)choose(selected);else if(symbolRe.test(q.toUpperCase()))choose(q);else if(state.searchItems.length===1)choose(state.searchItems[0]);else {performSearch(q);toast('Choose a matching ticker from the search results.');}}
});
$('dialog').addEventListener('close',()=>{if(!$('dialog').open)connectionAttempt?.abort();});
chartFullscreenDialog.addEventListener('close',()=>{
 if(!chartFullscreenDialog.open)restoreChart();
});
document.addEventListener('fullscreenchange',()=>{
 if(document.fullscreenElement===chartFullscreenContent){
  if(fullscreenChart)fullscreenChart.native=true;
  else void document.exitFullscreen().catch(()=>{});
 }else if(fullscreenChart?.native)restoreChart();
});
$('symbol-search').addEventListener('input',e=>{clearTimeout(searchTimer);const q=e.target.value;searchTimer=setTimeout(()=>void performSearch(q),200);});
$('symbol-search').addEventListener('focus',e=>void performSearch(e.target.value));
$('symbol-search').addEventListener('keydown',e=>{if(e.key==='Escape'){closeSearch();return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=state.searchItems.length;if(!n)return;state.selectedSearch=(state.selectedSearch+(e.key==='ArrowDown'?1:-1)+n)%n;$('search-results').querySelectorAll('button').forEach((node,i)=>node.setAttribute('aria-selected',String(i===state.selectedSearch)));const sel=$('search-item-'+state.selectedSearch);if(sel){e.target.setAttribute('aria-activedescendant',sel.id);sel.scrollIntoView({block:'nearest'});}}});
$('focus-search').addEventListener('click',()=>$('symbol-search').focus());
$('feed-button').addEventListener('click',connection);
$('refresh').addEventListener('click',()=>{if(state.mode==='checking')return;if(state.mode==='offline'){connection();return;}state.cache.clear();startSymbolLoad({reset:false,refresh:true});toast(state.mode==='sample'?'Sample workspace reloaded.':'Refreshing provider data.');});
$('mobile-menu').addEventListener('click',()=>{const on=document.querySelector('.sidebar').classList.toggle('open');$('mobile-menu').setAttribute('aria-expanded',String(on));});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!$('dialog').open){e.preventDefault();$('symbol-search').focus();}});
window.addEventListener('hashchange',()=>{const t=location.hash.slice(1);if(Object.hasOwn(labels,t)&&t!==state.tab)tabTo(t);});
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
try{state.origin=normalizeOrigin(state.origin);}catch{state.origin='';setPreference('bridge','');}
void detect(getPreference('preferred-mode','auto'));
