'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, freshIp, startServer, stubPool } = require('./helpers');

// One row per company, already carrying its stats, as a single aggregated query returns them.
function statRow(i, overrides = {}) {
  return {
    id: `c${i}`, name: `Company ${i}`, tier: (i % 3) + 1, industry: 'Technology', verified: true,
    review_count: 2, avg_rating: '7.5', avg_difficulty: '4.0', most_common_role: 'Software Intern',
    ...overrides
  };
}

describe('GET /api/companies avoids the per-company query fan-out', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.close());

  test('uses exactly one database query no matter how many companies exist', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => statRow(i + 1));
    const stub = stubPool(() => ({ rows }));
    try {
      const res = await request(server).get('/api/companies').set('X-Forwarded-For', freshIp());
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 40);
      assert.equal(stub.calls.length, 1, `expected 1 query, got ${stub.calls.length}`);
    } finally { stub.restore(); }
  });

  test('never has more than one query in flight (cannot exhaust a 15-connection pool)', async () => {
    let inFlight = 0;
    let peak = 0;
    const rows = Array.from({ length: 30 }, (_, i) => statRow(i + 1));
    const stub = stubPool(async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { rows };
    });
    try {
      await request(server).get('/api/companies').set('X-Forwarded-For', freshIp());
      assert.ok(peak <= 1, `peak concurrent queries was ${peak}`);
    } finally { stub.restore(); }
  });

  test('keeps the response shape the frontend relies on', async () => {
    const stub = stubPool(() => ({ rows: [statRow(1)] }));
    try {
      const res = await request(server).get('/api/companies').set('X-Forwarded-For', freshIp());
      assert.deepEqual(res.body[0], {
        id: 'c1', name: 'Company 1', tier: 2, industry: 'Technology', verified: true,
        stats: { reviewCount: 2, avgRating: 7.5, avgDifficulty: 4, mostCommonRole: 'Software Intern' }
      });
    } finally { stub.restore(); }
  });

  test('a company with no reviews gets zero count and null averages, as before', async () => {
    const stub = stubPool(() => ({
      rows: [statRow(1, { review_count: 0, avg_rating: null, avg_difficulty: null, most_common_role: null })]
    }));
    try {
      const res = await request(server).get('/api/companies').set('X-Forwarded-For', freshIp());
      assert.deepEqual(res.body[0].stats, { reviewCount: 0, avgRating: null, avgDifficulty: null, mostCommonRole: null });
    } finally { stub.restore(); }
  });

  test('search, tier and role filters are passed as bound parameters, not interpolated', async () => {
    const stub = stubPool(() => ({ rows: [] }));
    try {
      const evil = "x'; DROP TABLE companies; --";
      await request(server).get('/api/companies').query({ search: evil, tier: '2', role: 'intern' })
        .set('X-Forwarded-For', freshIp());
      assert.equal(stub.calls.length, 1);
      assert.ok(!stub.calls[0].sql.includes('DROP TABLE'));
      assert.ok(stub.calls[0].params.includes(`%${evil}%`));
      assert.ok(stub.calls[0].params.includes(2));
    } finally { stub.restore(); }
  });

  test('GET /api/leaderboard also uses one query and ranks by average rating', async () => {
    const stub = stubPool(() => ({
      rows: [
        statRow(1, { avg_rating: '6.0' }),
        statRow(2, { avg_rating: '9.0' }),
        statRow(3, { review_count: 0, avg_rating: null, avg_difficulty: null, most_common_role: null })
      ]
    }));
    try {
      const res = await request(server).get('/api/leaderboard').set('X-Forwarded-For', freshIp());
      assert.equal(stub.calls.length, 1);
      assert.deepEqual(res.body.map((c) => c.id), ['c2', 'c1']); // reviewed only, best first
    } finally { stub.restore(); }
  });
});
