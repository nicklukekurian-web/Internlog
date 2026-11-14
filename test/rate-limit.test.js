'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, freshIp, startServer } = require('./helpers');

describe('rate-limit tiers', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.close());

  // The write tier counts requests even when validation rejects them, so an empty body
  // (400, never reaches the database) is enough to exercise it.
  test('write tier: 8 submissions per window, the 9th is 429', async () => {
    const ip = freshIp();
    for (let i = 1; i <= 8; i++) {
      const res = await request(server).post('/api/reviews').set('X-Forwarded-For', ip).send({});
      assert.equal(res.status, 400, `request ${i} should reach validation`);
    }
    const blocked = await request(server).post('/api/reviews').set('X-Forwarded-For', ip).send({});
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /Too many submissions/);
  });

  test('admin tier: 20 attempts per window, the 21st is 429', async () => {
    const ip = freshIp();
    for (let i = 1; i <= 20; i++) {
      const res = await request(server).patch('/api/companies/c1').set('X-Forwarded-For', ip).send({ tier: 1 });
      assert.notEqual(res.status, 429, `request ${i} should not be limited yet`);
    }
    const blocked = await request(server).patch('/api/companies/c1').set('X-Forwarded-For', ip).send({ tier: 1 });
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /Too many attempts/);
  });

  test('general tier: 300 API requests per window, the 301st is 429', async () => {
    const ip = freshIp();
    for (let i = 1; i <= 300; i++) {
      const res = await request(server).get('/api/no-such-route').set('X-Forwarded-For', ip);
      assert.notEqual(res.status, 429, `request ${i} should not be limited yet`);
    }
    const blocked = await request(server).get('/api/no-such-route').set('X-Forwarded-For', ip);
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /Too many requests/);
  });

  test('each tier advertises its own limit in the standard headers', async () => {
    const write = await request(server).post('/api/reviews').set('X-Forwarded-For', freshIp()).send({});
    const admin = await request(server).patch('/api/companies/c1').set('X-Forwarded-For', freshIp()).send({});
    const general = await request(server).get('/api/no-such-route').set('X-Forwarded-For', freshIp());
    // Write routes are covered by both the general and the write limiter; the stricter one is reported.
    assert.equal(write.headers['ratelimit-limit'], '8');
    assert.equal(admin.headers['ratelimit-limit'], '20');
    assert.equal(general.headers['ratelimit-limit'], '300');
  });

  test('limits are per client IP (trust proxy reads X-Forwarded-For)', async () => {
    const noisy = freshIp();
    const quiet = freshIp();
    for (let i = 0; i < 9; i++) {
      await request(server).post('/api/reviews').set('X-Forwarded-For', noisy).send({});
    }
    const blocked = await request(server).post('/api/reviews').set('X-Forwarded-For', noisy).send({});
    const other = await request(server).post('/api/reviews').set('X-Forwarded-For', quiet).send({});
    assert.equal(blocked.status, 429);
    assert.equal(other.status, 400);
  });
});
