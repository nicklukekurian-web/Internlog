'use strict';
// Shared test setup. Must run BEFORE server.js / db.js are required:
// db.js exits the process when DATABASE_URL is unset, and pg only connects on the first query,
// so a dummy URL is enough for tests that never reach the database.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/test';
process.env.ADMIN_KEY = 'test-admin-key';
delete process.env.BREVO_API_KEY; // emails would only be logged, never sent

const http = require('node:http');
const request = require('supertest');

const db = require('../db');
const app = require('../server');

// Each test uses its own client IP (trust proxy = 1 reads X-Forwarded-For), so
// rate-limit counters from one test never leak into another.
let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.${(ipCounter * 7) % 250}`;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => resolve(server));
  });
}

// Replace db.pool.query with a fake; returns the call log so tests can count queries.
function stubPool(handler) {
  const original = db.pool.query;
  const calls = [];
  db.pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return handler(sql, params, calls.length);
  };
  return { calls, restore: () => { db.pool.query = original; } };
}

module.exports = { app, db, request, freshIp, startServer, stubPool };
