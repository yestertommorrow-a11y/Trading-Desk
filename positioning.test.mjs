import test from 'node:test';
import assert from 'node:assert/strict';
import { blackScholes, gammaExposure, maxPain } from './dist/analytics.mjs';

const expiry = '2031-01-31';
const asOf = '2031-01-01';
const contract = (side, strike, openInterest, extra = {}) => ({
  contract_symbol: `TEST310131${side === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`,
  expiration: expiry, option_type: side, strike, open_interest: openInterest, implied_volatility: 0.2, ...extra,
});

test('max pain minimizes total intrinsic value paid to holders', () => {
  const chain = [contract('call', 90, 10), contract('call', 100, 10), contract('put', 100, 10), contract('put', 110, 10)];
  const pain = maxPain(chain, { expiry });
  // Settling at 90 pays the puts 10,000 + 20,000; at 100 pays 10,000 + 10,000; at 110 pays the calls 20,000 + 10,000.
  assert.deepEqual(pain.curve.map(point => [point.strike, point.payout]), [[90, 30000], [100, 20000], [110, 30000]]);
  assert.equal(pain.strike, 100);
  assert.equal(maxPain(chain, { expiry: '2031-02-28' }), null);
  assert.equal(maxPain([contract('call', 100, 10, { contract_symbol: 'TEST1310131C00100000', adjusted: true }), contract('call', 105, 0)], { expiry }), null);
});

test('gamma exposure scales gamma by open interest, multiplier and spot squared', () => {
  const gex = gammaExposure([contract('call', 100, 100), contract('put', 95, 50)], { spot: 100, asOf, rate: 0.04 });
  const callGamma = blackScholes({ side: 'call', spot: 100, strike: 100, days: 30, iv: 0.2, rate: 0.04 }).gamma;
  const putGamma = blackScholes({ side: 'put', spot: 100, strike: 95, days: 30, iv: 0.2, rate: 0.04 }).gamma;
  const call = callGamma * 100 * 100 * 100 ** 2 * 0.01;
  const put = -putGamma * 50 * 100 * 100 ** 2 * 0.01;
  assert.ok(Math.abs(gex.byStrike.find(p => p.strike === 100).call - call) < 1e-6);
  assert.ok(Math.abs(gex.byStrike.find(p => p.strike === 95).put - put) < 1e-6);
  assert.ok(Math.abs(gex.total - (call + put)) < 1e-6);
  assert.equal(gex.callWall, 100);
  assert.equal(gex.putWall, 95);
});

test('the gamma flip sits between put-heavy and call-heavy strikes', () => {
  const gex = gammaExposure([contract('put', 90, 1000), contract('call', 110, 1000)], { spot: 100, asOf });
  assert.ok(gex.flip > 90 && gex.flip < 110, `flip ${gex.flip}`);
  const below = gex.profile.find(point => point.spot < gex.flip - 2);
  const above = gex.profile.findLast(point => point.spot > gex.flip + 2);
  assert.ok(below.exposure < 0 && above.exposure > 0);
});

test('provider gamma is preferred; same-day, adjusted and gamma-less contracts are excluded', () => {
  const gex = gammaExposure([
    contract('call', 100, 10, { gamma: 0.05 }),
    contract('call', 105, 10, { implied_volatility: null }),
    contract('call', 100, 10, { contract_symbol: 'TEST1310131C00100000', adjusted: true }),
    { ...contract('call', 100, 10), contract_symbol: 'TEST310101C00100000', expiration: asOf },
  ], { spot: 100, asOf });
  assert.equal(gex.contracts, 1);
  assert.equal(gex.skipped, 1);
  assert.equal(gex.providerGamma, 1);
  assert.ok(Math.abs(gex.total - 0.05 * 10 * 100 * 100 ** 2 * 0.01) < 1e-9);
  assert.equal(gammaExposure([contract('call', 100, 10)], { spot: null, asOf }), null);
});

test('IV surface interpolates between strikes, prefers out-of-the-money sides and never extrapolates', async () => {
  const { ivSurface } = await import('./dist/analytics.mjs');
  const chain = [
    contract('put', 90, 1, { implied_volatility: 0.30 }), contract('put', 100, 1, { implied_volatility: 0.24 }),
    contract('call', 100, 1, { implied_volatility: 0.22 }), contract('call', 110, 1, { implied_volatility: 0.20 }),
    contract('call', 90, 1, { implied_volatility: 0.50 }), contract('put', 110, 1, { implied_volatility: 0.60 }),
  ];
  const surface = ivSurface(chain, { spot: 100, asOf, moneyness: [-0.2, -0.05, 0, 0.05, 0.2] });
  const [row] = surface.rows;
  assert.equal(row.days, 30);
  const iv = row.cells.map(cell => cell.iv === null ? null : Math.round(cell.iv * 1e4) / 1e4);
  // −5% uses puts (0.27, midway 90–100), ATM averages 0.24 and 0.22, +5% uses calls (0.21); ±20% lies outside the strikes.
  assert.deepEqual(iv, [null, 0.27, 0.23, 0.21, null]);
  assert.deepEqual(row.cells.map(cell => cell.source), [null, 'put', 'both', 'call', null]);
  assert.ok(Math.abs(surface.min - 0.21) < 1e-12);
  assert.equal(ivSurface(chain, { spot: null, asOf }), null);
});
