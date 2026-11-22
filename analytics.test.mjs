import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blackScholes, chainSummary, expiryPayoff, expirySummaries, modelScenario,
  normalizeChain, skew25Delta, skewSeries, toCsv, unusualActivity,
} from './dist/analytics.mjs';

const expiry = '2031-01-31';
const asOf = '2031-01-01';
const rows = [
  { contract_symbol: 'TEST310131C00100000', expiration: expiry, strike: 100, option_type: 'call', bid: 3, ask: 4, volume: 200, open_interest: 50, implied_volatility: 0.2, delta: 0.5 },
  { contract_symbol: 'TEST310131P00100000', expiration: expiry, strike: 100, option_type: 'put', bid: 3.5, ask: 4.5, volume: 300, open_interest: 75, implied_volatility: 0.22, delta: -0.5 },
  { contract_symbol: 'TEST310131C00105000', expiration: expiry, strike: 105, option_type: 'call', bid: 1, ask: 1.5, volume: 150, open_interest: 0, implied_volatility: 0.19, delta: 0.3 },
  { contract_symbol: 'TEST310131C00110000', expiration: expiry, strike: 110, option_type: 'call', bid: 0, ask: 0.5, volume: 100, open_interest: 100, implied_volatility: 0.17, delta: 0.2 },
  { contract_symbol: 'TEST310131P00095000', expiration: expiry, strike: 95, option_type: 'put', bid: 1, ask: 1.5, volume: null, open_interest: null, implied_volatility: 0.28, delta: -0.25 },
  { contract_symbol: 'TEST310228P00100000', expiration: '2031-02-28', strike: 100, option_type: 'put', bid: 0, ask: 0, volume: 500, open_interest: 25, implied_volatility: null, delta: null },
];

function approximate(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('unpacks OpenBB columnar OBBjects and preserves quote provenance', () => {
  const input = { ok: true, result: { provider: 'cboe', results: [{
    contract_symbol: ['TEST310131C00100000', 'TEST310131P00100000', 'TEST310131C00110000'],
    expiration: [expiry, expiry, expiry], strike: [100, 100, 110], option_type: ['call', 'put', 'call'],
    bid: [3, 5, 0], ask: [4, 4, 0.5], mark: [3.5, 4.5, 0.25], last_trade_price: [9, 8, 7],
    last_trade_time: ['2031-01-01T15:00:00Z', null, null], open_interest: [0, 50, null],
    implied_volatility: [0.2, null, 0],
  }] } };
  const [normal, crossed, oneSided] = normalizeChain(input);
  assert.equal(normal.source, 'cboe');
  assert.equal(normal.mid, 3.5);
  assert.equal(normal.last, 9);
  assert.equal(normal.quoteTime, null);
  assert.equal(normal.lastTradeTime, '2031-01-01T15:00:00Z');
  assert.equal(normal.openInterest, 0);
  assert.equal(normal.iv, 0.2);
  assert.equal(crossed.mid, null);
  assert.equal(crossed.providerMark, 4.5);
  assert.equal(crossed.quoteStatus, 'crossed');
  assert.equal(oneSided.mid, null);
  assert.equal(oneSided.quoteStatus, 'incomplete');
  assert.equal(oneSided.openInterest, null);
  assert.equal(oneSided.iv, null);
  assert.equal(normalizeChain({ ok: false, data: rows }).length, 0);
  assert.deepEqual(normalizeChain(normalizeChain(input)), normalizeChain(input));
});

test('computes expiry volume, OI coverage, and distinct ATM IV move and straddle metrics', () => {
  const calc = chainSummary(rows, { spot: 100, asOf, expiry });
  assert.equal(calc.contracts, 5);
  assert.equal(calc.twoSidedQuotes, 4);
  assert.equal(calc.callVolume, 450);
  assert.equal(calc.putVolume, 300);
  assert.equal(calc.volumeCoverage, 4);
  assert.equal(calc.callOpenInterest, 150);
  assert.equal(calc.putOpenInterest, 75);
  approximate(calc.putCallVolume, 2 / 3);
  approximate(calc.putCallOpenInterest, 0.5);
  assert.equal(calc.atmStrike, 100);
  approximate(calc.atmIv, 0.21);
  assert.equal(calc.atmIvCoverage, 2);
  assert.equal(calc.days, 30);
  approximate(calc.expectedMove, 21 * Math.sqrt(30 / 365));
  approximate(calc.straddle, 7.5);
  approximate(calc.straddlePct, 0.075);
  assert.equal(chainSummary(rows, { spot: 100, asOf: expiry, expiry }).expectedMove, null);
  assert.equal(chainSummary(rows, { spot: 100, asOf, expiry: '2031-02-28' }).putCallVolume, null);
  assert.equal(chainSummary(rows, { spot: 100, asOf }).totalVolume, 1250);
  assert.deepEqual(expirySummaries(rows, { spot: 100, asOf }).map(row => row.days), [30, 58]);
});

test('respects New York valuation date and adjusted contract families', () => {
  const calc = chainSummary([
    { ...rows[0], contract_symbol: 'TEST1310131C00100000', contract_size: 10 },
    { ...rows[1], contract_size: 100 },
  ], { spot: 100, asOf: '2031-01-02T02:00:00Z', expiry });
  assert.equal(calc.days, 30);
  assert.equal(calc.straddle, null);
  assert.equal(calc.atmIvCoverage, 1);
});

test('screens volume versus positive OI, with separate zero-OI classification', () => {
  const active = unusualActivity(rows, { expiry, minVolume: 125, minRatio: 2, includeZeroOI: true });
  assert.deepEqual(active.map(row => row.volumeToOpenInterest), [4, 4, null]);
  assert.deepEqual(active.map(row => row.signal), ['volume-to-open-interest', 'volume-to-open-interest', 'zero-open-interest']);
  assert.equal(unusualActivity(rows, { expiry, minVolume: 125, minRatio: 2 }).length, 2);
});

test('interpolates 25-delta IV with observed brackets and avoids extrapolation', () => {
  assert.deepEqual(skewSeries(rows, { spot: 100, asOf, expiry }).map(row => row.strike), [95, 100, 105, 110]);
  const result = skew25Delta(rows, { spot: 100, asOf, expiry });
  approximate(result.callIv, 0.18);
  approximate(result.putIv, 0.28);
  approximate(result.putMinusCall, 0.10);
  assert.equal(skew25Delta(rows.slice(0, 2), { spot: 100, asOf, expiry }).putMinusCall, null);
});

test('European pricing returns benchmark Greeks, put-call parity and intrinsic at expiry', () => {
  const assumptions = { spot: 100, strike: 100, days: 365, iv: 0.2, rate: 0.05, dividendYield: 0 };
  const call = blackScholes({ side: 'call', ...assumptions });
  const put = blackScholes({ side: 'put', ...assumptions });
  approximate(call.price, 10.4505835722, 0.00002);
  approximate(put.price, 5.5735260223, 0.00002);
  approximate(call.price - put.price, 100 - 100 * Math.exp(-0.05));
  approximate(call.delta, 0.6368306512);
  approximate(call.gamma, 0.0187620173);
  approximate(call.theta, -0.0175726782);
  approximate(call.vega, 0.3752403469);
  approximate(call.rho, 0.5323248155);
  const discountedPut = blackScholes({ side: 'put', ...assumptions, spot: 0 }).price;
  approximate(discountedPut, 100 * Math.exp(-0.05));
  assert.deepEqual(blackScholes({ side: 'put', spot: 90, strike: 100, days: 0 }), {
    price: 10, delta: null, gamma: null, theta: null, vega: null, rho: null,
  });
  assert.equal(blackScholes({ side: 'call', ...assumptions, iv: null }), null);
});

const call = (strike, premium, action = 'buy') => ({ side: 'call', action, strike, premium, multiplier: 100, expiration: expiry });
const put = (strike, premium, action = 'buy') => ({ side: 'put', action, strike, premium, multiplier: 100, expiration: expiry });

test('finds bounded and unbounded expiry P/L from all strikes and payoff tails', () => {
  const spread = expiryPayoff([call(100, 5), call(110, 2, 'sell')], { spot: 105 });
  assert.equal(spread.entryCost, 300);
  assert.equal(spread.maxProfit, 700);
  assert.equal(spread.maxLoss, 300);
  assert.equal(spread.pnlAtSpot, 200);
  assert.equal(spread.multiplierAssumed, false);
  assert.deepEqual(spread.breakEvens, [103]);
  assert.ok(spread.points.some(point => point.spot === 110 && point.pnl === 700));

  const straddle = expiryPayoff([call(100, 5), put(100, 5)], { spot: 100 });
  assert.deepEqual(straddle.breakEvens, [90, 110]);
  assert.equal(straddle.maxProfit, null);
  assert.equal(straddle.unlimitedProfit, true);
  assert.equal(straddle.maxLoss, 1000);
  assert.equal(straddle.pnlAtSpot, -1000);

  const shortCall = expiryPayoff([call(100, 5, 'sell')]);
  assert.equal(shortCall.entryCost, -500);
  assert.equal(shortCall.maxProfit, 500);
  assert.equal(shortCall.unlimitedLoss, true);
  assert.equal(shortCall.maxLoss, null);
  assert.deepEqual(shortCall.breakEvens, [105]);

  const shortPut = expiryPayoff([put(100, 4, 'sell')], { spot: 0 });
  assert.equal(shortPut.maxProfit, 400);
  assert.equal(shortPut.maxLoss, 9600);
  assert.equal(shortPut.pnlAtSpot, -9600);
  assert.deepEqual(shortPut.breakEvens, [96]);
});

test('handles zero P/L ranges, missing multipliers and calendars explicitly', () => {
  const zero = expiryPayoff([call(100, 2), call(100, 2, 'sell')]);
  assert.deepEqual(zero.breakEvens, []);
  assert.deepEqual(zero.breakevenRanges, [{ from: 0, to: null }]);
  assert.equal(expiryPayoff([{ ...call(100, 2), multiplier: null }]).multiplierAssumed, true);
  assert.match(expiryPayoff([call(100, 2), { ...call(110, 2), expiration: '2031-02-28' }]).error, /one expiration/);
  assert.match(expiryPayoff([{ ...call(100, 2), quantity: 1.5 }]).error, /whole contract quantity/);
});

test('model scenarios mark each leg and converge to exact expiry P/L when elapsed equals DTE', () => {
  const legs = [{ ...call(100, 5), iv: 0.2 }, { ...call(110, 2, 'sell'), iv: 0.22 }];
  const result = modelScenario(legs, { spot: 108, days: 30, daysForward: 30 });
  assert.equal(result.error, null);
  assert.equal(result.pnl, expiryPayoff(legs, { spot: 108 }).pnlAtSpot);
  assert.match(modelScenario(legs, { spot: 100, days: 2, daysForward: 3 }).error, /on or before/);
});

test('CSV escapes labels, special cells and nulls while preserving negative numeric values', () => {
  assert.equal(toCsv([{ note: 'a,"b"', num: -12, custom: '=1+2', missing: null }], [
    { key: 'note', label: 'Note' }, 'num', 'custom', 'missing',
  ]), 'Note,num,custom,missing\r\n"a,""b""",-12,\'=1+2,\r\n');
  assert.equal(toCsv([]), '');
});
