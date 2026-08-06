require('dotenv').config();
// One-time migration: loads your existing data/*.json into the Postgres database.
// Run once after creating the tables:  node seed.js
// Safe to re-run: it upserts (won't create duplicates).

const fs = require('fs');
const path = require('path');
const pool = require('./db').pool;

function readJSON(file) {
  const p = path.join(__dirname, 'data', file);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf-8').trim();
  return raw ? JSON.parse(raw) : [];
}

async function seed() {
  const companies = readJSON('companies.json');
  const reviews = readJSON('reviews.json');
  const reports = readJSON('reports.json');
  const contacts = readJSON('contact-submissions.json');

  console.log(`Seeding ${companies.length} companies, ${reviews.length} reviews, ${reports.length} reports, ${contacts.length} contact submissions...`);

  for (const c of companies) {
    await pool.query(
      `INSERT INTO companies (id, name, tier, industry, verified)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=$2, tier=$3, industry=$4, verified=$5`,
      [c.id, c.name, c.tier ?? null, c.industry ?? null, c.verified ?? false]
    );
  }

  for (const r of reviews) {
    await pool.query(
      `INSERT INTO reviews (id, company_id, role, rating, difficulty_to_get, hourly_pay, location, start_date, end_date, pros, cons, day_in_life, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.companyId, r.role, r.rating, r.difficultyToGet ?? null, r.hourlyPay ?? null,
       r.location || '', r.startDate || null, r.endDate || null,
       r.pros || '', r.cons || '', r.dayInLife || '', r.createdAt || new Date().toISOString()]
    );
  }

  for (const t of reports) {
    await pool.query(
      `INSERT INTO reports (id, review_id, company_id, company_name, reason, details, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.reviewId, t.companyId ?? null, t.companyName ?? null, t.reason,
       t.details || '', t.status || 'open', t.createdAt || new Date().toISOString()]
    );
  }

  for (const s of contacts) {
    await pool.query(
      `INSERT INTO contact_submissions (id, company_name, contact_name, email, message, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.companyName, s.contactName || '', s.email, s.message || '', s.createdAt || new Date().toISOString()]
    );
  }

  console.log('Done seeding.');
  await pool.end();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });