'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, freshIp, startServer, stubPool } = require('./helpers');

describe('admin-only company writes', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.close());

  const company = { name: 'Acme Corp', tier: 2, industry: 'Technology', verified: true };

  test('POST /api/companies without an admin key is rejected with 401', async () => {
    const res = await request(server).post('/api/companies').set('X-Forwarded-For', freshIp()).send(company);
    assert.equal(res.status, 401);
  });

  test('POST /api/companies with a wrong admin key is rejected with 401', async () => {
    const res = await request(server).post('/api/companies').set('X-Forwarded-For', freshIp())
      .send({ ...company, adminKey: 'nope' });
    assert.equal(res.status, 401);
  });

  test('PATCH /api/companies/:id without an admin key is rejected with 401', async () => {
    const res = await request(server).patch('/api/companies/c1').set('X-Forwarded-For', freshIp())
      .send({ tier: 3, verified: true });
    assert.equal(res.status, 401);
  });

  test('PATCH /api/companies/:id with a wrong admin key is rejected with 401', async () => {
    const res = await request(server).patch('/api/companies/c1').set('X-Forwarded-For', freshIp())
      .send({ tier: 3, verified: true, adminKey: 'nope' });
    assert.equal(res.status, 401);
  });

  test('DELETE /api/reviews/:id uses the same gate (401, not a different status)', async () => {
    const res = await request(server).delete('/api/reviews/r1').set('X-Forwarded-For', freshIp()).send({});
    assert.equal(res.status, 401);
  });

  test('a rejected write never touches the database', async () => {
    const stub = stubPool(() => ({ rows: [] }));
    try {
      await request(server).post('/api/companies').set('X-Forwarded-For', freshIp()).send(company);
      await request(server).patch('/api/companies/c1').set('X-Forwarded-For', freshIp()).send({ tier: 1 });
      assert.equal(stub.calls.length, 0);
    } finally { stub.restore(); }
  });

  test('the 401 body does not echo the submitted or the real key', async () => {
    const res = await request(server).post('/api/companies').set('X-Forwarded-For', freshIp())
      .send({ ...company, adminKey: 'guess-123' });
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('guess-123'));
    assert.ok(!text.includes('test-admin-key'));
  });

  test('POST /api/companies succeeds with the correct key in the body', async () => {
    const stub = stubPool(() => ({ rows: [{ id: 'c_new', ...company }] }));
    try {
      const res = await request(server).post('/api/companies').set('X-Forwarded-For', freshIp())
        .send({ ...company, adminKey: 'test-admin-key' });
      assert.equal(res.status, 201);
      assert.equal(res.body.name, 'Acme Corp');
    } finally { stub.restore(); }
  });

  test('PATCH /api/companies/:id succeeds with the correct key in the x-admin-key header', async () => {
    const stub = stubPool(() => ({ rows: [{ id: 'c1', name: 'Acme', tier: 3, industry: 'Technology', verified: true }] }));
    try {
      const res = await request(server).patch('/api/companies/c1').set('X-Forwarded-For', freshIp())
        .set('x-admin-key', 'test-admin-key').send({ tier: 3, verified: true });
      assert.equal(res.status, 200);
      assert.equal(res.body.tier, 3);
    } finally { stub.restore(); }
  });

  test('public reads and review submission stay open (no admin key needed)', async () => {
    const stub = stubPool(() => ({ rows: [] }));
    try {
      const get = await request(server).get('/api/companies/does-not-exist').set('X-Forwarded-For', freshIp());
      assert.equal(get.status, 404); // reached the handler, not blocked by auth
      const post = await request(server).post('/api/reviews').set('X-Forwarded-For', freshIp()).send({});
      assert.equal(post.status, 400); // validation error, not 401
    } finally { stub.restore(); }
  });
});
