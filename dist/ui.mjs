const icons={
 maximize:'<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
 minimize:'<path d="M4 8h4V4m12 4h-4V4M4 16h4v4m12-4h-4v4"/>',
 overview:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',chain:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11m6-11v11"/>',volatility:'<path d="M3 18h18M3 15l4-5 4 3 5-7 5 4"/>',activity:'<path d="M2 12h5l3-7 4 14 3-7h5"/>',strategy:'<path d="M3 18h18M4 16l6-6h5l5-6"/><circle cx="10" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',fundamentals:'<path d="M4 21h16M6 17V8l6-4 6 4v9M9 17v-4m6 4v-4m-6-3h.01m6 0h.01"/>',events:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h.01m4 0h.01m4 0h.01m-8 3h.01m4 0h.01"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',refresh:'<path d="M19 11a7 7 0 1 0-2 6M19 6v5h-5"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',star:'<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',x:'<path d="m6 6 12 12M18 6 6 18"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',plus:'<path d="M12 5v14M5 12h14"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',filter:'<path d="M4 6h16M7 12h10m-7 6h4"/>',target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',ratio:'<path d="M5 19 19 5"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>'
};
export const icon=(name)=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||''}</svg>`;
export const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const numeric=(x)=>x!=null&&x!==''&&typeof x!=='boolean'&&Number.isFinite(Number(x))?Number(x):null;
export const fmt=(x,d=2)=>numeric(x)==null?'—':Number(x).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
export const money=(x,currency='USD')=>numeric(x)==null?'—':`${x<0?'−':''}${currency==='USD'?'$':currency?esc(currency)+' ':''}${fmt(Math.abs(x),2)}`;
export const pct=(x,d=2)=>numeric(x)==null?'—':`${fmt(x,d)}%`;
export const compact=(x)=>numeric(x)==null?'—':Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(x);
export const signed=(x,d=2)=>numeric(x)==null?'—':`${x>0?'+':x<0?'−':''}${fmt(Math.abs(x),d)}`;
export const dateText=(x,style='short')=>{if(!x)return '—';const str=String(x);const onlyDate=/^\d{4}-\d{2}-\d{2}$/.test(str);const d=new Date(onlyDate?str+'T16:00:00Z':str);if(Number.isNaN(d.getTime()))return esc(str);return Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',...(style==='full'?{year:'numeric'}:{}),...(style==='time'&&!onlyDate?{hour:'numeric',minute:'2-digit',timeZoneName:'short'}:{})}).format(d);};
export const src=(e)=>e?.provider?`${esc(e.provider)}${e.delayed?' · delayed':''}${e.asOf?' · '+dateText(e.asOf,'time'):''}`:'OpenBB feed unavailable';
export const value=(o,...keys)=>{for(const k of keys){const v=o?.[k];if(v!==null&&v!==undefined&&v!=='')return v;}return null;};
export function panel(title, subtitle, body, actions='', chartKey='') {
  const chartPanel = chartKey ? ` data-chart-panel="${esc(chartKey)}"` : '';
  const controls = chartKey
    ? `<div class="chart-panel-actions">${actions}<button type="button" id="chart-maximize-${esc(chartKey)}" class="icon-btn chart-fullscreen-toggle" data-action="chart-maximize" aria-label="Fullscreen chart" title="Fullscreen chart">${icon('maximize')}</button></div>`
    : actions;
  return `<section class="panel"${chartPanel}><div class="panel-head"><div><h2>${esc(title)}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div>${controls}</div>${body}</section>`;
}
export const kv=(rows)=>`<dl class="kv">${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${v??'—'}</dd></div>`).join('')}</dl>`;
export const empty=(title,detail)=>`<div class="empty"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
export const table=(head,rows,clazz='')=>`<div class="table-scroll"><table class="data-table ${clazz}"><thead><tr>${head.map(x=>`<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c??'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const pill=(t,klass='')=>`<span class="pill ${klass}">${esc(t)}</span>`;
export const btn=(label,action,ic='',extra='')=>`<button type="button" class="btn ${extra}" data-action="${esc(action)}">${ic?icon(ic):''}${esc(label)}</button>`;
export const select=(label,id,values,current)=>`<label class="control">${esc(label)}<select class="select" id="${id}">${values.map(item=>{const [v,l]=Array.isArray(item)?item:[item,item];return `<option value="${esc(v)}"${String(v)===String(current)?' selected':''}>${esc(l)}</option>`;}).join('')}</select></label>`;
export const field=(label,id,val,{min,max,step='any',placeholder='',type='number'}={})=>`<label class="control">${esc(label)}<input class="field" id="${id}" type="${type}" value="${esc(val??'')}" step="${step}" ${min!=null?'min="'+min+'"':''} ${max!=null?'max="'+max+'"':''} placeholder="${esc(placeholder)}"></label>`;
export const metric=(label,result,detail='',ic='')=>`<div class="metric"><div class="label">${esc(label)}${ic?icon(ic):''}</div><div class="value">${result}</div><div class="detail">${detail}</div></div>`;
/** `xs` optionally places point i at a numeric x value (e.g. DTE or strike) instead of evenly by index. */
export function chart({id,series,labels=[],kind='number',yTitle='',legend=[],height=188,zero=false,endMarker=true,xs=null}){
  const points=series.flatMap(s=>s.filter(x=>numeric(x)!=null));
  if(!points.length)return empty('No chart data','The selected dataset does not include values to plot.');
  const n=Math.max(...series.map(x=>x.length)),w=710, h=height,L=13,R=64,T=13,B=31;
  let lo=Math.min(...points),hi=Math.max(...points);if(zero){lo=Math.min(lo,0);hi=Math.max(hi,0);}
  const pad=(hi-lo||Math.max(1,Math.abs(hi)*.02))*.09; lo-=pad;hi+=pad;
  const scaled=Array.isArray(xs)&&xs.length===n&&n>1&&xs.every((v,i)=>numeric(v)!=null&&(i===0||Number(v)>=Number(xs[i-1])))&&Number(xs[n-1])>Number(xs[0]);
  const fractions=Array.from({length:n},(_,i)=>scaled?(xs[i]-xs[0])/(xs[n-1]-xs[0]):i/Math.max(1,n-1));
  const x=i=>L+(w-L-R)*fractions[i],y=v=>T+(h-T-B)*(hi-v)/(hi-lo), coords=(a,i)=>`${x(i).toFixed(1)},${y(a).toFixed(1)}`;
  const printer=v=>kind==='percent'?pct(v,1):kind==='money'?money(v):fmt(v,kind==='int'?0:2);
  let rule='',ticks='';
  for(let i=0;i<5;i++){const v=hi-i*(hi-lo)/4;rule+=`<line class="gline" x1="${L}" x2="${w-R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${w-R+8}" y="${y(v)+3}">${esc(printer(v))}</text>`;}
  // Ticks sit at evenly spaced x positions, on the nearest plotted point.
  const tickCount=Math.min(6,n);
  const nearest=f=>fractions.reduce((best,v,i)=>Math.abs(v-f)<Math.abs(fractions[best]-f)?i:best,0);
  const tickIndexes=new Set(Array.from({length:tickCount},(_,j)=>nearest(j/Math.max(1,tickCount-1))));
  for(const i of tickIndexes) if(labels[i]) ticks+=`<text class="axis" x="${x(i)}" y="${h-10}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}">${esc(labels[i])}</text>`;
  const first=series[0].findIndex(v=>numeric(v)!=null),last=series[0].findLastIndex(v=>numeric(v)!=null);
  function line(a){let active=false;return a.map((v,i)=>{if(numeric(v)==null){active=false;return '';}const here=(active?'L':'M')+coords(v,i);active=true;return here;}).join(' ');}
  const d=line(series[0]);const fill=first>=0&&last>first&&series[0].slice(first,last+1).every(v=>numeric(v)!=null)?`<path d="${d} L${x(last)},${h-B} L${x(first)},${h-B} Z" fill="url(#grad-${id})"/>`:'';
  const hit=Array.from({length:n},(_,i)=>`${labels[i]??i+1} · ${series.map((s,j)=>`${legend[j]?legend[j]+': ':''}${printer(s[i])}`).join(' · ')}`);
  return `<div class="chart" data-chart="${id}" data-labels="${esc(JSON.stringify(hit))}" data-box="${[w,L,R,n,T,h-B].join(',')}"${scaled?` data-xs="${esc(JSON.stringify(fractions))}"`:''}><svg class="focus-svg" tabindex="0" role="img" aria-label="${esc(yTitle)}. Use left and right arrow keys to inspect points." viewBox="0 0 ${w} ${h}"><defs><linearGradient id="grad-${id}" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#53ddbd" stop-opacity=".17"/><stop offset="100%" stop-color="#2bbd9d" stop-opacity="0"/></linearGradient></defs>${rule}${zero?`<line class="base" x1="${L}" x2="${w-R}" y1="${y(0)}" y2="${y(0)}"/>`:''}${fill}${series.map((s,i)=>`<path class="price-line ${i?`series${Math.min(i,2)+1}`:''}" d="${line(s)}"/>`).join('')}${endMarker&&last>=0?`<circle class="price-point" cx="${x(last)}" cy="${y(series[0][last])}" r="3.5"/>`:''}${ticks}<line class="crosshair" hidden/></svg><output class="chart-tooltip" hidden></output></div>`;
}

/**
 * Diverging bars around zero at increasing numeric x positions (e.g. strikes).
 * `markers` draw labeled vertical lines at x values, such as the spot price.
 */
export function barChart({id,values,xs,labels=[],hits=[],kind='money',yTitle='',height=210,markers=[]}){
  const n=values.length;
  if(!n||!values.some(v=>numeric(v)!=null))return empty('No chart data','The selected dataset does not include values to plot.');
  const w=710,h=height,L=13,R=78,T=22,B=31,plot=w-L-R;
  let lo=Math.min(0,...values.filter(v=>numeric(v)!=null)),hi=Math.max(0,...values.filter(v=>numeric(v)!=null));
  const pad=(hi-lo||1)*.08;lo-=pad;hi+=pad;
  const first=xs[0],last=xs[n-1],span=last-first;
  const fractions=xs.map(v=>span>0?(v-first)/span:.5);
  const x=i=>L+plot*fractions[i],y=v=>T+(h-T-B)*(hi-v)/(hi-lo);
  const printer=v=>kind==='money'?money(v):fmt(v);
  const gap=n>1?Math.min(...fractions.slice(1).map((f,i)=>f-fractions[i]))*plot:plot;
  const width=Math.max(1,Math.min(14,gap*.72));
  let grid='';
  for(let i=0;i<5;i++){const v=hi-i*(hi-lo)/4;grid+=`<line class="gline" x1="${L}" x2="${w-R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${w-R+8}" y="${y(v)+3}">${esc(kind==='money'?compactMoney(v):fmt(v))}</text>`;}
  const bars=values.map((v,i)=>{if(numeric(v)==null)return '';const top=Math.min(y(v),y(0)),size=Math.max(.5,Math.abs(y(v)-y(0)));return `<rect class="bar ${v<0?'neg':'pos'}" x="${(x(i)-width/2).toFixed(2)}" y="${top.toFixed(2)}" width="${width.toFixed(2)}" height="${size.toFixed(2)}"/>`;}).join('');
  const lines=markers.filter(m=>numeric(m.x)!=null&&m.x>=first&&m.x<=last&&span>0).map(m=>{const px=L+plot*(m.x-first)/span;return `<line class="marker-line ${esc(m.className??'')}" x1="${px}" x2="${px}" y1="${T}" y2="${h-B}"/><text class="marker-text" x="${px}" y="${T-6}" text-anchor="middle">${esc(m.label)}</text>`;}).join('');
  const tickCount=Math.min(6,n),nearest=f=>fractions.reduce((b,v,i)=>Math.abs(v-f)<Math.abs(fractions[b]-f)?i:b,0);
  const ticks=[...new Set(Array.from({length:tickCount},(_,j)=>nearest(j/Math.max(1,tickCount-1))))].map(i=>labels[i]?`<text class="axis" x="${x(i)}" y="${h-10}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}">${esc(labels[i])}</text>`:'').join('');
  const hitLabels=hits.length===n?hits:values.map((v,i)=>`${labels[i]??i+1} · ${printer(v)}`);
  return `<div class="chart bar-chart" data-chart="${esc(id)}" data-labels="${esc(JSON.stringify(hitLabels))}" data-box="${[w,L,R,n,T,h-B].join(',')}" data-xs="${esc(JSON.stringify(fractions))}"><svg class="focus-svg" tabindex="0" role="img" aria-label="${esc(yTitle)}. Use left and right arrow keys to inspect bars." viewBox="0 0 ${w} ${h}">${grid}<line class="base" x1="${L}" x2="${w-R}" y1="${y(0)}" y2="${y(0)}"/>${bars}${lines}${ticks}<line class="crosshair" hidden/></svg><output class="chart-tooltip" hidden></output></div>`;
}
export const compactMoney=(x)=>numeric(x)==null?'—':`${x<0?'−':''}$${compact(Math.abs(x))}`;

function candleMarker(match, x, y, size) {
  const title = `<title>${esc(match.label)}</title>`;
  if (match.variant === 'doji') {
    return `<path class="candle-marker doji" d="M${x},${y-size} L${x+size},${y} ${x},${y+size} ${x-size},${y} Z">${title}</path>`;
  }
  const variant = match.variant === 'hammer' ? 'hammer' : match.variant === 'bearish' ? 'bearish' : 'bullish';
  const tip = variant === 'bearish' ? y + size : y - size;
  const base = variant === 'bearish' ? y - size : y + size;
  return `<path class="candle-marker ${variant}" d="M${x},${tip} L${x+size},${base} ${x-size},${base} Z">${title}</path>`;
}

export function candlestickChart({bars, matchesByDate, symbol}) {
  if (!bars.length) return empty('No daily candlesticks available', 'The source did not supply complete open, high, low, and close prices.');

  const width = 710;
  const height = 246;
  const left = 20;
  const right = 74;
  const top = 36;
  const bottom = height - 53;
  const count = bars.length;
  const plotWidth = width - left - right;
  const firstX = count === 1 ? left + plotWidth / 2 : left;
  const lastX = count === 1 ? firstX : width - right;
  const xAt = index => Number((firstX + (lastX - firstX) * index / Math.max(1, count - 1)).toFixed(2));
  const highest = Math.max(...bars.map(bar => bar.high));
  const lowest = Math.min(...bars.map(bar => bar.low));
  const padding = (highest - lowest || Math.max(highest * 0.025, 0.01)) * 0.07;
  const maxPrice = highest + padding;
  const minPrice = Math.max(0, lowest - padding);
  const yAt = price => Number((top + (bottom - top) * (maxPrice - price) / (maxPrice - minPrice)).toFixed(2));
  const candleWidth = Math.min(13, Math.max(0.38, plotWidth / count * 0.66));
  const markerSize = count > 220 ? 2.6 : count > 115 ? 3.1 : 4;

  const grid = Array.from({length: 5}, (_, index) => {
    const price = maxPrice - index * (maxPrice - minPrice) / 4;
    const y = yAt(price);
    return `<line class="gline" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/><text class="axis" x="${width-right+8}" y="${y+3}">${fmt(price)}</text>`;
  }).join('');
  const tickCount = Math.min(5, count);
  const ticks = Array.from({length: tickCount}, (_, index) => {
    const barIndex = Math.round((count - 1) * index / Math.max(1, tickCount - 1));
    const anchor = tickCount === 1 ? 'middle' : index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle';
    const date = tickCount === 1 || count > 253 ? dateText(bars[barIndex].date, 'full') : dateText(bars[barIndex].date);
    return `<text class="axis" x="${xAt(barIndex)}" y="${height-10}" text-anchor="${anchor}">${esc(date)}</text>`;
  }).join('');

  const bodies = [];
  const markers = [];
  const labels = bars.map((bar, index) => {
    const x = xAt(index);
    const openY = yAt(bar.open);
    const closeY = yAt(bar.close);
    const highY = yAt(bar.high);
    const lowY = yAt(bar.low);
    const move = bar.close > bar.open ? 'up' : bar.close < bar.open ? 'down' : 'flat';
    bodies.push(`<g class="candle-bar ${move}"><line x1="${x}" x2="${x}" y1="${highY}" y2="${lowY}"/><rect x="${x-candleWidth/2}" y="${Math.min(openY, closeY)}" width="${candleWidth}" height="${Math.max(1, Math.abs(openY-closeY))}"/></g>`);

    const matches = matchesByDate.get(bar.date) ?? [];
    let above = 0;
    let below = 0;
    for (const match of matches) {
      const y = match.variant === 'doji' || match.variant === 'bearish'
        ? highY - 8 - above++ * 9
        : lowY + 8 + below++ * 9;
      markers.push(candleMarker(match, x, y, markerSize));
    }
    const prices = `O ${fmt(bar.open)} · H ${fmt(bar.high)} · L ${fmt(bar.low)} · C ${fmt(bar.close)}`;
    return [dateText(bar.date, 'full'), prices, ...matches.map(match => match.label)].join(' · ');
  });
  const box = [width, firstX, width-lastX, count, top, bottom].join(',');
  return `<div class="chart candle-chart" data-chart="daily-candles" data-labels="${esc(JSON.stringify(labels))}" data-box="${box}"><svg id="daily-candle-plot" class="focus-svg" tabindex="0" role="img" aria-label="${esc(symbol)} daily candlesticks. Use left and right arrow keys to inspect open, high, low, close, and any detected patterns." viewBox="0 0 ${width} ${height}">${grid}${bodies.join('')}${markers.join('')}${ticks}<line class="crosshair" hidden/></svg><output class="chart-tooltip" hidden></output></div>`;
}

export const chartLegend=(names,caption='')=>`<div class="chart-meta"><div class="legend">${names.map((n,i)=>`<span class="${['','second','third'][Math.min(i,2)]}">${esc(n)}</span>`).join('')}</div><span>${caption}</span></div>`;

export function bindCharts(dom) {
  for (const root of dom.querySelectorAll('[data-chart]')) {
    const [width,left,right,count,top,bottom] = root.dataset.box.split(',').map(Number);
    const plotWidth = width - left - right;
    const labels = JSON.parse(root.dataset.labels);
    // Value-scaled charts place points unevenly; otherwise points are evenly spaced.
    const fractions = root.dataset.xs ? JSON.parse(root.dataset.xs)
      : Array.from({length: count}, (_, i) => i / Math.max(1, count - 1));
    const nearestIndex = fraction => fractions.reduce((best, value, i) =>
      Math.abs(value - fraction) < Math.abs(fractions[best] - fraction) ? i : best, 0);
    const svg = root.firstElementChild;
    const crosshair = svg.querySelector('.crosshair');
    const tooltip = root.lastElementChild;
    let index = count - 1;

    function showPoint(targetIndex) {
      index = Math.max(0,Math.min(count - 1,targetIndex));
      const x = left + plotWidth * fractions[index];
      for (const [key,value] of Object.entries({x1:x,x2:x,y1:top,y2:bottom})) {
        crosshair.setAttribute(key,value);
      }
      crosshair.removeAttribute('hidden');
      tooltip.hidden = false;
      tooltip.textContent = labels[index];
    }

    function hidePoint() {
      crosshair.setAttribute('hidden','');
      tooltip.hidden = true;
    }

    svg.addEventListener('pointermove',event => {
      if (count === 1) {
        showPoint(0);
        return;
      }
      const transform = svg.getScreenCTM();
      if (!transform) return;
      const {x} = new DOMPoint(event.clientX,event.clientY).matrixTransform(transform.inverse());
      showPoint(nearestIndex((x - left) / plotWidth));
    });
    svg.addEventListener('pointerleave',hidePoint);
    svg.addEventListener('focus',() => showPoint(index));
    svg.addEventListener('blur',hidePoint);
    svg.addEventListener('keydown',event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      showPoint(index + (event.key === 'ArrowLeft' ? -1 : 1));
    });
  }
}
