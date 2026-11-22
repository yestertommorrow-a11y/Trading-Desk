const marketZone = 'America/New_York';
const marketDate = new Intl.DateTimeFormat('en-US', {year:'numeric', month:'short', day:'numeric', timeZone:marketZone});
const plainDate = new Intl.DateTimeFormat('en-US', {year:'numeric', month:'short', day:'numeric', timeZone:'UTC'});
const marketTime = new Intl.DateTimeFormat('en-US', {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:marketZone, timeZoneName:'short'});
const number = new Intl.NumberFormat('en-US', {maximumFractionDigits:4});
const shortNumber = new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:2});
const percent = new Intl.NumberFormat('en-US', {style:'percent', maximumFractionDigits:3});
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
const missing = '<span class="muted">—</span>';

const available = value => value != null && value !== '' && (typeof value !== 'number' || Number.isFinite(value));
const canonicalKey = key => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const displayKey = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^\w/, first => first.toUpperCase());

function field(row, ...keys) {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) if (available(row[key])) return row[key];
  const entries = Object.entries(row);
  for (const key of keys) {
    const entry = entries.find(([name, value]) => canonicalKey(name) === canonicalKey(key) && available(value));
    if (entry) return entry[1];
  }
  return null;
}

function rows(envelope) {
  return envelope?.ok && Array.isArray(envelope.data)
    ? envelope.data.filter(row => row && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function num(value) {
  if (!available(value) || typeof value === 'boolean' || typeof value === 'object') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function scalar(value) {
  if (!available(value)) return missing;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return escape(JSON.stringify(value));
  return escape(value);
}

function numeric(value, compact = false) {
  const result = num(value);
  if (result == null) return scalar(value);
  return compact && Math.abs(result) >= 1000
    ? `<span title="${escape(number.format(result))}">${escape(shortNumber.format(result))}</span>`
    : escape(number.format(result));
}

function ratio(value, inPercentagePoints = false) {
  const result = num(value);
  return result == null ? scalar(value) : escape(percent.format(inPercentagePoints ? result / 100 : result));
}

function url(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password && ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function link(value, label) {
  const safe = url(value);
  return safe ? `<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : escape(label);
}

function parsedDate(value) {
  if (typeof value === 'number') return new Date(Math.abs(value) < 1e11 ? value * 1000 : value);
  return new Date(value);
}

function time(value, showTime = false) {
  if (!available(value)) return missing;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = parsedDate(value);
    return Number.isFinite(+date) ? escape(plainDate.format(date)) : scalar(value);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) {
    return showTime ? escape(`${value.replace('T',' ')} (provider time)`) : time(value.slice(0, 10));
  }
  const date = parsedDate(value);
  return Number.isFinite(+date) ? escape((showTime ? marketTime : marketDate).format(date)) : scalar(value);
}

function dateOrder(value) {
  if (!available(value)) return -Infinity;
  const date = +parsedDate(value);
  return Number.isFinite(date) ? date : -Infinity;
}

function source(envelope) {
  if (!envelope) return '';
  const parts = [];
  const provider = envelope.provider;
  if (Array.isArray(provider)) parts.push(provider.join(', '));
  else if (provider) parts.push(provider);
  let metadata = parts.length ? escape(parts.join(' · ')) : '';
  if (envelope.asOf) metadata += `${metadata ? ' · ' : ''}As of ${time(envelope.asOf, true)}`;
  if (envelope.fetchedAt && envelope.fetchedAt !== envelope.asOf) metadata += `${metadata ? ' · ' : ''}Retrieved ${time(envelope.fetchedAt, true)}`;
  return metadata ? `<p class="data-label quote-source row-gap">${metadata}</p>` : '';
}

function unavailable(ui, envelope, label, expected, mode) {
  if (!envelope || envelope.loading) return ui.empty(`Loading ${label.toLowerCase()}`, 'Waiting for the data provider.');
  if (mode === 'sample' || envelope.provider === 'Synthetic sample') {
    return ui.empty(`No sample ${label.toLowerCase()}`, 'Connect OpenBB to look up this dataset.');
  }
  const reason = envelope.error?.message ?? (typeof envelope.error === 'string' ? envelope.error : '');
  return ui.empty(`${label} unavailable`, expected) +
    (reason ? `<details class="note"><summary>Provider status</summary><p>${escape(reason)}</p></details>` : '') + source(envelope);
}

function details(data, label = 'Provider fields') {
  if (!data.length) return '';
  const serial = JSON.stringify(data.length === 1 ? data[0] : data, null, 2);
  return `<details class="note"><summary>${escape(label)}</summary><pre class="scroll-note quote-source">${escape(serial)}</pre></details>`;
}

const fixedColumn = (label, keys, format = scalar) => ({label, value:row => field(row, ...keys), format});

function table(data, columns, label) {
  const visible = columns.filter(column => data.some(row => available(column.value(row))));
  if (!visible.length) return '';
  const headers = visible.map(column => `<th scope="col">${escape(column.label)}</th>`).join('');
  const body = data.map(row => `<tr>${visible.map(column => `<td>${column.format(column.value(row), row)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escape(label)}"><table class="data-table" aria-label="${escape(label)}"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function selectedRows(data, entries) {
  return entries.map(([label, keys, format = scalar]) => [label, field(data, ...keys), format])
    .filter(([, value]) => available(value)).map(([label, value, format]) => [label, format(value)]);
}

const profileFields = [
  ['Name', ['name','company_name','long_name','short_name','fund_name']],
  ['Exchange', ['exchange','exchange_name','exchange_short_name','exchange_code','listing_exchange']],
  ['Currency', ['currency','currency_code']], ['Country', ['country','domicile','region']],
  ['Sector', ['sector']], ['Industry', ['industry','industry_group']],
  ['Fiscal year end', ['fiscal_year_end']], ['SEC CIK', ['cik']], ['ISIN', ['isin']], ['CUSIP', ['cusip']],
  ['Employees', ['full_time_employees','employees','employee_count'], numeric],
  ['Market cap', ['market_cap','market_capitalization'], value => numeric(value, true)],
  ['Issuer', ['issuer','fund_family','family']], ['Asset class', ['asset_class','category']],
  ['Inception', ['inception_date','fund_inception_date'], value => time(value)],
  ['Net assets', ['aum','net_assets','total_net_assets','total_assets'], value => numeric(value, true)],
  ['Expense ratio', ['expense_ratio'], value => ratio(value)], ['Management fee', ['management_fee'], value => ratio(value)],
  ['NAV', ['nav','nav_price'], numeric],
  ['Holdings count', ['holdings_count','num_holdings','number_of_holdings'], numeric],
  ['Website', ['website','website_url','url'], value => link(value, value)]
];

function profileBody(envelope, state, ui, fund) {
  const data = rows(envelope);
  if (!data.length) return unavailable(ui, envelope, fund ? 'Fund profile' : 'Company profile', 'The selected provider returned no profile for this symbol.', state.mode);
  const profile = data[0];
  const description = field(profile,'description','company_description','summary','long_business_summary','fund_description','investment_objective');
  const pairs = selectedRows(profile, profileFields);
  return (pairs.length ? ui.kv(pairs) : '') +
    (available(description) ? `<p class="note">${scalar(description)}</p>` : '') + details(data) + source(envelope);
}

const asDate = value => time(value);
const asTime = value => time(value, true);
const asNum = value => numeric(value);
const asCompact = value => numeric(value, true);
const asRatio = value => ratio(value);
const period = ['period_ending','period_end_date','fiscal_date','fiscal_date_ending','report_date','end_date','date','filed_at'];
const statementType = ['statement','statement_type','financial_statement','dataset','data_type'];
const statementPeriod = [
  fixedColumn('Period ending',period,asDate), fixedColumn('Period',['period','fiscal_period','frequency']),
  fixedColumn('Fiscal year',['fiscal_year'],asNum)
];
const statementColumns = [
  ...statementPeriod,
  fixedColumn('Currency',['currency','reported_currency','currency_code']),
  fixedColumn('Revenue',['revenue','total_revenue','net_revenue','sales'],asCompact),
  fixedColumn('Gross profit',['gross_profit'],asCompact), fixedColumn('Operating income',['operating_income'],asCompact),
  fixedColumn('Net income',['net_income','net_income_common_stockholders'],asCompact),
  fixedColumn('Diluted EPS',['diluted_eps','eps_diluted'],asNum),
  fixedColumn('Total assets',['total_assets'],asCompact), fixedColumn('Cash and equivalents',['cash_and_cash_equivalents','cash_and_equivalents','cash'],asCompact),
  fixedColumn('Total liabilities',['total_liabilities','total_liabilities_net_minority_interest'],asCompact),
  fixedColumn('Total debt',['total_debt'],asCompact), fixedColumn('Total equity',['total_equity','stockholders_equity','total_equity_gross_minority_interest'],asCompact),
  fixedColumn('Operating cash flow',['operating_cash_flow','net_cash_flow_from_operating_activities','net_cash_provided_by_operating_activities','cash_flow_from_operations'],asCompact),
  fixedColumn('Capital expenditure',['capital_expenditure','capital_expenditures','capex'],asCompact),
  fixedColumn('Free cash flow',['free_cash_flow'],asCompact),
  fixedColumn('Investing cash flow',['investing_cash_flow','net_cash_flow_from_investing_activities','net_cash_used_for_investing_activities'],asCompact),
  fixedColumn('Financing cash flow',['financing_cash_flow','net_cash_flow_from_financing_activities','net_cash_used_provided_by_financing_activities'],asCompact)
];

const ratioColumns = [
  ...statementPeriod, fixedColumn('Current ratio',['current_ratio'],asNum), fixedColumn('Quick ratio',['quick_ratio'],asNum),
  fixedColumn('Cash ratio',['cash_ratio'],asNum), fixedColumn('Gross margin',['gross_profit_margin','gross_margin'],asRatio),
  fixedColumn('Operating margin',['operating_profit_margin','operating_margin'],asRatio),
  fixedColumn('Net margin',['net_profit_margin','net_margin'],asRatio), fixedColumn('ROE',['return_on_equity'],asRatio),
  fixedColumn('ROA',['return_on_assets'],asRatio), fixedColumn('P/E',['price_to_earnings','price_earnings_ratio','pe_ratio'],asNum)
];

function financialBody(envelope, state, ui, label, columns = statementColumns) {
  const data = rows(envelope);
  if (!data.length) return unavailable(ui, envelope, label, 'Coverage depends on the provider and exchange listing.', state.mode);
  const groups = new Map();
  for (const row of data) {
    const type = String(field(row, ...statementType) ?? '');
    const label = type ? displayKey(type) : '';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }
  const content = [...groups].map(([groupLabel, group]) => {
    const sorted = [...group].sort((a,b) => dateOrder(field(b,...period)) - dateOrder(field(a,...period)));
    const groupTable = table(sorted,columns,groupLabel || label);
    return (groupLabel ? `<p class="eyebrow row-gap">${escape(groupLabel)}</p>` : '') + groupTable + details(sorted);
  }).join('');
  return content + source(envelope);
}

const holdingColumns = [
  fixedColumn('Ticker',['symbol','holding_symbol','asset_symbol','ticker']),
  fixedColumn('Holding',['name','holding_name','asset_name','security_name']),
  {label:'Weight',value:row => field(row,'weight','portfolio_weight','weight_pct','weight_percent'),format:(value,row) => ratio(value,!available(field(row,'weight','portfolio_weight')))},
  fixedColumn('Shares',['shares','shares_held','quantity'],asCompact),
  fixedColumn('Market value',['value','market_value'],asCompact),
  fixedColumn('Currency',['currency','currency_code']),
  fixedColumn('As of',['updated','as_of_date','as_of','date'],asDate)
];

function holdingBody(envelope, state, ui) {
  const data = rows(envelope);
  if (!data.length) return unavailable(ui, envelope, 'ETF holdings', 'Connect a provider that returns holdings for this fund. A stock or futures-based product may have no portfolio holdings in this feed.', state.mode);
  const weights = data.map(row => {
    const normalized = num(field(row,'weight','portfolio_weight'));
    return normalized ?? ((num(field(row,'weight_pct','weight_percent')) ?? -Infinity) / 100);
  });
  const sorted = data.map((row, index) => ({row, weight:weights[index]})).sort((a,b) => b.weight-a.weight).map(entry => entry.row);
  return table(sorted,holdingColumns,'ETF holdings') + details(sorted) + source(envelope);
}

const exDate = ['ex_dividend_date','ex_date','dividend_date','date'];
const dividendColumns = [
  fixedColumn('Ex-date',exDate,asDate), fixedColumn('Amount',['amount','dividend','dividend_amount','cash_amount','rate'],asNum),
  fixedColumn('Currency',['currency','currency_code']), fixedColumn('Declared',['declaration_date','declared_date'],asDate),
  fixedColumn('Record date',['record_date'],asDate), fixedColumn('Payment date',['payment_date','pay_date','payable_date'],asDate),
  fixedColumn('Frequency',['frequency','frequency_name']), fixedColumn('Type',['dividend_type','distribution_type','type'])
];

const earningDate = ['report_date','earnings_date','report_datetime','date','event_date','release_date'];
function earningsStatus(row) {
  const label = field(row,'status','date_status','report_status');
  if (available(label)) return label;
  const estimate = field(row,'is_estimate','estimated','is_projected');
  if (estimate === true) return 'Estimated';
  const confirmed = field(row,'is_confirmed','confirmed');
  return confirmed === true ? 'Confirmed' : null;
}

function marketSession(value) {
  const stem = String(value ?? '').toLowerCase().replace(/[^a-z]/g,'');
  if (['bmo','beforemarketopen','beforeopen','premarket','beforemarket'].includes(stem)) return 'Before open';
  if (['amc','aftermarketclose','afterclose','postmarket','aftermarket'].includes(stem)) return 'After close';
  return scalar(value);
}

const earningsColumns = [
  fixedColumn('Report date',earningDate,asTime),
  fixedColumn('Market session',['reporting_time','time','session','report_session','time_of_day','market_session','earnings_timing'],marketSession),
  {label:'Status',value:earningsStatus,format:scalar},
  fixedColumn('Period',['fiscal_period_ending','period_ending','period','fiscal_period','fiscal_quarter']),
  fixedColumn('EPS actual',['eps_actual','actual_eps','eps','eps_diluted','reported_eps','earnings_per_share'],asNum),
  fixedColumn('EPS estimate',['eps_estimated','eps_estimate','estimated_eps','eps_consensus'],asNum),
  fixedColumn('EPS prior',['eps_previous','previous_eps'],asNum),
  fixedColumn('EPS surprise',['surprise_percent','eps_surprise_percent'],asRatio),
  fixedColumn('Estimates',['num_estimates','analyst_count'],asNum),
  fixedColumn('Revenue actual',['revenue_actual','actual_revenue','revenue','reported_revenue'],asCompact),
  fixedColumn('Revenue estimate',['revenue_estimate','estimated_revenue','revenue_consensus'],asCompact),
  fixedColumn('Currency',['currency','currency_code'])
];

function eventTable(envelope,state,ui,{label,expected,order,columns}) {
  const data = rows(envelope);
  if (!data.length) return unavailable(ui,envelope,label,expected,state.mode);
  const sorted = [...data].sort((a,b) => dateOrder(field(b,...order)) - dateOrder(field(a,...order)));
  return table(sorted,columns,label) + details(sorted) + source(envelope);
}

const published = ['date','published_at','published','pub_date','datetime','created_at','time'];

function newsBody(envelope,state,ui) {
  const data = rows(envelope);
  if (!data.length) return unavailable(ui,envelope,'News','The provider returned no recent headlines for this symbol.',state.mode);
  const sorted = [...data].sort((a,b) => dateOrder(field(b,...published)) - dateOrder(field(a,...published)));
  const items = sorted.map(row => {
    const title = field(row,'title','headline','name') ?? 'Untitled item';
    const publisher = field(row,'publisher','source','site','author');
    const publishedAt = field(row,...published);
    const summary = field(row,'excerpt','summary','description','snippet','teaser');
    const metadata = [available(publisher) ? scalar(publisher) : '',available(publishedAt) ? asTime(publishedAt) : ''].filter(Boolean).join(' · ');
    return `<li>${link(field(row,'url','link','article_url','news_url'),title)}${metadata ? `<small>${metadata}</small>` : ''}${available(summary) ? `<p class="note">${scalar(summary)}</p>` : ''}</li>`;
  });
  return `<ul class="link-list">${items.join('')}</ul>` + source(envelope);
}

const filingDate = ['filing_date','filed_at','date','publication_date'];
const filingColumns = [
  fixedColumn('Filed',filingDate,asDate), fixedColumn('Form',['report_type','form_type','form','type']),
  fixedColumn('Period ending',period.filter(key => key !== 'date' && key !== 'filed_at'),asDate),
  fixedColumn('Issuer',['name','company_name','issuer']),
  {label:'Filing',value:row => url(field(row,'report_url','filing_url','doc_link','url')),format:value => value ? link(value,'Open filing') : missing}
];

function instrumentIsFund(results, knownType) {
  const profile = rows(results.profile)[0];
  const quote = rows(results.quote)[0];
  const type = row => field(row,'asset_type','instrument_type','security_type','quote_type','stock_type','asset_class','type');
  return [type(profile),type(quote),knownType].some(value => /etf|\betn\b|exchange.traded|\bfund\b/i.test(String(value ?? ''))) ||
    profile?.is_etf === true || quote?.is_etf === true ||
    rows(results.fund ?? results.etf).length > 0 || rows(results.holdings).length > 0;
}

export function researchView(tab,state,ui) {
  const results = state.results ?? {};
  const fund = instrumentIsFund(results,state.keys?.[state.symbol]?.type);
  const panel = (name, summary, body) => ui.panel(name,summary,`<div class="panel-body">${body}</div>`);
  if (tab === 'fundamentals') {
    const fundProfile = results.fund ?? results.etf;
    const profileEnvelope = fund && (rows(fundProfile).length || !rows(results.profile).length) ? fundProfile ?? results.profile : results.profile;
    const profile = panel(fund ? 'Fund profile' : 'Company profile', 'Instrument details from the configured feed', profileBody(profileEnvelope,state,ui,fund));
    const statement = (label, summary, envelope, columns) => panel(label,summary,financialBody(envelope,state,ui,label,columns));
    const secondary = fund
      ? panel('ETF holdings','Reported positions. The Nasdaq feed supplies up to ten.',holdingBody(results.holdings,state,ui))
      : statement('Income statement','Reported periods and financial measures',results.financials ?? results.income);
    const moreStatements = fund ? '' : [
      results.balance && statement('Balance sheet','Balance-sheet accounts by period',results.balance),
      (results.cash ?? results.cashflow) && statement('Cash flow','Cash movements by period',results.cash ?? results.cashflow),
      results.ratios && statement('Financial ratios','Profitability and liquidity measures',results.ratios,ratioColumns)
    ].filter(Boolean).join('');
    const filings = fund || !results.filings ? '' : panel('Regulatory filings','Links and forms from the connected filing source',
      eventTable(results.filings,state,ui,{label:'Filings',expected:'The provider returned no filing records for this listing.',order:filingDate,columns:filingColumns}));
    return `<div class="columns">${secondary}${profile}</div>${moreStatements}${filings}`;
  }
  if (tab === 'events') {
    const calendar = results['earnings-calendar'] ?? results.earningsCalendar;
    const scheduled = fund || !calendar ? '' : panel('Earnings calendar','The provider’s scheduled reports within the queried window',
      eventTable(calendar,state,ui,{label:'Earnings calendar',expected:'The calendar returned no reports for this instrument in the requested period.',order:earningDate,columns:earningsColumns}));
    const earnings = fund ? '' : panel('Earnings history','Report dates, earnings and revenue where supplied',
      eventTable(results.earnings,state,ui,{label:'Earnings',expected:'The provider returned no earnings records for this listing.',order:earningDate,columns:earningsColumns}));
    const dividends = panel(fund ? 'Distributions' : 'Dividends','Cash payments and key dates where supplied',
      eventTable(results.dividends,state,ui,{label:fund ? 'Distributions' : 'Dividends',expected:'The provider returned no cash distribution records for this listing.',order:exDate,columns:dividendColumns}));
    const news = panel('Recent news','Headlines from the connected provider',newsBody(results.news,state,ui));
    return scheduled + (earnings ? `<div class="columns equal">${earnings}${dividends}</div>` : dividends) + news;
  }
  return '';
}
