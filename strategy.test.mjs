import test from 'node:test';
import assert from 'node:assert/strict';
import { blackScholes, expiryPayoff, normalizeChain, probabilityOfProfit } from './dist/analytics.mjs';
import { modelCurves, profitProbability } from './dist/options.mjs';

const expiry = '2031-01-31';
const chain = normalizeChain([
  { contract_symbol: 'TEST310131C00100000', expiration: expiry, strike: 100, option_type: 'call', bid: 3, ask: 4, implied_volatility: 0.2 },
  { contract_symbol: 'TEST310131C00110000', expiration: expiry, strike: 110, option_type: 'call', bid: 1, ask: 1.5, implied_volatility: 0.18 },
]);
const state = (overrides = {}) => ({
  rows: chain, results: { chain: { asOf: '2031-01-01' } }, expiry,
  rate: 4, divYield: 0, scenarioIV: '', scenarioDTE: '', ...overrides,
});
const leg = (action, strike, premium) => ({ action, side: 'call', strike: String(strike), premium: String(premium), quantity: '1', multiplier: '100', expiration: expiry });

test('model curves price each leg from the linked chain IV and expiry', () => {
  const legs = [leg('buy', 100, 3.5), leg('sell', 110, 1.25)];
  const { points } = expiryPayoff(legs, { spot: 100 });
  const { curves, note } = modelCurves(state(), legs, points);
  assert.equal(note, '');
  assert.deepEqual(curves.map(c => [c.label, c.daysForward]), [['Today (T+0)', 0], ['T+15 days', 15]]);
  const at = points.findIndex(p => p.spot === 100);
  const long = blackScholes({ side: 'call', spot: 100, strike: 100, days: 30, iv: 0.2, rate: 0.04 });
  const short = blackScholes({ side: 'call', spot: 100, strike: 110, days: 30, iv: 0.18, rate: 0.04 });
  const expected = ((long.price - 3.5) - (short.price - 1.25)) * 100;
  assert.ok(Math.abs(curves[0].values[at] - expected) < 1e-9);
  assert.equal(curves[0].values.length, points.length);
});

test('a spread is worth less than its expiration value deep in the money before expiry', () => {
  const legs = [leg('buy', 100, 3.5), leg('sell', 110, 1.25)];
  const { points } = expiryPayoff(legs, { spot: 100 });
  const { curves } = modelCurves(state(), legs, points);
  const top = points.length - 1;
  assert.ok(curves[0].values[top] < points[top].pnl);
  assert.ok(curves[0].values[top] < curves[1].values[top]);
});

test('overrides apply and missing inputs explain why no curve is drawn', () => {
  const legs = [leg('buy', 100, 3.5)];
  const { points } = expiryPayoff(legs, { spot: 100 });
  const unlinked = modelCurves(state({ rows: [], results: {} }), [{ ...legs[0], expiration: '' }], points);
  assert.equal(unlinked.curves.length, 0);
  assert.match(unlinked.note, /IV and days to expiration/);
  const overridden = modelCurves(state({ rows: [], results: {}, scenarioIV: '25', scenarioDTE: '1' }), [{ ...legs[0], expiration: '' }], points);
  assert.deepEqual(overridden.curves.map(c => c.label), ['Today (T+0)']);
  const expired = modelCurves(state({ scenarioDTE: '0' }), legs, points);
  assert.equal(expired.curves.length, 0);
  assert.match(expired.note, /at expiration/);
});

// Independent normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7).
const erf = x => { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); };
const cdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
const lognormalZ = (price, { spot, days, iv, rate = 0 }) =>
  (Math.log(price) - (Math.log(spot) + (rate - iv ** 2 / 2) * days / 365)) / (iv * Math.sqrt(days / 365));
const market = { spot: 100, days: 30, iv: 0.2, rate: 0.04 };
const put = (action, strike, premium) => ({ ...leg(action, strike, premium), side: 'put' });

test('probability of profit matches the lognormal tail beyond each break-even', () => {
  const call = probabilityOfProfit([leg('buy', 100, 5)], market);
  assert.ok(Math.abs(call.probability - (1 - cdf(lognormalZ(105, market)))) < 1e-6);

  const condor = [put('buy', 90, 0.5), put('sell', 95, 1.5), leg('sell', 105, 1.5), leg('buy', 110, 0.5)];
  const inside = cdf(lognormalZ(107, market)) - cdf(lognormalZ(93, market));
  assert.ok(Math.abs(probabilityOfProfit(condor, market).probability - inside) < 1e-6);

  const straddle = [leg('buy', 100, 4), put('buy', 100, 3)];
  assert.ok(Math.abs(probabilityOfProfit(straddle, market).probability - (1 - inside)) < 1e-6);
});

test('zero-P/L ranges are not profitable and missing inputs return an error', () => {
  const box = [leg('buy', 100, 6), leg('sell', 110, 1), put('buy', 110, 6), put('sell', 100, 1)];
  assert.equal(probabilityOfProfit(box, market).probability, 0);
  assert.match(probabilityOfProfit([leg('buy', 100, 5)], { ...market, iv: null }).error, /positive IV/);
  assert.match(probabilityOfProfit([leg('buy', 100, 5), { ...leg('sell', 110, 1), expiration: '2031-02-28' }], market).error, /share one expiration/);
});

test('Strategy Lab uses the IV override, else the expiry ATM IV', () => {
  const legs = [leg('buy', 100, 3.5)];
  // The ATM strike needs the underlying price, which the app reads from the chain metadata or quote.
  const priced = { rows: chain, results: { chain: { asOf: '2031-01-01', meta: { current_price: 100 } } } };
  const fromChain = profitProbability(state(priced), legs, 100);
  assert.match(fromChain.detail, /ATM IV 20\.0% · 30 DTE/);
  const overridden = profitProbability(state({ scenarioIV: '40', scenarioDTE: '10' }), legs, 100);
  assert.match(overridden.detail, /IV override 40\.0% · 10 DTE/);
  assert.notEqual(fromChain.probability, overridden.probability);
});
