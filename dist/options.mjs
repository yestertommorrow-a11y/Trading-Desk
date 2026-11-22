import {normalizeChain,chainSummary,expirySummaries,skewSeries,skew25Delta,unusualActivity,blackScholes,expiryPayoff,modelScenario,probabilityOfProfit,gammaExposure,maxPain,ivSurface,toCsv,optionFamily} from './analytics.mjs';
import {esc,numeric,fmt,money,pct,compact,signed,dateText,src,value,panel,kv,empty,table,pill,btn,select,field,metric,chart,barChart,compactMoney,chartLegend,candlestickChart,icon} from './ui.mjs';
import {candlePayload} from './candles.mjs';

export const expiryList=(state)=>[...new Set(state.rows.map(r=>r.expiration))].sort();
export const chainAsOf=(state)=>state.results.chain?.asOf||state.results.quote?.asOf||new Date().toISOString();
export function spotOf(state){const q=state.results.quote?.data?.[0];return numeric(value(q,'price','last_price','last_trade_price','last','regular_market_price','close','last_sale_price','last_sale'))??numeric(value(state.results.chain?.meta,'current_price','underlying_price','price'));}
const chainSpotOf=(state)=>numeric(value(state.results.chain?.meta,'current_price','underlying_price','price'))??spotOf(state);
export const summaryOf=(state,expiry=state.expiry)=>chainSummary(state.rows,{spot:chainSpotOf(state),asOf:chainAsOf(state),expiry});
export const ivPct=(v)=>pct(numeric(v)==null?null:v*100,1);
const numWhole=n=>fmt(n,0);
const mass=(v)=>numeric(v)==null?'—':compact(v);
const amount=(c)=>numeric(c)==null?'—':fmt(c,2);
const tone=(v)=>numeric(v)==null||v===0?'muted':v>0?'positive':'negative';
const historyData=(state)=>Array.isArray(state.results.history?.data)?state.results.history.data.map(r=>({date:value(r,'date','timestamp','time'),close:numeric(value(r,'close','adj_close','adjusted_close','price'))})).filter(r=>r.date&&r.close>0).sort((a,b)=>String(a.date).localeCompare(String(b.date))):[];
const hv=(history,n)=>{const tails=history.slice(-n-1);if(tails.length<n+1||n<2)return null;const ret=tails.slice(1).map((p,i)=>Math.log(p.close/tails[i].close)),avg=ret.reduce((a,b)=>a+b,0)/n;return Math.sqrt(ret.reduce((a,b)=>a+(b-avg)**2,0)/(n-1)*252)*100;};
export function prepareChain(state){state.rows=normalizeChain(state.results.chain??[]);const dates=expiryList(state);if(!dates.includes(state.expiry))state.expiry=dates.find(e=>e>=String(chainAsOf(state)).slice(0,10))||dates[0]||'';}
function noData(state,key,title){const e=state.results[key];return !e||e?.loading?empty(`Loading ${title.toLowerCase()}…`,'Waiting on OpenBB.') :empty(`No ${title.toLowerCase()} available`,e.error?.message||'The source did not return any usable rows for this symbol.');}
const historyLimits = {'1M':22, '3M':66, '6M':132, '1Y':253, '2Y':505, '5Y':1261};
const candlePatterns = {
  doji: {neutral: {label:'Doji', variant:'doji'}},
  hammer: {bullish: {label:'Hammer', variant:'hammer'}},
  engulfing: {
    bullish: {label:'Bullish Engulfing', variant:'bullish'},
    bearish: {label:'Bearish Engulfing', variant:'bearish'},
  },
};
const defaultPatterns = {
  doji: {label:'Doji', code:'CDLDOJI'},
  hammer: {label:'Hammer', code:'CDLHAMMER'},
  engulfing: {label:'Engulfing', code:'CDLENGULFING'},
};
export const defaultPatternIds = Object.keys(defaultPatterns);
const directionMarkers = {
  neutral: {label:'Neutral', variant:'doji'},
  bullish: {label:'Bullish', variant:'bullish'},
  bearish: {label:'Bearish', variant:'bearish'},
};
const marketDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit',
});

function candleCatalog(state) {
  const rows = Array.isArray(state.patternCatalog) ? state.patternCatalog : [];
  return new Map(rows.filter(row => typeof row?.id === 'string' && typeof row.label === 'string')
    .map(row => [row.id,row]));
}

function patternSelection(state) {
  return Array.isArray(state.patternSelection) ? state.patternSelection : defaultPatternIds;
}

export function patternPicker(state) {
  const catalog = [...candleCatalog(state).values()];
  const selected = new Set(patternSelection(state));
  const options = catalog.map(({id,label,available}) => {
    const code = Object.hasOwn(defaultPatterns,id) ? defaultPatterns[id].code : id;
    return `<label class="pattern-option${available?'':' unavailable'}" data-pattern-option>
      <input type="checkbox" name="detector" value="${esc(id)}"${selected.has(id)?' checked':''}${available?'':' disabled'}>
      <span class="pattern-option-name">${esc(label)} <code>${esc(code)}</code></span>
      ${available?'':'<span class="pattern-option-status">Unavailable</span>'}
    </label>`;
  });
  const unavailable = catalog.some(option => !option.available);
  const checkedCount = catalog.filter(option => selected.has(option.id)).length;
  return `<form id="pattern-picker-form" class="pattern-picker">
    <label class="pattern-picker-search" for="pattern-picker-search">Search patterns
      <input id="pattern-picker-search" type="search" class="field" placeholder="Name or TA-Lib code" autocomplete="off">
    </label>
    ${unavailable?'<p>To unlock unavailable patterns, follow the TA-Lib setup in the Windows package’s README and restart Strikebook.</p>':''}
    <div class="pattern-picker-list" role="group" aria-label="Candlestick detectors" tabindex="0">${options.join('')}</div>
    <p id="pattern-picker-empty" role="status" hidden>No patterns match your search.</p>
    <div class="dialog-buttons pattern-picker-actions">
      ${btn('Defaults','pattern-defaults')}${btn('Clear','pattern-clear')}
      <span id="pattern-picker-count" role="status">${numWhole(checkedCount)} selected</span>
      <button type="submit" class="btn primary-btn">Apply</button>
    </div>
  </form>`;
}

function rangePicker(state) {
  const buttons = Object.keys(historyLimits).map(period =>
    `<button type="button" id="history-period-${period}" data-action="period:${period}" aria-pressed="${state.period===period}" class="${state.period===period?'active':''}">${period}</button>`);
  return `<div class="seg" role="group" aria-label="Price chart period">${buttons.join('')}</div>`;
}

function historyControls(state, chartMode) {
  const views = [['line','Line'],['candles','Candlesticks']];
  const buttons = views.map(([key,label]) =>
    `<button type="button" id="history-chart-${key}" data-action="history-chart:${key}" aria-pressed="${chartMode===key}" class="${chartMode===key?'active':''}">${label}</button>`);
  return `<div class="history-controls"><div class="seg" role="group" aria-label="Price chart type">${buttons.join('')}</div>${rangePicker(state)}</div>`;
}

function barDate(row) {
  const raw = value(row,'date','timestamp','time');
  if (typeof raw !== 'string') return null;
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(raw)?.[1];
  if (!day) return null;
  const midnight = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0,10) === day ? day : null;
}

function candlePrice(row, key) {
  const price = row?.[key];
  if (typeof price === 'number' || typeof price === 'string' && price.trim()) return numeric(price);
  return null;
}

function marketDateToday() {
  const parts = Object.fromEntries(marketDateFormatter.formatToParts(new Date()).map(part => [part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validCandles(rows, suppliedCompletedBars) {
  if (!Array.isArray(rows)) return [];
  // Without the server's session check, exclude the current New York day.
  const currentDay = suppliedCompletedBars ? null : marketDateToday();
  const bars = new Map();
  const conflictingDates = new Set();
  for (const row of rows) {
    const date = barDate(row);
    if (!date || currentDay && date >= currentDay) continue;
    const [open,high,low,close] = ['open','high','low','close'].map(key => candlePrice(row,key));
    if ([open,high,low,close].some(price => price == null || price <= 0)) continue;
    if (low > Math.min(open,close) || high < Math.max(open,close)) continue;
    const existing = bars.get(date);
    if (existing && (existing.open !== open || existing.high !== high || existing.low !== low || existing.close !== close)) {
      conflictingDates.add(date);
    } else {
      bars.set(date,{date,open,high,low,close});
    }
  }
  return [...bars.values()].filter(bar => !conflictingDates.has(bar.date)).sort((a,b) => a.date.localeCompare(b.date));
}

function candleMatches(result, bars, catalog, selected) {
  const availableDates = new Set(bars.map(bar => bar.date));
  const byDate = new Map();
  if (!result?.ok || !Array.isArray(result.data)) return byDate;
  for (const match of result.data) {
    if (!availableDates.has(match?.date) || !selected.has(match.pattern) || !Object.hasOwn(directionMarkers,match.direction)) continue;
    const core = Object.hasOwn(candlePatterns,match.pattern) ? candlePatterns[match.pattern][match.direction] : null;
    const detector = catalog.get(match.pattern);
    if (!core && !detector) continue;
    const [label,variant] = core ? [core.label,core.variant]
      : [`${detector.label} (${match.direction})`,directionMarkers[match.direction].variant];
    const matches = byDate.get(match.date) ?? [];
    if (!matches.some(entry => entry.pattern === match.pattern && entry.direction === match.direction)) {
      matches.push({pattern:match.pattern,direction:match.direction,label,variant});
    }
    byDate.set(match.date,matches);
  }
  return byDate;
}

function markersByDate(matchesByDate) {
  return new Map([...matchesByDate].map(([date,matches]) => {
    const byVariant = new Map();
    for (const {variant,label} of matches) {
      const labels = byVariant.get(variant) ?? [];
      labels.push(label);
      byVariant.set(variant,labels);
    }
    return [date,[...byVariant].map(([variant,labels]) => ({variant,label:labels.join(' · ')}))];
  }));
}

function displayPatternList(names) {
  const labels = names.slice(0,3).join(', ');
  return names.length > 3 ? `${labels} and ${numWhole(names.length - 3)} more` : labels;
}

function patternSummary(state, result, matchesByDate, catalog) {
  const meta = result?.meta ?? {};
  const selected = patternSelection(state);
  const canChoose = state.mode === 'openbb' && catalog.size > 0;
  let content;
  if (state.mode === 'sample') {
    content = '<p>These are simulated candles. Connect to OpenBB to check for patterns.</p>';
  } else if (canChoose && !selected.length) {
    content = '<p>Pattern detection is off. Choose patterns to check completed daily bars.</p>';
  } else if (!result || result.loading) {
    content = '<p>Checking completed daily bars…</p>';
  } else if (!result.ok) {
    const message = result.error?.message;
    if (typeof message === 'string' && /^Unknown data endpoint\.?$/i.test(message.trim())) {
      content = '<p><strong>The running Strikebook bridge predates candlestick detection.</strong> Close its command window, run the updated <strong>Start Strikebook.cmd</strong>, and open the address it prints.</p>';
    } else {
      content = `<p><strong>Pattern detection unavailable.</strong> ${esc(message || 'OpenBB did not return a pattern analysis.')}</p>`;
    }
  } else if (meta.status === 'disabled') {
    content = '<p>Pattern detection is off. Choose patterns to check completed daily bars.</p>';
  } else if (meta.status === 'unavailable') {
    content = '<p><strong>Selected detectors are unavailable.</strong> Choose available patterns or install TA-Lib.</p>';
  } else if (meta.status === 'insufficient_history') {
    content = '<p><strong>Insufficient history.</strong> The feed has too few eligible daily bars for the selected patterns.</p>';
  } else {
    const recent = [...matchesByDate].sort(([a],[b]) => b.localeCompare(a))
      .flatMap(([date,matches]) => matches.map(match => ({...match,date})));
    if (recent.length) {
      const previewLimit = 6;
      const canExpand = recent.length > previewLimit;
      const hidden = state.patternMatchesHidden === true;
      const expanded = canExpand && state.patternMatchesExpanded === true;
      const visible = hidden ? [] : expanded ? recent : recent.slice(0,previewLimit);
      const count = numWhole(recent.length);
      const rows = visible.map(match =>
        `<li><span class="candle-key ${match.variant}" aria-hidden="true"></span><span>${esc(match.label)}</span><time datetime="${match.date}">${dateText(match.date,'full')}</time></li>`);
      const caption = canExpand && !expanded && !hidden
        ? `Latest ${previewLimit} of ${count} matches`
        : `${count} ${recent.length===1?'match':'matches'} in this range`;
      const toggle = canExpand && !hidden
        ? `<button type="button" id="candle-matches-toggle" class="btn candle-signals-toggle" data-action="pattern-matches-toggle" aria-expanded="${expanded}" aria-controls="candle-pattern-matches">${expanded?'Show fewer matches':`Show all ${count} matches`}</button>`
        : '';
      content = `<div class="candle-signals-actions">
          <p>${caption}</p>${toggle}
          <button type="button" id="candle-matches-disclosure" class="btn candle-signals-toggle" data-action="pattern-matches-disclose" aria-expanded="${!hidden}" aria-controls="candle-pattern-matches">${hidden?'Show matches':'Hide matches'}</button>
        </div>
        <ul id="candle-pattern-matches" class="candle-signals${expanded?' candle-signals-expanded':''}" role="list" aria-label="Pattern matches, newest first"${hidden?' hidden':expanded?' tabindex="0"':''}>${rows.join('')}</ul>`;
    } else {
      content = '<p>No selected patterns detected in this range.</p>';
    }
  }
  if (result?.ok && meta.status !== 'disabled') {
    for (const [status,message] of [['insufficient_history','Insufficient history for'],['unavailable','Detector unavailable for']]) {
      if (meta.status === status) continue;
      const labels = selected.filter(id => Object.hasOwn(meta.patterns ?? {},id) && meta.patterns[id]?.status === status)
        .map(id => catalog.get(id)?.label ?? (Object.hasOwn(defaultPatterns,id) ? defaultPatterns[id].label : id));
      if (labels.length) content += `<p>${message} ${esc(displayPatternList(labels))}.</p>`;
    }
    if (state.mode === 'openbb' && !canChoose) {
      content += '<p>To choose more detectors, close the running bridge and use the updated <strong>Start Strikebook.cmd</strong>.</p>';
    }
  }
  const engine = result?.ok && typeof meta.engine === 'string' ? `<span class="candle-pattern-engine">${esc(meta.engine)}</span>` : '';
  const picker = canChoose
    ? '<button type="button" class="btn" id="candle-pattern-picker" data-action="pattern-picker" aria-haspopup="dialog">Choose patterns</button>'
    : '';
  return `<section class="candle-patterns" aria-label="Candlestick patterns"><div class="candle-patterns-head"><h3>Patterns</h3>${engine}${picker}</div>${content}</section>`;
}

function patternLegend(result, selected, catalog) {
  if (!result?.ok || ['disabled','unavailable','insufficient_history'].includes(result.meta?.status)) return '';
  const extraDetectors = selected.some(id => !Object.hasOwn(candlePatterns,id) && catalog.get(id)?.available);
  const active = selected.filter(id => Object.hasOwn(candlePatterns,id));
  const keys = extraDetectors
    ? [...Object.values(directionMarkers), ...(active.includes('hammer') ? [candlePatterns.hammer.bullish] : [])]
    : active.flatMap(id => Object.values(candlePatterns[id]));
  return keys.map(({label,variant}) => `<span><i class="candle-key ${variant}" aria-hidden="true"></i>${esc(label)}</span>`).join('');
}

function candleHistory(state, limit) {
  const history = state.results.history;
  const result = state.results.patterns;
  const catalog = candleCatalog(state);
  const selected = patternSelection(state);
  const suppliedCompletedBars = result?.ok && Array.isArray(result.meta?.bars);
  const source = suppliedCompletedBars ? result : history;
  const bars = validCandles(suppliedCompletedBars ? result.meta.bars : history?.data,suppliedCompletedBars);
  const visible = suppliedCompletedBars ? bars : bars.slice(-limit);
  const matchesByDate = candleMatches(result,visible,catalog,new Set(selected));
  let plot;
  if (visible.length) {
    const markers = markersByDate(matchesByDate);
    // Lightweight Charts replaces this SVG after it loads; the SVG stays if it cannot.
    const volumes = new Map((Array.isArray(history?.data) ? history.data : [])
      .map(row => [barDate(row), numeric(value(row,'volume'))]).filter(([date,volume]) => date && volume != null));
    const id = candlePayload({
      key:`${state.symbol}|${state.period}`, symbol:state.symbol, matches:markers,
      bars:visible.map(bar => ({...bar, volume:volumes.get(bar.date) ?? null})),
    });
    plot = `<div class="lw-candles" data-lw-candles="${id}">${candlestickChart({bars:visible, matchesByDate:markers, symbol:state.symbol})}</div>`;
  } else if (!history || history.loading || result?.loading) {
    plot = empty('Loading daily candlesticks…','Waiting on OpenBB.');
  } else {
    plot = empty('No daily candlesticks available',
      history.error?.message || 'The source did not supply completed bars with full open, high, low, and close prices.');
  }
  const legend = patternLegend(result,selected,catalog);
  const footer = visible.length
    ? `<div class="chart-meta candle-chart-meta"><div class="candle-legend">${legend}</div><span>${numWhole(visible.length)} daily bars · ${src(source)}</span></div>`
    : '';
  return `<div class="panel-body candle-plot">${plot}</div>${footer}${patternSummary(state,result,matchesByDate,catalog)}`;
}

function historyPanel(state) {
  const chartMode = state.historyChart === 'candles' ? 'candles' : 'line';
  const controls = historyControls(state,chartMode);
  const limit = historyLimits[state.period] ?? historyLimits['6M'];
  if (chartMode === 'candles') {
    return panel('Price history',`${esc(state.symbol)} · Completed daily candles`,candleHistory(state,limit),controls,'price-history');
  }

  const rows = historyData(state).slice(-limit);
  const history = state.results.history;
  const body = rows.length
    ? `<div class="panel-body price-history-plot">${chart({id:'history',series:[rows.map(row=>row.close)],labels:rows.map(row=>dateText(row.date)),kind:'number',yTitle:`${state.symbol} daily close`})}</div>${chartLegend(['Daily close'],`${numWhole(rows.length)} observations · ${src(history)}`)}`
    : noData(state,'history','Price history');
  return panel('Price history',`${esc(state.symbol)} · Daily closes`,body,controls,'price-history');
}
function metrics(state){const s=summaryOf(state), exp=state.expiry?dateText(state.expiry):'No expiration';const spot=s.spot;
 return `<section class="cards" aria-label="Option snapshot metrics">${metric('ATM IMPLIED VOL',ivPct(s.atmIv),`${exp} · nearest strike`,'volatility')}${metric('EXPECTED MOVE',s.expectedMove==null?'—':`±${money(s.expectedMove)}`,s.expectedMove==null?'Based on ATM IV':`${pct(spot?s.expectedMove/spot*100:null,1)} of spot · 1σ model`,'target')}${metric('OPTION VOLUME',mass(s.callVolume==null||s.putVolume==null?null:s.callVolume+s.putVolume),`${exp} · call + put`,'activity')}${metric('PUT / CALL VOLUME',s.putCallVolume==null?'—':fmt(s.putCallVolume),'Selected expiry','ratio')}${metric('OPEN INTEREST',mass(s.callOpenInterest==null||s.putOpenInterest==null?null:s.callOpenInterest+s.putOpenInterest),`${exp} · observed OI`,'chain')}</section>`;}
function snapshot(state){const s=summaryOf(state), h=historyData(state), q=state.results.quote?.data?.[0]||{},v=spotOf(state),a=s.callVolume,b=s.putVolume, share=a!=null&&b!=null&&a+b>0?a/(a+b)*100:null;
 return panel('Market snapshot','Underlying &amp; selected expiry',`<div class="panel-body">${kv([['Prior close',money(value(q,'prev_close','previous_close','prev_close_price','previous_close_price','close_previous'))],['Day range',`${money(value(q,'day_low','low','low_price'))} <span class="muted">/</span> ${money(value(q,'day_high','high','high_price'))}`],['Underlying volume',mass(value(q,'volume','total_volume','regular_market_volume'))],['20-day realized vol',pct(hv(h,20),1)],['ATM strike',s.atmStrike==null?'—':money(s.atmStrike)],['Put / call OI',fmt(s.putCallOpenInterest)],['Model move range',s.expectedMove==null||v==null?'—':`${fmt(v-s.expectedMove,2)} – ${fmt(v+s.expectedMove,2)}`]])}${share==null?'':`<div class="meter"><div class="meter-line"><i style="width:${share}%"></i></div><div class="stack-inline"><span class="positive">Call volume ${pct(share,0)}</span><span class="negative">Put volume ${pct(100-share,0)}</span></div></div>`}</div>`);}
const chainSpecs={standard:[['bid','Bid',amount],['ask','Ask',amount],['iv','IV',ivPct],['volume','Vol',mass],['openInterest','OI',mass]],greeks:[['delta','Δ',n=>fmt(n,3)],['gamma','Γ',n=>fmt(n,4)],['theta','Θ',n=>fmt(n,3)],['vega','ν',n=>fmt(n,3)],['iv','IV',ivPct]],quotes:[['last','Last',amount],['bid','Bid',amount],['ask','Ask',amount],['mid','Mid',amount],['spread','Spread',amount]]};
function aroundStrikes(strikes,spot,limit){if(!limit||strikes.length<=limit)return strikes;const idx=Number.isFinite(spot)?strikes.reduce((best,n,i)=>Math.abs(n-spot)<Math.abs(strikes[best]-spot)?i:best,0):Math.floor(strikes.length/2), start=Math.max(0,Math.min(strikes.length-limit,idx-Math.floor(limit/2)));return strikes.slice(start,start+limit);}
function chainSelection(state,mini=false){const spot=spotOf(state),matching=state.rows.filter(r=>r.expiration===state.expiry&&(!state.minOI||(r.openInterest!=null&&r.openInterest>=state.minOI))&&(!state.minVol||(r.volume!=null&&r.volume>=state.minVol))&&(state.side==='both'||r.side===state.side));const strikes=aroundStrikes([...new Set(matching.map(r=>r.strike))].sort((a,b)=>a-b),spot,mini?11:state.strikeCount);return {strikes,matching:matching.filter(r=>strikes.includes(r.strike))};}
const idFor=(r)=>r?.contractSymbol||`${r?.expiration}|${r?.side}|${r?.strike}`;
export function contractFor(state,id){return state.rows.find(r=>idFor(r)===id);}
function chainPanel(state,mini=false){const e=state.results.chain,dates=expiryList(state),s=summaryOf(state),spot=chainSpotOf(state),ls=chainSelection(state,mini),spec=chainSpecs[state.columns]||chainSpecs.standard, map=new Map();for(const r of ls.matching){const key=r.strike+'|'+optionFamily(r), g=map.get(key)??{strike:r.strike,root:r.contractRoot,adjusted:r.adjusted};g[r.side]??=r;map.set(key,g);}const groups=[...map.values()].sort((x,y)=>x.strike-y.strike||Number(x.adjusted)-Number(y.adjusted)||String(x.root).localeCompare(String(y.root)));
 const toolbar=dates.length?`<div class="toolbar">${select('Expiration','expiry',dates.map(d=>[d,dateText(d,'full')]),state.expiry)}${select('Strike window','strike-count',[[11,'11 around ATM'],[21,'21 around ATM'],[41,'41 around ATM'],[0,'All strikes']],mini?11:state.strikeCount)}${select('Columns','chain-columns',[['standard','Liquidity'],['greeks','Greeks'],['quotes','Quotes']],state.columns)}${mini?'':select('Side','chain-side',[['both','Calls and puts'],['call','Calls'],['put','Puts']],state.side)+field('Min volume','min-vol',state.minVol,{min:0,step:'1'})+field('Min open interest','min-oi',state.minOI,{min:0,step:'1'})}<div class="toolbar-end">${btn('Export CSV','export-chain','download')}</div></div>`:'';
 const row=(r,side,rev)=>{const cols=rev?[...spec].reverse():spec;const itm=r&&spot!=null&&((side==='call'&&r.strike<spot)||(side==='put'&&r.strike>spot));return cols.map(([key,label,formatter],i)=>{const dd=key==='spread'?r?.ask!=null&&r?.bid!=null&&r.ask>=r.bid?r.ask-r.bid:null:r?.[key];const z=formatter(dd);const ind=key==='ask'||(state.columns==='greeks'&&key==='delta');return `<td class="${side} ${itm?'inmoney':''}" aria-label="${esc(side+' '+label)}">${r&&ind?`<button type="button" class="table-button" title="Inspect ${esc(side+' '+r.strike)}" data-contract="${esc(idFor(r))}">${z}</button>`:z}</td>`;}).join('');};
 const showC=state.side!=='put',showP=state.side!=='call';
 const grid=ls.strikes.length?`<div class="table-scroll chain-scroll" tabindex="0" aria-label="Options chain scroll region"><table class="data-table"><thead><tr class="group">${showC?`<th colspan="${spec.length}" class="call-title" scope="colgroup">CALLS</th>`:''}<th class="strike" scope="col">STRIKE</th>${showP?`<th colspan="${spec.length}" class="put-title" scope="colgroup">PUTS</th>`:''}</tr><tr class="subhead">${showC?[...spec].reverse().map((x)=>`<th scope="col">${x[1]}</th>`).join(''):''}<th class="strike" scope="col">${s.days==null?'PRICE':fmt(s.days,0)+' DTE'}</th>${showP?spec.map((x)=>`<th scope="col">${x[1]}</th>`).join(''):''}</tr></thead><tbody>${groups.map(g=>{const atm=g.strike===s.atmStrike&&!g.adjusted;return `<tr class="${atm?'atm':''}">${showC?row(g.call,'call',true):''}<td class="strike">${amount(g.strike)}${atm?' <small>ATM</small>':''}${g.adjusted?` <small class="pill gold" title="Possible adjusted deliverable">${esc(g.root)}</small>`:''}</td>${showP?row(g.put,'put',false):''}</tr>`;}).join('')}</tbody></table></div>`:state.rows.length?empty('No contracts match','Adjust filters, strikes or expiry to see more contracts.'):noData(state,'chain','Options chain');
 const warnings=(Array.isArray(e?.warnings)?e.warnings:[]).map(w=>typeof w==='string'?w:w?.message).filter(Boolean).map(w=>`<span>${esc(w)}</span>`).join('');
 const foot=`<div class="table-foot"><span>${ls.strikes.length?`${numWhole(ls.strikes.length)} strikes · ${numWhole(ls.matching.length)} contracts shown · Select a dotted value to inspect`:'Market data may be delayed or unavailable.'}</span><span>${src(e)}</span>${warnings}</div>`;
 return panel('Options chain',`${esc(state.symbol)} · ${dates.length?`${numWhole(dates.length)} expirations · ${numWhole(state.rows.length)} contracts`:'Expiration and strike quotes'}`,toolbar+grid+foot,mini?btn('Full chain','tab:chain','arrow'):'');}
export function overviewView(state){return metrics(state)+`<div class="columns">${historyPanel(state)}${snapshot(state)}</div>`+chainPanel(state,true);}
export function chainView(state){return metrics(state)+chainPanel(state);}
export function downloadChain(state){const {matching}=chainSelection(state,state.tab==='overview');if(!matching.length)return false;const header=[...Object.keys(matching[0]),'dataMode','providerAsOf'];const body=toCsv(matching.map(r=>({...r,dataMode:state.mode,providerAsOf:state.results.chain?.asOf})),header);const u=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=`${state.symbol}-${state.expiry}-${state.mode}-options.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);return true;}
// Sequential scale on the dark surface: one teal hue, dim for low IV and bright for high IV.
const surfaceLow=[0x15,0x2a,0x33], surfaceHigh=[0x67,0xe3,0xcc];
const surfaceColor=t=>`rgb(${surfaceLow.map((low,i)=>Math.round(low+(surfaceHigh[i]-low)*t)).join(',')})`;
const quantile=(sorted,q)=>sorted[Math.min(sorted.length-1,Math.max(0,Math.round(q*(sorted.length-1))))];

let surfaceMemo={rows:null,key:'',value:null};
function surfaceOf(state){
 const spot=chainSpotOf(state),asOf=chainAsOf(state),key=`${spot}|${asOf}`;
 if(surfaceMemo.rows!==state.rows||surfaceMemo.key!==key)surfaceMemo={rows:state.rows,key,value:ivSurface(state.rows,{spot,asOf})};
 return surfaceMemo.value;
}

function ivSurfacePanel(state){
 const surface=surfaceOf(state);
 if(!surface)return panel('IV surface','Implied volatility by expiration and strike',noData(state,'chain','IV surface'));
 // Scale colors to the 5th–95th percentile so a few extreme wings do not wash out the rest.
 const sorted=surface.rows.flatMap(row=>row.cells.map(cell=>cell.iv).filter(iv=>iv!=null)).sort((a,b)=>a-b);
 const low=quantile(sorted,.05),high=quantile(sorted,.95),span=high-low||1;
 const heading=surface.moneyness.map(m=>`<th scope="col">${m===0?'ATM':`${m>0?'+':'−'}${fmt(Math.abs(m)*100,0)}%`}</th>`).join('');
 const body=surface.rows.map(row=>`<tr><th scope="row">${dateText(row.expiration,'full')}<small>${numWhole(row.days)}d</small></th>${row.cells.map(cell=>{
  if(cell.iv==null)return `<td class="surface-empty" title="${esc(`${dateText(row.expiration)} · strike ${money(cell.strike)} · no bracketing quotes`)}">—</td>`;
  const t=Math.max(0,Math.min(1,(cell.iv-low)/span));
  const tip=`${dateText(row.expiration,'full')} · ${cell.moneyness===0?'ATM':`${signed(cell.moneyness*100,0)}%`} · strike ${money(cell.strike)} · IV ${pct(cell.iv*100,1)} · from ${cell.source==='both'?'calls and puts':cell.source+'s'}`;
  return `<td style="background:${surfaceColor(t)}" class="${t>.55?'surface-bright':''}" title="${esc(tip)}">${fmt(cell.iv*100,1)}</td>`;
 }).join('')}</tr>`).join('');
 const legend=`<div class="surface-legend"><span>≤ ${pct(low*100,1)}</span><i style="background:linear-gradient(90deg,${surfaceColor(0)},${surfaceColor(.5)},${surfaceColor(1)})" aria-hidden="true"></i><span>≥ ${pct(high*100,1)}</span></div>`;
 const table=`<div class="table-scroll surface-scroll" tabindex="0" aria-label="IV surface table"><table class="data-table iv-surface"><caption class="sr-only">Implied volatility in percent by expiration (rows) and strike relative to spot ${money(surface.spot)} (columns)</caption><thead><tr><th scope="col">Expiration</th>${heading}</tr></thead><tbody>${body}</tbody></table></div>`;
 return panel('IV surface',`IV % by expiration and strike vs spot ${money(surface.spot)} · out-of-the-money side`,`${table}<div class="chart-meta">${legend}<span>Interpolated between listed strikes, not extrapolated · ${src(state.results.chain)}</span></div>`);
}

export function volatilityView(state){const spot=chainSpotOf(state), e=state.results.chain, ex=expirySummaries(state.rows,{spot,asOf:chainAsOf(state)}), sk=skewSeries(state.rows,{spot,expiry:state.expiry}), h=historyData(state), s=summaryOf(state), q=state.results.quote?.data?.[0], d25=skew25Delta(state.rows,{spot,expiry:state.expiry,asOf:chainAsOf(state)});
 const iv30=numeric(q?.iv30), low30=numeric(q?.iv30_annual_low), high30=numeric(q?.iv30_annual_high), rank=iv30!=null&&low30!=null&&high30>low30?(iv30-low30)/(high30-low30)*100:null;
 // Place expirations by days to expiry and strikes by price, so uneven gaps show as uneven spacing.
 const term=ex.filter(x=>numeric(x.days)!=null);
 const chartTerm=chart({id:'term',series:[term.map(x=>numeric(x.atmIv)==null?null:x.atmIv*100)],labels:term.map(x=>`${dateText(x.expiration??x.expiry)} · ${numWhole(x.days)}d`),xs:term.map(x=>x.days),kind:'percent',legend:['ATM IV'],yTitle:'ATM implied volatility by days to expiration'});
 const chartSkew=chart({id:'skew',series:[sk.map(x=>x.callIv==null?null:x.callIv*100),sk.map(x=>x.putIv==null?null:x.putIv*100)],labels:sk.map(x=>fmt(x.strike,x.strike%1?1:0)),xs:sk.map(x=>x.strike),kind:'percent',legend:['Calls','Puts'],yTitle:'Implied volatility by strike',endMarker:false});
 const section=(c,n)=>`<div class="panel-body">${c}</div>${chartLegend(n,src(e))}`;
 return `<section class="cards">${metric('ATM IMPLIED VOL',ivPct(s.atmIv),state.expiry?dateText(state.expiry):'Selected expiry','volatility')}${metric('20D REALIZED VOL',pct(hv(h,20),1),'Daily close returns','activity')}${metric('30D IV RANGE RANK',pct(rank,1),'Provider annual high / low','ratio')}${metric('25Δ PUT − CALL IV',d25.putMinusCall==null?'—':`${signed(d25.putMinusCall*100,1)} pp`,'Interpolated on observed deltas','volatility')}${metric('ATM STRADDLE MID',money(s.straddle),'Two-sided quotes only','target')}</section><div class="columns equal">${panel('IV term structure','ATM IV · by observed expiration',section(chartTerm,['ATM IV']),'','term-structure')}${panel('Volatility skew','Call and put IV · by strike',section(chartSkew,['Calls','Puts']),select('Expiration','expiry',expiryList(state).map(d=>[d,dateText(d,'full')]),state.expiry),'volatility-skew')}</div>${ivSurfacePanel(state)}${panel('Expiration comparison','Provider IV and measured option activity',ex.length?table(['Expiration','DTE','ATM strike','ATM IV','Model move','Put/Call vol','Put/Call OI'],ex.map(x=>[dateText(x.expiration??x.expiry,'full'),numWhole(x.days),money(x.atmStrike),ivPct(x.atmIv),x.expectedMove==null?'—':'±'+money(x.expectedMove),fmt(x.putCallVolume),fmt(x.putCallOpenInterest)])):noData(state,'chain','Expiration comparison'))}${panel('Reading the surface','Observed snapshot · volatility measures',`<div class="panel-body note">Realized volatility is the sample standard deviation of daily log returns, annualized using √252. Range rank uses the provider’s current 30-day IV and annual high/low when all three fields are supplied. It is different from IV percentile, which requires daily observations.</div>`)}`;}
// Recompute positioning only when the chain or its inputs change, not on every render.
let positioningMemo={rows:null,key:'',value:null};
function positioningOf(state){
 const spot=chainSpotOf(state),asOf=chainAsOf(state),scope=state.activityExpiry==='all'?null:state.expiry;
 const key=[spot,asOf,scope,state.expiry,state.rate,state.divYield].join('|');
 if(positioningMemo.rows!==state.rows||positioningMemo.key!==key){
  positioningMemo={rows:state.rows,key,value:{
   gex:gammaExposure(state.rows,{spot,asOf,expiry:scope,rate:state.rate/100,dividendYield:state.divYield/100}),
   pain:state.expiry?maxPain(state.rows,{expiry:state.expiry}):null,
  }};
 }
 return positioningMemo.value;
}

function positioningPanel(state){
 const {gex,pain}=positioningOf(state),e=state.results.chain,spot=chainSpotOf(state);
 const scope=state.activityExpiry==='all'?'All expirations':dateText(state.expiry,'full');
 const per1=v=>v==null?'—':`${compactMoney(v)}`;
 const fromSpot=(level,base)=>level==null||!base?'—':`${signed((level/base-1)*100,1)}%`;
 const cards=`<section class="cards positioning-cards" aria-label="Gamma exposure and max pain">${metric('NET GAMMA EXPOSURE',per1(gex?.total),`Per 1% move · ${esc(scope)}`,'activity')}${metric('GAMMA FLIP',gex?.flip==null?'—':money(gex.flip),gex?.flip==null?'No zero crossing within ±20%':`${fromSpot(gex.flip,spot)} from spot`,'target')}${metric('CALL WALL',money(gex?.callWall),'Largest call gamma','chain')}${metric('PUT WALL',money(gex?.putWall),'Largest put gamma','chain')}${metric('MAX PAIN',money(pain?.strike),state.expiry?`${dateText(state.expiry)} · ${fromSpot(pain?.strike,spot)} from spot`:'Select an expiration','ratio')}</section>`;
 let gexChart=noData(state,'chain','Gamma exposure');
 if(gex){
  // Strikes within ±15% of spot keep the bars readable; totals above use every strike.
  const near=gex.byStrike.filter(p=>Math.abs(p.strike/gex.spot-1)<=.15);
  const shown=near.length>1?near:gex.byStrike;
  gexChart=`<div class="panel-body">${barChart({id:'gex',values:shown.map(p=>p.net),xs:shown.map(p=>p.strike),labels:shown.map(p=>fmt(p.strike,p.strike%1?1:0)),hits:shown.map(p=>`Strike ${money(p.strike)} · Net ${compactMoney(p.net)} · Calls ${compactMoney(p.call)} · Puts ${compactMoney(p.put)}`),yTitle:'Net gamma exposure by strike, dollars per 1% move',markers:[{x:gex.spot,label:'Spot',className:'spot'},...(gex.flip==null?[]:[{x:gex.flip,label:'Flip',className:'flip'}])]})}</div>${chartLegend(['Net GEX by strike'],`${numWhole(gex.contracts)} contracts${gex.skipped?` · ${numWhole(gex.skipped)} without IV or gamma skipped`:''} · ${gex.providerGamma?'provider gamma where supplied, else':'gamma from'} Black–Scholes · ${src(e)}`)}`;
 }
 let painChart=state.rows.length?empty('No max pain available','The selected expiration has too few strikes with open interest.'):noData(state,'chain','Max pain');
 if(pain){
  const near=pain.curve.filter(p=>!spot||Math.abs(p.strike/spot-1)<=.25);
  const shown=near.length>1?near:pain.curve;
  painChart=`<div class="panel-body">${chart({id:'max-pain',series:[shown.map(p=>p.payout)],xs:shown.map(p=>p.strike),labels:shown.map(p=>money(p.strike)),kind:'money',legend:['Holder payout'],yTitle:'Total intrinsic value paid to option holders by settlement price',endMarker:false})}</div>${chartLegend(['Holder payout at settlement'],`Minimum at ${money(pain.strike)} · ${numWhole(pain.openInterest)} open contracts · ${dateText(pain.expiry,'full')}`)}`;
 }
 const note='<p class="note positioning-note">GEX assumes dealers are long calls and short puts, a common convention; dealer positions are not observed. Open interest is from the prior session. Max pain is the settlement price at which holders collect the least intrinsic value. Neither is a price forecast.</p>';
 return `${cards}<div class="columns equal">${panel('Gamma exposure by strike',`${esc(scope)} · dollars per 1% move`,gexChart+note,'','gamma-exposure')}${panel('Max pain',`${esc(dateText(state.expiry,'full'))} · selected expiration`,painChart,'','max-pain')}</div>`;
}

export function activityView(state){const e=state.results.chain,ex=expirySummaries(state.rows,{spot:chainSpotOf(state),asOf:chainAsOf(state)}), rows=unusualActivity(state.rows.filter(r=>(state.activityExpiry==='all'||r.expiration===state.expiry)&&(state.activitySide==='both'||r.side===state.activitySide)&&r.openInterest!=null&&r.openInterest>=state.activityOI),{minVolume:state.activityVolume,minRatio:state.activityRatio,limit:state.rows.length});
 const filters=`<div class="toolbar">${select('Scope','activity-expiry',[['all','All expiries'],['selected','Selected expiry']],state.activityExpiry)}${select('Selected expiration','expiry',expiryList(state).map(d=>[d,dateText(d)]),state.expiry)}${select('Side','activity-side',[['both','Both'],['call','Calls'],['put','Puts']],state.activitySide)}${field('Min volume','activity-volume',state.activityVolume,{min:0,step:'1'})}${field('Min OI','activity-oi',state.activityOI,{min:0,step:'1'})}${field('Min volume/OI','activity-ratio',state.activityRatio,{min:0,step:'.1'})}</div>`;
 const activityRows=rows.length?table(['Expiration','Side','Strike','Volume','OI','Vol / OI','IV','Bid','Ask'],rows.slice(0,150).map(r=>[dateText(r.expiration,'full'),pill(r.side.toUpperCase(),r.side==='call'?'teal':'red'),`<button type="button" class="table-button" data-contract="${esc(idFor(r))}">${money(r.strike)}</button>`,numWhole(r.volume),numWhole(r.openInterest),fmt(r.volumeToOpenInterest),ivPct(r.iv),amount(r.bid),amount(r.ask)])):state.rows.length?empty('No matching activity','Lower the filter thresholds. Contracts with missing or zero open interest do not have a meaningful volume/OI ratio.'):noData(state,'chain','Option activity');
 const expiryRows=ex.length?table(['Expiration','Call volume','Put volume','Call OI','Put OI','Put/Call vol'],ex.map(x=>[dateText(x.expiration??x.expiry,'full'),numWhole(x.callVolume),numWhole(x.putVolume),numWhole(x.callOpenInterest),numWhole(x.putOpenInterest),fmt(x.putCallVolume)])):noData(state,'chain','Expiry totals');
 return metrics(state)+positioningPanel(state)+panel('Unusual activity screener',`${esc(state.symbol)} · single underlying · ranked by volume / open interest`,filters+activityRows+`<div class="table-foot"><span>${numWhole(Math.min(rows.length,150))} rows shown · ${numWhole(rows.length)} hits returned by screen</span><span>${src(e)}</span></div>`)+panel('Volume and open interest by expiration','Totals from the contracts in this snapshot',expiryRows)+panel('How to use this screen','A liquidity and turnover signal',`<div class="panel-body note">A high volume/OI ratio does not identify the buyer, whether a trade opened or closed a position, trade aggressor, dark pool activity, or strategy intent. Open interest can be from a different session than the volume.</div>`);}

export function contractDialog(state,r){const q=state.results.chain;const bs=r.adjusted?null:blackScholes({side:r.side,spot:chainSpotOf(state),strike:r.strike,days:summaryOf(state,r.expiration).days,iv:r.iv,rate:state.rate/100,dividendYield:state.divYield/100});const key=r.contractSymbol||`${state.symbol} ${r.side.toUpperCase()} ${r.strike}`;
 const quotes=kv([['Bid / Ask',`${money(r.bid)} / ${money(r.ask)}`],['Bid / Ask size',`${numWhole(r.bidSize)} / ${numWhole(r.askSize)}`],['Quote midpoint / spread',`${money(r.mid)} / ${money(r.spread)}`],['Last trade / previous close',`${money(r.last)} / ${money(r.prevClose)}`],['Volume / Open interest',`${numWhole(r.volume)} / ${numWhole(r.openInterest)}`],['Provider implied vol',ivPct(r.iv)],['Provider Δ / Γ',`${fmt(r.delta,4)} / ${fmt(r.gamma,4)}`],['Provider Θ / ν / ρ',`${fmt(r.theta,4)} / ${fmt(r.vega,4)} / ${fmt(r.rho,4)}`],['Contract multiplier',numWhole(r.multiplier)],['Quote timestamp',dateText(r.quoteTime,'time')],['Last trade timestamp',dateText(r.lastTradeTime,'time')],['Dataset source',src(q)]]);
 const extras=kv([['Contract root',esc(r.contractRoot)||'—'],['Day open / high / low / close',[r.open,r.high,r.low,r.close].map(n=>money(n)).join(' / ')],['Provider mark / theoretical',`${money(r.providerMark)} / ${money(r.theoretical)}`],['Bid / ask time',`${dateText(r.bidTime,'time')} / ${dateText(r.askTime,'time')}`],['Greeks timestamp',dateText(r.greeksTime,'time')],['Indicative model value / delta',`${money(bs?.price)} / ${fmt(bs?.delta,4)}`]]);
 return {title:key,html:`<p>${pill(r.side.toUpperCase(),r.side==='call'?'teal':'red')} ${esc(state.symbol)} · ${dateText(r.expiration,'full')} · Strike ${money(r.strike)}</p>${quotes}<details class="row-gap"><summary>More contract fields</summary>${extras}</details>${r.adjusted?`<p class="note">${pill('POSSIBLE ADJUSTMENT','gold')} Verify the deliverable before modeling this contract.</p>`:`<div class="dialog-buttons"><button type="button" class="btn primary-btn" data-add-contract="${esc(idFor(r))}">${icon('plus')}Add to strategy</button></div><p class="note">Model: European Black–Scholes; assumptions are set in Strategy Lab. Verify exercise style and deliverables separately.</p>`}`};}
export function newLeg(state,overrides={}){const s=summaryOf(state),spot=spotOf(state),r=state.rows.find(x=>!x.adjusted&&x.expiration===state.expiry&&x.side==='call'&&x.strike===s.atmStrike);const leg={side:'call',action:'buy',strike:s.atmStrike??(spot==null?'':Math.round(spot)),premium:r?.mid??'',quantity:1,multiplier:r?.multiplier??100,expiration:state.expiry,...overrides};
 // Quote midpoints carry float noise (e.g. 11.350000000000001); premiums are entered to the cent or finer.
 if(typeof leg.premium==='number')leg.premium=Number(leg.premium.toFixed(4));
 return leg;}
export function applyPreset(state,key){const s=summaryOf(state), k=s.atmStrike??Math.round(spotOf(state)??100), ks=[...new Set(state.rows.filter(r=>!r.adjusted&&r.expiration===state.expiry).map(r=>r.strike))].sort((a,b)=>a-b),i=ks.indexOf(k), gap=ks[i+1]!=null?ks[i+1]-k:Math.max(1,Math.round(k*.015));const near=(n)=>ks[i+n]??k+n*gap;const l=(side,action,strike)=>{const r=state.rows.find(x=>!x.adjusted&&x.expiration===state.expiry&&x.side===side&&x.strike===strike);return newLeg(state,{side,action,strike,premium:r?.mid??'',multiplier:r?.multiplier??100});};const plur={call:[l('call','buy',k)],put:[l('put','buy',k)],vertical:[l('call','buy',k),l('call','sell',near(1))],straddle:[l('call','buy',k),l('put','buy',k)],condor:[l('put','buy',near(-2)),l('put','sell',near(-1)),l('call','sell',near(1)),l('call','buy',near(2))]};state.legs=plur[key]??[];}
/** Model inputs for one leg: the DTE and IV overrides win, otherwise the linked chain expiry and contract IV. */
function legModelInputs(state,l){
 const strike=numeric(l.strike);
 const r=state.rows.find(x=>x.expiration===l.expiration&&x.side===l.side&&x.strike===strike&&!x.adjusted);
 const days=numeric(state.scenarioDTE)??summaryOf(state,l.expiration).days;
 const iv=numeric(state.scenarioIV)!=null?numeric(state.scenarioIV)/100:r?.iv??null;
 return {days,iv};
}

/** Black–Scholes P/L at today (T+0) and halfway to the nearest expiration, on the payoff chart's prices. */
export function modelCurves(state,legs,points){
 if(!legs.length||!points?.length)return {curves:[],note:''};
 const inputs=legs.map(l=>({...l,...legModelInputs(state,l)}));
 if(inputs.some(l=>l.days==null||l.iv==null||!(l.iv>0))){
  return {curves:[],note:'Curves before expiration need an IV and days to expiration for every leg. Link the legs to a chain expiration or set the IV and DTE overrides.'};
 }
 const nearest=Math.min(...inputs.map(l=>l.days));
 if(!(nearest>0))return {curves:[],note:'The legs are at expiration, so only the expiration payoff applies.'};
 const half=Math.floor(nearest/2);
 const horizons=[[0,'Today (T+0)'],...(half>0&&half<nearest?[[half,`T+${half} days`]]:[])];
 const settings={rate:state.rate/100,dividendYield:state.divYield/100};
 const curves=[];
 for(const [daysForward,label] of horizons){
  const values=points.map(point=>{const m=modelScenario(inputs,{...settings,spot:point.spot,daysForward});return m.error?null:m.pnl;});
  if(values.some(v=>v!=null))curves.push({label,daysForward,values});
 }
 return {curves,note:''};
}

/** Probability of profit at expiration, with one volatility for the underlying: the IV override, else the expiry's ATM IV. */
export function profitProbability(state,legs,spot){
 if(!legs.length)return {text:'—'};
 const expiration=legs[0]?.expiration||state.expiry;
 const summary=summaryOf(state,expiration);
 const days=numeric(state.scenarioDTE)??summary.days;
 const override=numeric(state.scenarioIV)!=null;
 const iv=override?numeric(state.scenarioIV)/100:summary.atmIv;
 const result=probabilityOfProfit(legs,{spot,days,iv,rate:state.rate/100,dividendYield:state.divYield/100});
 if(result.probability==null)return {text:'—',detail:result.error};
 return {text:pct(result.probability*100,1),detail:`Lognormal at expiration · ${override?'IV override':'ATM IV'} ${pct(iv*100,1)} · ${numWhole(days)} DTE`,probability:result.probability};
}

export function strategyView(state){const spot=numeric(state.scenarioSpot)??spotOf(state),legs=state.legs, p=expiryPayoff(legs,{spot,points:101}), expiry=legs[0]?.expiration||state.expiry;const options=expiryList(state);const rowOptions=options.length?options.map(d=>[d,dateText(d,'full')]):[['','Not linked to a chain']];
 const presets=`<div class="preset-row">${Object.entries({call:'Long call',put:'Long put',vertical:'Call spread',straddle:'Long straddle',condor:'Iron condor'}).map(([key,title])=>btn(title,'preset:'+key)).join('')}</div>`;
 const legRows=legs.map((l,i)=>[`<span class="muted">${i+1}</span>`,select('','leg-action-'+i,[['buy','Buy'],['sell','Sell']],l.action),select('','leg-side-'+i,[['call','Call'],['put','Put']],l.side),select('','leg-expiration-'+i,options.includes(l.expiration)||(!options.length&&!l.expiration)?rowOptions:[...rowOptions,[l.expiration,l.expiration]],l.expiration),field('','leg-strike-'+i,l.strike,{min:0}),field('','leg-premium-'+i,l.premium,{min:0}),field('','leg-quantity-'+i,l.quantity,{min:1,step:'1'}),field('','leg-multiplier-'+i,l.multiplier,{min:1,step:'1'}),`<button type="button" class="icon-btn" data-action="remove-leg:${i}" aria-label="Remove leg ${i+1}">${icon('x')}</button>`]);
 const model=p?.points?.length?modelCurves(state,legs,p.points):{curves:[],note:''};
 const names=['At expiration',...model.curves.map(c=>c.label)];
 const shape=p?.points?.length?`<div class="panel-body">${chart({id:'payoff',series:[p.points.map(x=>x.pnl),...model.curves.map(c=>c.values)],labels:p.points.map(x=>money(x.spot)),xs:p.points.map(x=>x.spot),kind:'money',legend:names,yTitle:'Profit and loss at expiration and before expiration',height:230,zero:true,endMarker:false})}${chartLegend(names,model.curves.length?'Gross, before fees · curves before expiration use the Black–Scholes model':'Gross, before fees or assignment costs')}${model.note?`<p class="note">${esc(model.note)}</p>`:''}</div>`:empty(legs.length&&p?.error?'Check the leg inputs':'Add a strategy',legs.length&&p?.error||'Enter at least one complete leg and a scenario spot, or choose a preset.');
 const assumed=legs.every(l=>l.multiplier!=null)&&legs.length?'Contract multiplier is editable. A default of 100 is an assumption when the provider does not supply it.':'';
 const pop=profitProbability(state,legs,spot);
 const facts=kv([['Net entry cost',money(p?.entryCost)],['Maximum profit',p?.unlimitedProfit?'Unbounded':money(p?.maxProfit)],['Maximum loss',p?.unlimitedLoss?'Unbounded':money(p?.maxLoss)],['Breakeven',[...(p?.breakEvens??[]).map(x=>money(x)),...(p?.breakevenRanges??[]).map(r=>`${money(r.from)} – ${r.to==null?'no upper limit':money(r.to)} (zero P/L)`)].join(', ')||'—'],['Probability of profit',`${pop.text}${pop.detail?`<small class="muted pop-detail">${esc(pop.detail)}</small>`:''}`],['P/L at scenario spot',money(p?.pnlAtSpot)],['Common expiration',dateText(expiry,'full')]]);
 const modelLegs=legs.map((l,i)=>{const {days,iv}=legModelInputs(state,l);const m=blackScholes({side:l.side,spot,strike:numeric(l.strike),days,iv,rate:state.rate/100,dividendYield:state.divYield/100});return [`Leg ${i+1}`,ivPct(iv),money(m?.price??m?.value),fmt(m?.delta,4),fmt(m?.gamma,4),fmt(m?.theta,4),fmt(m?.vega,4)];});
 return panel('Strategy lab',`${esc(state.symbol)} · same-expiry positions · premiums per underlying unit`, `<div class="panel-body">${presets}<div class="scenario-fields">${select('Preset expiration','expiry',rowOptions,state.expiry)}${field('Scenario spot','scenario-spot',state.scenarioSpot,{min:0,placeholder:spotOf(state)==null?'Enter spot':String(spotOf(state))})}${field('Rate %','scenario-rate',state.rate)}${field('Yield %','scenario-yield',state.divYield,{min:0})}${field('IV override %','scenario-iv',state.scenarioIV,{min:0,placeholder:'Use chain'})}${field('DTE override','scenario-dte',state.scenarioDTE,{min:0,step:'1',placeholder:'Use expiry'})}</div></div>${legs.length?table(['#','Action','Type','Expiration','Strike','Premium','Qty','Multiplier',''],legRows,'scenario-table'):empty('No positions yet','Start with a preset, add a leg, or select a contract in the options chain.')}`+`<div class="table-foot"><span>${assumed}</span></div>`,btn('Add leg','add-leg','plus'))+`<div class="columns equal">${panel('Expiration payoff','Gross strategy profit and loss by scenario price',shape,'','expiry-payoff')}${panel('Risk summary','Exact same-expiry payoff within model assumptions',`<div class="panel-body">${facts}</div>`)}</div>`+panel('Indicative model sensitivity','Unsigned per-option Greeks; override assumptions above to compare scenarios',modelLegs.length?table(['Leg','IV','Model value','Delta','Gamma','Theta/day','Vega/vol pt'],modelLegs):empty('No legs to model','Add a leg to inspect theoretical values.'))+`<p class="note">Expiry P/L uses entered premiums and contract quantities. Black–Scholes is a European exercise model and omits early assignment, execution slippage, fees and corporate action deliverables.</p>`;}
