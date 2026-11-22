const MS_PER_DAY = 86_400_000;
const MARKET_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York',
});
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(?=$|[T ])/;

function number(value) {
  if (typeof value === 'string' && value.trim()) value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonnegative(value) {
  const result = number(value);
  return result !== null && result >= 0 ? result : null;
}

function positive(value) {
  const result = number(value);
  return result !== null && result > 0 ? result : null;
}

function optionSide(value) {
  const side = String(value ?? '').toLowerCase().trim();
  if (side === 'call' || side === 'c') return 'call';
  if (side === 'put' || side === 'p') return 'put';
  return null;
}

function timestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function calendarDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(DATE_PREFIX);
  if (!match) return null;
  const [date] = match;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : null;
}

function marketDate(value) {
  if (value == null) return null;
  if (typeof value === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return calendarDate(value);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(MARKET_DATE.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function unpackRows(input) {
  if (Array.isArray(input)) return input.flatMap(unpackRows);
  if (!input || typeof input !== 'object' || input.ok === false) return [];
  for (const key of ['rows', 'contracts', 'results', 'data', 'result']) {
    if (input[key] && typeof input[key] === 'object') return unpackRows(input[key]);
  }
  const size = [input.contract_symbol, input.contractSymbol, input.strike, input.expiration]
    .filter(Array.isArray).reduce((longest, column) => Math.max(longest, column.length), 0);
  if (size === 0) return [input];
  const columns = Object.entries(input);
  return Array.from({ length: size }, (_, index) => Object.fromEntries(
    columns.map(([key, values]) => [key, Array.isArray(values) ? values[index] : values]),
  ));
}

/** Accept OpenBB records, its columnar model, or the server data envelope. */
export function normalizeChain(input, { provider } = {}) {
  const source = provider ?? input?.provider ?? input?.result?.provider ?? null;
  const rows = [];
  const contracts = new Set();

  for (const row of unpackRows(input)) {
    const expiration = calendarDate(row.expiration ?? row.expiry ?? row.expiration_date ?? row.expirationDate);
    const strike = positive(row.strike ?? row.strike_price ?? row.strikePrice);
    const side = optionSide(row.option_type ?? row.optionType ?? row.side ?? row.type);
    if (!expiration || strike === null || !side) continue;

    const underlyingSymbol = row.underlying_symbol ?? row.underlyingSymbol ?? row.underlying ?? null;
    const contractSymbol = row.contract_symbol ?? row.contractSymbol ?? row.option_symbol ?? row.symbol ?? null;
    const contractRoot = row.contract_root ?? row.contractRoot ?? (typeof contractSymbol==='string' ? contractSymbol.match(/^(.*?)\d{6}[CP]\d{8}$/i)?.[1]?.trim() : null) ?? null;
    const adjusted = row.adjusted === true || Boolean(contractRoot && /[0-9]$/.test(contractRoot) && contractRoot !== underlyingSymbol);
    const multiplier = positive(row.contract_size ?? row.multiplier ?? row.contractSize);
    const identity = contractSymbol || `${underlyingSymbol}:${expiration}:${strike}:${side}:${multiplier}`;
    if (contracts.has(identity)) continue;
    contracts.add(identity);

    const bid = nonnegative(row.bid);
    const ask = nonnegative(row.ask);
    const twoSided = bid > 0 && ask > 0 && bid <= ask;
    const mid = twoSided ? bid + (ask - bid) / 2 : null;
    const bidTime = timestamp(row.bid_time ?? row.bidTime);
    const askTime = timestamp(row.ask_time ?? row.askTime);
    const quoteTime = timestamp(row.quote_time ?? row.quoteTime) ?? (bidTime === askTime ? bidTime : null);

    rows.push({
      contractSymbol,
      contractRoot,
      adjusted,
      underlyingSymbol,
      underlyingPrice: positive(row.underlying_price ?? row.underlyingPrice),
      expiration,
      dte: number(row.dte),
      side,
      strike,
      multiplier,
      bid,
      ask,
      mid,
      spread: twoSided ? ask - bid : null,
      spreadPct: twoSided ? (ask - bid) / mid : null,
      quoteStatus: twoSided ? 'two-sided' : (bid > 0 && ask > 0 ? 'crossed' : 'incomplete'),
      bidSize: nonnegative(row.bid_size ?? row.bidSize),
      askSize: nonnegative(row.ask_size ?? row.askSize),
      bidTime,
      askTime,
      quoteTime,
      last: nonnegative(row.last_trade_price ?? row.last ?? row.lastPrice ?? row.lastTradePrice),
      lastTradeTime: timestamp(row.last_trade_time ?? row.lastTradeTime ?? row.lastTradeDate),
      providerMark: nonnegative(row.mark ?? row.providerMark),
      theoretical: nonnegative(row.theoretical_price ?? row.theoretical ?? row.theoreticalPrice),
      volume: nonnegative(row.volume),
      openInterest: nonnegative(row.open_interest ?? row.openInterest),
      iv: positive(row.implied_volatility ?? row.iv ?? row.impliedVolatility),
      delta: number(row.delta),
      gamma: number(row.gamma),
      theta: number(row.theta),
      vega: number(row.vega),
      rho: number(row.rho),
      greeksTime: timestamp(row.greeks_time ?? row.greeksTime),
      snapshotTime: timestamp(row.timestamp ?? row.snapshotTime),
      eodDate: calendarDate(row.eod_date ?? row.eodDate),
      open: nonnegative(row.open),
      high: nonnegative(row.high),
      low: nonnegative(row.low),
      close: nonnegative(row.close),
      prevClose: nonnegative(row.prev_close ?? row.prevClose),
      change: number(row.change),
      changePct: number(row.change_percent ?? row.changePct),
      currency: row.currency ?? null,
      inTheMoney: typeof (row.in_the_money ?? row.inTheMoney) === 'boolean' ?
        (row.in_the_money ?? row.inTheMoney) : null,
      source: row.source ?? row.provider ?? source,
    });
  }

  return rows.sort((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike ||
    a.side.localeCompare(b.side));
}

function latestEodDate(rows) {
  return rows.reduce((date, row) => row.eodDate && (!date || row.eodDate > date) ? row.eodDate : date, null);
}

function valuationDate(input, rows, asOf) {
  return marketDate(asOf ?? input?.asOf) ?? latestEodDate(rows) ?? marketDate(new Date());
}

function totals(rows, field) {
  const sums = { call: 0, put: 0 };
  const counts = { call: 0, put: 0 };
  for (const row of rows) {
    if (row[field] === null) continue;
    counts[row.side] += 1;
    sums[row.side] += row[field];
  }
  return {
    call: counts.call ? sums.call : null,
    put: counts.put ? sums.put : null,
    ratio: counts.call && counts.put && sums.call > 0 ? sums.put / sums.call : null,
    total: counts.call || counts.put ? sums.call + sums.put : null,
    coverage: counts.call + counts.put,
  };
}

function defaultExpiry(rows, date) {
  if (!date) return null;
  return rows.reduce((selected, row) => row.expiration >= date &&
    (!selected || row.expiration < selected) ? row.expiration : selected, null);
}

export function optionFamily(row) {
  const root = typeof row.contractSymbol === 'string' && row.contractSymbol.match(/^(.*?)\d{6}[CP]\d{8}$/i);
  return `${row.contractRoot || root?.[1]?.trim() || row.underlyingSymbol || ''}:${row.multiplier ?? ''}`;
}

function groupedStrikes(rows) {
  const strikes = new Map();
  for (const row of rows) {
    const family = optionFamily(row);
    const id = `${row.strike}:${family}`;
    const group = strikes.get(id) ?? { strike: row.strike, family, call: null, put: null };
    if (!group[row.side]) group[row.side] = row;
    strikes.set(id, group);
  }
  return [...strikes.values()];
}

function groupQuality(group) {
  // Prefer matched pairs and, at the same strike, the standard deliverable when known.
  return 10 * Number(!(group.call ?? group.put)?.adjusted) + 4 * Number(Boolean(group.call && group.put)) +
    2 * Number((group.call ?? group.put)?.multiplier === 100) +
    Number(Boolean(group.call?.iv && group.put?.iv));
}

function nearestAtm(groups, spot) {
  if (spot === null || !groups.length) return null;
  return groups.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot) ||
    groupQuality(b) - groupQuality(a) || a.strike - b.strike)[0];
}

function marketDays(asOf, expiry) {
  if (!asOf || !expiry) return null;
  const days = (Date.parse(expiry) - Date.parse(asOf)) / MS_PER_DAY;
  return days >= 0 ? days : null;
}

/** Totals refer to the supplied expiry or entire chain. ATM measures always refer to one expiry. */
export function chainSummary(input, { spot, asOf, expiry } = {}) {
  const rows = normalizeChain(input);
  const date = valuationDate(input, rows, asOf);
  const selectedExpiry = expiry ? calendarDate(expiry) : defaultExpiry(rows, date);
  const selected = expiry ? rows.filter(row => row.expiration === selectedExpiry) : rows;
  const atExpiry = selected.filter(row => row.expiration === selectedExpiry);
  const underlying = positive(spot) ?? atExpiry.find(row => row.underlyingPrice !== null)?.underlyingPrice ?? null;
  const callPutVolume = totals(selected, 'volume');
  const callPutOi = totals(selected, 'openInterest');
  const days = marketDays(date, selectedExpiry);
  const atm = nearestAtm(groupedStrikes(atExpiry.filter(row => !row.adjusted)), underlying);
  const callIv = atm?.call?.iv ?? null;
  const putIv = atm?.put?.iv ?? null;
  const ivCount = Number(callIv !== null) + Number(putIv !== null);
  const atmIv = ivCount ? ((callIv ?? 0) + (putIv ?? 0)) / ivCount : null;
  const callMid = atm?.call?.mid ?? null;
  const putMid = atm?.put?.mid ?? null;
  const straddle = callMid !== null && putMid !== null ? callMid + putMid : null;
  // Date-only expirations do not establish the time remaining on expiration day.
  const expectedMovePct = atmIv !== null && days > 0 ? atmIv * Math.sqrt(days / 365) : null;
  const expectedMove = expectedMovePct === null ? null : underlying * expectedMovePct;

  return {
    contracts: selected.length,
    calls: selected.filter(row => row.side === 'call').length,
    puts: selected.filter(row => row.side === 'put').length,
    expiries: new Set(selected.map(row => row.expiration)).size,
    expiration: selectedExpiry,
    expiry: selectedExpiry,
    asOf: date,
    days,
    spot: underlying,
    twoSidedQuotes: selected.filter(row => row.quoteStatus === 'two-sided').length,
    callVolume: callPutVolume.call,
    putVolume: callPutVolume.put,
    totalVolume: callPutVolume.total,
    putCallVolume: callPutVolume.ratio,
    volumeCoverage: callPutVolume.coverage,
    callOpenInterest: callPutOi.call,
    putOpenInterest: callPutOi.put,
    totalOpenInterest: callPutOi.total,
    putCallOpenInterest: callPutOi.ratio,
    openInterestCoverage: callPutOi.coverage,
    atmStrike: atm?.strike ?? null,
    atmIv,
    atmCallIv: callIv,
    atmPutIv: putIv,
    atmIvCoverage: ivCount,
    straddle,
    straddlePct: straddle === null ? null : straddle / underlying,
    expectedMove,
    expectedMovePct,
    rangeLow: expectedMove === null ? null : Math.max(0, underlying - expectedMove),
    rangeHigh: expectedMove === null ? null : underlying + expectedMove,
  };
}

export function expirySummaries(input, options = {}) {
  const groups = new Map();
  const contracts = normalizeChain(input);
  const asOf = valuationDate(input, contracts, options.asOf);
  for (const row of contracts) {
    if (!groups.has(row.expiration)) groups.set(row.expiration, []);
    groups.get(row.expiration).push(row);
  }
  return [...groups.entries()].map(([expiry, rows]) => chainSummary(rows, { ...options, expiry, asOf }));
}

export function skewSeries(input, { spot, expiry, asOf } = {}) {
  const rows = normalizeChain(input);
  const date = valuationDate(input, rows, asOf);
  const expiration = expiry ? calendarDate(expiry) : defaultExpiry(rows, date);
  const selected = rows.filter(row => row.expiration === expiration && !row.adjusted);
  const underlying = positive(spot) ?? selected.find(row => row.underlyingPrice !== null)?.underlyingPrice ?? null;
  const preferred = nearestAtm(groupedStrikes(selected), underlying)?.family;
  const strikes = new Map();

  for (const group of groupedStrikes(selected)) {
    if (preferred && group.family !== preferred) continue;
    const existing = strikes.get(group.strike);
    if (!existing || groupQuality(group) > groupQuality(existing)) strikes.set(group.strike, group);
  }

  return [...strikes.values()].sort((a, b) => a.strike - b.strike).map(({ strike, call, put }) => ({
    strike,
    moneyness: underlying === null ? null : strike / underlying - 1,
    callIv: call?.iv ?? null,
    putIv: put?.iv ?? null,
    callDelta: call?.delta ?? null,
    putDelta: put?.delta ?? null,
  }));
}

function interpolateWing(series, deltaKey, ivKey, target, sign) {
  const points = series.flatMap(row => {
    const absDelta = row[deltaKey] === null ? null : sign * row[deltaKey];
    return absDelta > 0 && absDelta <= 1 && row[ivKey] > 0 ? [{ delta: absDelta, iv: row[ivKey] }] : [];
  }).sort((a, b) => a.delta - b.delta);
  const lower = points.findLast(point => point.delta <= target);
  const upper = points.find(point => point.delta >= target);
  if (!lower || !upper) return null;
  if (lower.delta === upper.delta) return (lower.iv + upper.iv) / 2;
  return lower.iv + (upper.iv - lower.iv) * (target - lower.delta) / (upper.delta - lower.delta);
}

export function skew25Delta(input, options) {
  const series = skewSeries(input, options);
  const callIv = interpolateWing(series, 'callDelta', 'callIv', 0.25, 1);
  const putIv = interpolateWing(series, 'putDelta', 'putIv', 0.25, -1);
  return { callIv, putIv, putMinusCall: callIv !== null && putIv !== null ? putIv - callIv : null };
}

/** This screen measures current session volume against reported OI. It has no trade direction or opening/closing data. */
export function unusualActivity(input, { expiry, minVolume = 100, minRatio = 1, includeZeroOI = false, limit = 100 } = {}) {
  const rows = normalizeChain(input);
  const selected = expiry ? rows.filter(row => row.expiration === expiry) : rows;
  const hits = [];
  for (const row of selected) {
    if (row.volume === null || row.volume < minVolume || row.openInterest === null) continue;
    const volumeToOpenInterest = row.openInterest > 0 ? row.volume / row.openInterest : null;
    if (volumeToOpenInterest !== null && volumeToOpenInterest >= minRatio) {
      hits.push({ ...row, volumeToOpenInterest, ratio: volumeToOpenInterest, signal: 'volume-to-open-interest' });
    } else if (volumeToOpenInterest === null && includeZeroOI && row.volume > 0) {
      hits.push({ ...row, volumeToOpenInterest: null, ratio: null, signal: 'zero-open-interest' });
    }
  }

  return hits.sort((a, b) => (b.volumeToOpenInterest ?? -1) - (a.volumeToOpenInterest ?? -1) ||
    b.volume - a.volume).slice(0, Math.max(0, limit));
}

const inverseRootTwoPi = 1 / Math.sqrt(2 * Math.PI);
const normalDensity = value => Math.exp(-(value ** 2) / 2) * inverseRootTwoPi;

function normalDistribution(value) {
  const t = 1 / (1 + 0.2316419 * Math.abs(value));
  const poly = t * (0.319381530 + t * (-0.356563782 +
    t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = normalDensity(value) * poly;
  return value >= 0 ? 1 - tail : tail;
}

function intrinsic(side, spot, strike) {
  return Math.max(side === 'call' ? spot - strike : strike - spot, 0);
}

/** European model with continuous dividend yield, ACT/365. Theta/day and vega/rho per percentage point. */
export function blackScholes(input = {}) {
  const side = optionSide(input.side ?? input.type ?? input.optionType);
  const spot = nonnegative(input.spot);
  const strike = positive(input.strike);
  const days = nonnegative(input.days ?? input.dte);
  const iv = positive(input.iv ?? input.volatility);
  const rate = number(input.rate === undefined ? 0 : input.rate);
  const dividendYield = number(input.dividendYield === undefined ? 0 : input.dividendYield);
  if (!side || spot === null || strike === null || days === null) return null;
  if (days === 0) {
    return { price: intrinsic(side, spot, strike), delta: null, gamma: null, theta: null, vega: null, rho: null };
  }
  if (iv === null || rate === null || dividendYield === null) return null;

  const years = days / 365;
  const rootYears = Math.sqrt(years);
  const sigmaRootYears = iv * rootYears;
  const stockDiscount = Math.exp(-dividendYield * years);
  const strikeDiscount = Math.exp(-rate * years);
  const stockValue = spot * stockDiscount;
  const strikeValue = strike * strikeDiscount;
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + iv ** 2 / 2) * years) / sigmaRootYears;
  const d2 = d1 - sigmaRootYears;
  const density = normalDensity(d1);
  const sign = side === 'call' ? 1 : -1;
  const nd1 = normalDistribution(sign * d1);
  const nd2 = normalDistribution(sign * d2);
  const price = Math.max(0, sign * (stockValue * nd1 - strikeValue * nd2));
  const delta = sign * stockDiscount * nd1;
  const gamma = spot === 0 ? 0 : stockDiscount * density / (spot * sigmaRootYears);
  const theta = (-stockValue * density * iv / (2 * rootYears) +
    sign * (dividendYield * stockValue * nd1 - rate * strikeValue * nd2)) / 365;
  const vega = stockValue * density * rootYears / 100;
  const rho = sign * strikeValue * years * nd2 / 100;
  const result = { price, delta, gamma, theta, vega, rho };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function signedQuantity(leg) {
  const quantity = number(leg.quantity ?? leg.qty ?? 1);
  if (!Number.isInteger(quantity) || quantity === 0) return null;
  const action = String(leg.action ?? leg.direction ?? leg.position ?? '').toLowerCase().trim();
  if (!action) return quantity;
  if (action === 'buy' || action === 'long') return Math.abs(quantity);
  if (action === 'sell' || action === 'short') return -Math.abs(quantity);
  return null;
}

function prepareLegs(legs, defaultMultiplier) {
  if (!Array.isArray(legs) || !legs.length) return { error: 'Add at least one option leg.' };
  const normalized = [];
  for (const leg of legs) {
    if (!leg || typeof leg !== 'object') return { error: 'Each leg must be an option.' };
    const side = optionSide(leg.optionType ?? leg.type ?? leg.side);
    const strike = positive(leg.strike);
    const premium = nonnegative(leg.premium ?? leg.price ?? leg.entryPrice);
    const quantity = signedQuantity(leg);
    const multiplierValue = leg.multiplier ?? leg.contract_size;
    const multiplierAssumed = multiplierValue == null;
    const multiplier = positive(multiplierAssumed ? defaultMultiplier : multiplierValue);
    const expirationInput = leg.expiration ?? leg.expiry ?? null;
    const expiration = calendarDate(expirationInput);
    if (!side || strike === null || premium === null || quantity === null || multiplier === null) {
      return { error: 'Each leg needs a call or put, a valid strike, a nonnegative premium, a whole contract quantity, and a positive multiplier.' };
    }
    if (expirationInput && !expiration) return { error: 'Use a valid expiration date for each leg.' };
    const units = quantity * multiplier;
    if (![units, premium * units, strike * units].every(Number.isFinite)) {
      return { error: 'One or more leg values are outside the supported range.' };
    }
    normalized.push({ side, strike, premium, quantity, multiplier, multiplierAssumed, units, expiration });
  }
  return { normalized, multiplierAssumed: normalized.some(leg => leg.multiplierAssumed) };
}

/** European-model mark and P/L by leg, using supplied per-leg or shared DTE and IV inputs. */
export function modelScenario(legs, { spot, days, iv, rate, dividendYield, ivShift = 0, daysForward = 0, multiplier = 100 } = {}) {
  const prepared = prepareLegs(legs, multiplier);
  if (prepared.error) return { error: prepared.error };
  const elapsed = nonnegative(daysForward);
  const volatilityShift = number(ivShift);
  if (elapsed === null || volatilityShift === null) return { error: 'Enter a valid time and volatility shift.' };

  const marks = [];
  for (const [index, leg] of prepared.normalized.entries()) {
    const currentDays = nonnegative(legs[index].days ?? legs[index].dte ?? days);
    const currentIv = positive(legs[index].iv ?? iv);
    if (currentDays === null || elapsed > currentDays) return { error: 'Set the scenario to a date on or before each leg’s expiration.' };
    const model = blackScholes({
      side: leg.side, strike: leg.strike, spot, rate, dividendYield, days: currentDays - elapsed,
      iv: currentIv === null ? null : currentIv + volatilityShift,
    });
    if (model === null) return { error: 'A valid spot, remaining time, and positive model volatility are required before expiration.' };
    marks.push({ ...leg, ...model, value: model.price * leg.units, pnl: (model.price - leg.premium) * leg.units });
  }

  return {
    marks,
    modelValue: marks.reduce((total, leg) => total + leg.value, 0),
    pnl: marks.reduce((total, leg) => total + leg.pnl, 0),
    multiplierAssumed: prepared.multiplierAssumed,
    error: null,
  };
}

function payoffBreakEvens(anchors, tailSlope, epsilon) {
  const breakEvens = [];
  const breakevenRanges = [];
  for (const [index, lower] of anchors.entries()) {
    const upper = anchors[index + 1];
    if (lower.pnl === 0) breakEvens.push(lower.spot);
    if (upper?.pnl === 0 && lower.pnl === 0) {
      breakevenRanges.push({ from: lower.spot, to: upper.spot });
    } else if (upper && lower.pnl * upper.pnl < 0) {
      breakEvens.push(lower.spot - lower.pnl * (upper.spot - lower.spot) / (upper.pnl - lower.pnl));
    } else if (!upper) {
      if (Math.abs(tailSlope) <= epsilon && lower.pnl === 0) {
        breakevenRanges.push({ from: lower.spot, to: null });
      } else if (lower.pnl * tailSlope < 0) {
        breakEvens.push(lower.spot - lower.pnl / tailSlope);
      }
    }
  }

  // Adjacent zero-value segments form one range and do not produce discrete break-evens.
  const merged = [];
  for (const range of breakevenRanges) {
    const previous = merged.at(-1);
    if (previous?.to === range.from) previous.to = range.to;
    else merged.push({ ...range });
  }
  return {
    breakEvens: breakEvens.filter(value => !merged.some(range => value >= range.from && (range.to === null || value <= range.to))),
    breakevenRanges: merged,
  };
}

/** Exact piecewise payoff for stock/ETF options sharing one expiration, before commissions. */
export function expiryPayoff(legs, { spot, points = 101, minSpot, maxSpot, multiplier = 100 } = {}) {
  const prepared = prepareLegs(legs, multiplier);
  if (prepared.error) return { ...prepared, points: [], breakEvens: [] };
  const { normalized, multiplierAssumed } = prepared;
  const expirations = new Set(normalized.map(leg => leg.expiration).filter(Boolean));
  if (expirations.size > 1) {
    return { error: 'Exact expiration payoff requires every leg to share one expiration.', points: [], breakEvens: [] };
  }
  const entryCost = normalized.reduce((total, leg) => total + leg.units * leg.premium, 0);
  const strikePoints = [...new Set([0, ...normalized.map(leg => leg.strike)])].sort((a, b) => a - b);
  const tailSlope = normalized.reduce((slope, leg) => slope + (leg.side === 'call' ? leg.units : 0), 0);
  const epsilon = 1e-9;
  const pnl = underlying => {
    const value = normalized.reduce((total, leg) => total + intrinsic(leg.side, underlying, leg.strike) * leg.units, -entryCost);
    return Math.abs(value) < epsilon ? 0 : value;
  };
  const anchors = strikePoints.map(underlying => ({ spot: underlying, pnl: pnl(underlying) }));
  const { breakEvens, breakevenRanges } = payoffBreakEvens(anchors, tailSlope, epsilon);
  const underlying = nonnegative(spot);
  const unlimitedProfit = tailSlope > epsilon;
  const unlimitedLoss = tailSlope < -epsilon;
  const anchorValues = anchors.map(point => point.pnl);
  const bestCase = unlimitedProfit ? null : Math.max(...anchorValues);
  const worstCase = unlimitedLoss ? null : Math.min(...anchorValues);
  const center = underlying > 0 ? underlying : strikePoints[Math.ceil((strikePoints.length - 1) / 2)];
  const bounds = [...strikePoints.slice(1), ...breakEvens];
  const lo = nonnegative(minSpot) ?? Math.max(0, Math.min(center * 0.75, ...bounds.map(point => point * 0.9)));
  const hi = positive(maxSpot) ?? Math.max(center * 1.25, ...bounds.map(point => point * 1.1));
  if (hi <= lo) return { error: 'The chart maximum must exceed its minimum.', points: [], breakEvens };
  const chartCount = Math.min(401, Math.max(2, Math.trunc(number(points) ?? 101)));
  const xValues = new Set(Array.from({ length: chartCount }, (_, index) => lo + (hi - lo) * index / (chartCount - 1)));
  for (const point of [...bounds, underlying]) {
    if (point !== null && point >= lo && point <= hi) xValues.add(point);
  }

  return {
    points: [...xValues].sort((a, b) => a - b).map(underlying => ({ spot: underlying, pnl: pnl(underlying) })),
    netPremium: entryCost === 0 ? 0 : -entryCost,
    entryCost,
    bestCase,
    worstCase,
    maxProfit: bestCase === null ? null : Math.max(0, bestCase),
    maxLoss: worstCase === null ? null : Math.max(0, -worstCase),
    unlimitedProfit,
    unlimitedLoss,
    breakEvens,
    breakevenRanges,
    pnlAtSpot: underlying === null ? null : pnl(underlying),
    multiplierAssumed,
    error: null,
  };
}

function interpolateStrike(points, strike) {
  const exact = points.find(point => point.strike === strike);
  if (exact) return exact.iv;
  const lower = points.findLast(point => point.strike < strike);
  const upper = points.find(point => point.strike > strike);
  if (!lower || !upper) return null;
  return lower.iv + (upper.iv - lower.iv) * (strike - lower.strike) / (upper.strike - lower.strike);
}

/**
 * IV surface: for each expiration, IV at strikes spot × (1 + moneyness), linearly interpolated
 * between observed strikes (never extrapolated). Out-of-the-money contracts are preferred
 * (puts below spot, calls above), with the other side as fallback; at the money averages both.
 */
export function ivSurface(input, { spot, asOf, moneyness = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2] } = {}) {
  const underlying = positive(spot);
  const rows = normalizeChain(input);
  const date = valuationDate(input, rows, asOf);
  if (underlying === null || !date) return null;
  const expirations = new Map();
  for (const row of rows) {
    if (row.adjusted || row.iv === null) continue;
    const days = marketDays(date, row.expiration);
    if (!(days > 0)) continue;
    const entry = expirations.get(row.expiration) ?? { expiration: row.expiration, days, call: [], put: [] };
    entry[row.side].push({ strike: row.strike, iv: row.iv });
    expirations.set(row.expiration, entry);
  }
  const surface = [...expirations.values()].sort((a, b) => a.days - b.days).map(({ expiration, days, call, put }) => {
    call.sort((a, b) => a.strike - b.strike);
    put.sort((a, b) => a.strike - b.strike);
    const cells = moneyness.map(offset => {
      const strike = underlying * (1 + offset);
      const callIv = interpolateStrike(call, strike);
      const putIv = interpolateStrike(put, strike);
      let iv = null;
      let source = null;
      if (offset === 0 && callIv !== null && putIv !== null) [iv, source] = [(callIv + putIv) / 2, 'both'];
      else if (offset <= 0) [iv, source] = putIv !== null ? [putIv, 'put'] : [callIv, callIv === null ? null : 'call'];
      else [iv, source] = callIv !== null ? [callIv, 'call'] : [putIv, putIv === null ? null : 'put'];
      return { moneyness: offset, strike, iv, source };
    });
    return { expiration, days, cells };
  }).filter(row => row.cells.some(cell => cell.iv !== null));
  const values = surface.flatMap(row => row.cells.map(cell => cell.iv).filter(iv => iv !== null));
  if (!values.length) return null;
  return { spot: underlying, asOf: date, moneyness, rows: surface, min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Max pain: the settlement price, among listed strikes, that minimizes the total intrinsic value
 * paid to holders of open contracts at one expiration. Uses reported open interest only.
 */
export function maxPain(input, { expiry } = {}) {
  const expiration = calendarDate(expiry);
  const rows = normalizeChain(input).filter(row => row.expiration === expiration && !row.adjusted &&
    row.openInterest !== null);
  const openInterest = rows.reduce((total, row) => total + row.openInterest, 0);
  const strikes = [...new Set(rows.map(row => row.strike))].sort((a, b) => a - b);
  if (!expiration || strikes.length < 2 || openInterest <= 0) return null;
  const curve = strikes.map(settle => ({
    strike: settle,
    payout: rows.reduce((total, row) => total + row.openInterest * (row.multiplier ?? 100) *
      intrinsic(row.side, settle, row.strike), 0),
  }));
  const best = curve.reduce((low, point) => point.payout < low.payout ? point : low);
  return { expiry: expiration, strike: best.strike, payout: best.payout, curve, contracts: rows.length, openInterest };
}

function modelGamma(spot, strike, years, iv, rate, dividendYield) {
  const rootYears = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + iv ** 2 / 2) * years) / (iv * rootYears);
  return Math.exp(-dividendYield * years) * normalDensity(d1) / (spot * iv * rootYears);
}

/**
 * Naive dealer gamma exposure in dollars per 1% underlying move: gamma × OI × multiplier × spot² × 0.01,
 * positive for calls and negative for puts (dealers assumed long calls, short puts).
 * Provider gamma is used at the current spot when supplied; otherwise Black–Scholes gamma from the contract IV.
 * The gamma flip is where the modeled total crosses zero as the underlying moves, using contract IVs.
 */
export function gammaExposure(input, { spot, asOf, expiry, rate = 0, dividendYield = 0, range = 0.2, steps = 81 } = {}) {
  const underlying = positive(spot);
  const rows = normalizeChain(input);
  const date = valuationDate(input, rows, asOf);
  const expiration = expiry ? calendarDate(expiry) : null;
  const r = number(rate) ?? 0;
  const q = number(dividendYield) ?? 0;
  if (underlying === null || !date) return null;
  const contracts = [];
  let skipped = 0;
  for (const row of rows) {
    if (row.adjusted || !(row.openInterest > 0) || (expiration && row.expiration !== expiration)) continue;
    const days = marketDays(date, row.expiration);
    // Date-only expirations give no time left on expiration day, so those contracts are excluded.
    if (!(days > 0)) continue;
    const years = days / 365;
    const units = row.openInterest * (row.multiplier ?? 100) * (row.side === 'call' ? 1 : -1);
    const provider = row.gamma !== null && row.gamma >= 0;
    const gamma = provider ? row.gamma :
      row.iv !== null ? modelGamma(underlying, row.strike, years, row.iv, r, q) : null;
    if (gamma === null || !Number.isFinite(gamma)) { skipped += 1; continue; }
    contracts.push({ strike: row.strike, side: row.side, units, gamma, years, iv: row.iv, provider });
  }
  if (!contracts.length) return null;

  const scale = price => price ** 2 * 0.01;
  const strikes = new Map();
  for (const contract of contracts) {
    const exposure = contract.gamma * contract.units * scale(underlying);
    const point = strikes.get(contract.strike) ?? { strike: contract.strike, call: 0, put: 0, net: 0 };
    point[contract.side] += exposure;
    point.net += exposure;
    strikes.set(contract.strike, point);
  }
  const byStrike = [...strikes.values()].sort((a, b) => a.strike - b.strike);
  const total = byStrike.reduce((sum, point) => sum + point.net, 0);
  const callWall = byStrike.reduce((best, point) => point.call > (best?.call ?? 0) ? point : best, null)?.strike ?? null;
  const putWall = byStrike.reduce((best, point) => point.put < (best?.put ?? 0) ? point : best, null)?.strike ?? null;

  const modeled = contracts.filter(contract => contract.iv !== null);
  const profile = Array.from({ length: Math.max(3, steps) }, (_, index) => {
    const price = underlying * (1 - range + 2 * range * index / (Math.max(3, steps) - 1));
    const exposure = modeled.reduce((sum, contract) => sum + contract.units *
      modelGamma(price, contract.strike, contract.years, contract.iv, r, q), 0) * scale(price);
    return { spot: price, exposure };
  });
  let flip = null;
  for (const [index, lower] of profile.entries()) {
    const upper = profile[index + 1];
    if (!upper || lower.exposure * upper.exposure > 0 || lower.exposure === upper.exposure) continue;
    const crossing = lower.spot + (upper.spot - lower.spot) * lower.exposure / (lower.exposure - upper.exposure);
    if (flip === null || Math.abs(crossing - underlying) < Math.abs(flip - underlying)) flip = crossing;
  }
  return {
    asOf: date, spot: underlying, expiry: expiration, total, byStrike, callWall, putWall, flip, profile,
    contracts: contracts.length, skipped, providerGamma: contracts.filter(contract => contract.provider).length,
  };
}

/**
 * Probability that the expiration P/L is positive, with the underlying lognormal at expiration:
 * ln(S_T) ~ N(ln S + (r − q − σ²/2)·T, σ²·T), T = days / 365 (risk-neutral drift).
 * Zero-P/L ranges count as not profitable. All legs must share one expiration.
 */
export function probabilityOfProfit(legs, { spot, days, iv, rate = 0, dividendYield = 0, multiplier = 100 } = {}) {
  const payoff = expiryPayoff(legs, { spot, multiplier });
  if (payoff.error) return { probability: null, error: payoff.error };
  const underlying = positive(spot);
  const remaining = positive(days);
  const sigma = positive(iv);
  const r = number(rate);
  const q = number(dividendYield);
  if (underlying === null || remaining === null || sigma === null || r === null || q === null) {
    return { probability: null, error: 'Probability of profit needs a spot price, days to expiration and a positive IV.' };
  }
  const prepared = prepareLegs(legs, multiplier).normalized;
  const entryCost = prepared.reduce((total, leg) => total + leg.units * leg.premium, 0);
  const pnl = price => prepared.reduce((total, leg) => total + intrinsic(leg.side, price, leg.strike) * leg.units, -entryCost);
  const years = remaining / 365;
  const mean = Math.log(underlying) + (r - q - sigma ** 2 / 2) * years;
  const width = sigma * Math.sqrt(years);
  const cumulative = price => price <= 0 ? 0 : price === Infinity ? 1 : normalDistribution((Math.log(price) - mean) / width);
  // P/L is linear between strikes and changes sign only at break-evens, so its sign is constant on each interval.
  const edges = [...new Set([0, ...prepared.map(leg => leg.strike), ...payoff.breakEvens,
    ...payoff.breakevenRanges.flatMap(range => [range.from, range.to ?? 0])])].sort((a, b) => a - b);
  let probability = 0;
  for (const [index, lower] of edges.entries()) {
    const upper = edges[index + 1] ?? Infinity;
    const probe = upper === Infinity ? lower * 2 + 1 : (lower + upper) / 2;
    if (pnl(probe) > 1e-9) probability += cumulative(upper) - cumulative(lower);
  }
  return { probability: Math.min(1, Math.max(0, probability)), error: null };
}

function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text = String(value);
  // Treat prefixed text as text when an exported CSV is opened by a spreadsheet.
  if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Columns may be field names or `{key,label}` objects. */
export function toCsv(rows, columns = Object.keys(rows[0] ?? {})) {
  const fields = columns.map(column => typeof column === 'string' ? { key: column, label: column } : column);
  const header = fields.map(field => csvCell(field.label ?? field.key)).join(',');
  if (!fields.length) return '';
  const records = rows.map(row => fields.map(field => csvCell(row[field.key])).join(','));
  return [header, ...records].join('\r\n') + '\r\n';
}
