const { Pool } = require('pg');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Set it in a local .env file or in your host\'s environment variables.');
  process.exit(1);
}

// Supabase requires SSL; local Postgres does not.
const useSsl = /supabase/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- companies ----------

async function getCompanies({ search, tier, role } = {}) {
  const clauses = [];
  const params = [];
  if (search) { params.push(`%${search}%`); clauses.push(`name ILIKE $${params.length}`); }
  if (tier) { params.push(Number(tier)); clauses.push(`tier = $${params.length}`); }
  if (role) {
    params.push(`%${role}%`);
    clauses.push(`id IN (SELECT company_id FROM reviews WHERE role ILIKE $${params.length})`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { rows } = await pool.query(`SELECT * FROM companies ${where} ORDER BY name`, params);
  return rows;
}

async function getCompanyById(id) {
  const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createCompany({ name, tier, industry, verified }) {
  const id = genId('c');
  const { rows } = await pool.query(
    `INSERT INTO companies (id, name, tier, industry, verified)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, name, (tier === undefined || tier === null) ? null : Number(tier),
     industry || 'Other', verified === undefined ? true : Boolean(verified)]
  );
  return rows[0];
}

async function updateCompany(id, { tier, verified, industry }) {
  const sets = [];
  const params = [];
  if (tier !== undefined) { params.push(tier === null ? null : Number(tier)); sets.push(`tier = $${params.length}`); }
  if (verified !== undefined) { params.push(Boolean(verified)); sets.push(`verified = $${params.length}`); }
  if (industry !== undefined) { params.push(industry); sets.push(`industry = $${params.length}`); }
  if (!sets.length) return getCompanyById(id);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE companies SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
  );
  return rows[0] || null;
}

async function findOrCreateCompany(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const existing = await pool.query('SELECT * FROM companies WHERE LOWER(name) = LOWER($1)', [trimmed]);
  if (existing.rows[0]) return existing.rows[0];
  const id = genId('c');
  const { rows } = await pool.query(
    `INSERT INTO companies (id, name, tier, industry, verified)
     VALUES ($1,$2,NULL,'Unverified',false) RETURNING *`,
    [id, trimmed]
  );
  return rows[0];
}

// ---------- stats ----------

async function companyStats(companyId) {
  const agg = await pool.query(
    `SELECT COUNT(*)::int AS review_count,
            ROUND(AVG(rating)::numeric, 1) AS avg_rating,
            ROUND(AVG(difficulty_to_get)::numeric, 1) AS avg_difficulty
     FROM reviews WHERE company_id = $1`, [companyId]
  );
  const roleRow = await pool.query(
    `SELECT role FROM reviews WHERE company_id = $1
     GROUP BY role ORDER BY COUNT(*) DESC, role ASC LIMIT 1`, [companyId]
  );
  const a = agg.rows[0];
  return {
    reviewCount: a.review_count,
    avgRating: a.avg_rating !== null ? Number(a.avg_rating) : null,
    avgDifficulty: a.avg_difficulty !== null ? Number(a.avg_difficulty) : null,
    mostCommonRole: roleRow.rows[0] ? roleRow.rows[0].role : null
  };
}

// ---------- reviews ----------

async function getReviewsForCompany(companyId, role) {
  const params = [companyId];
  let sql = 'SELECT * FROM reviews WHERE company_id = $1';
  if (role) { params.push(`%${role}%`); sql += ` AND role ILIKE $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function getReviewById(id) {
  const { rows } = await pool.query('SELECT * FROM reviews WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createReview(r) {
  const id = genId('r');
  const { rows } = await pool.query(
    `INSERT INTO reviews (id, company_id, role, rating, difficulty_to_get, hourly_pay, location, start_date, end_date, pros, cons, day_in_life, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now()) RETURNING *`,
    [id, r.companyId, r.role, r.rating, r.difficultyToGet ?? null, r.hourlyPay ?? null,
     r.location || '', r.startDate || null, r.endDate || null,
     r.pros || '', r.cons || '', r.dayInLife || '']
  );
  return rows[0];
}

async function deleteReview(id) {
  const { rows } = await pool.query('DELETE FROM reviews WHERE id = $1 RETURNING *', [id]);
  return rows[0] || null;
}

async function getRecentReviews(limit) {
  const { rows } = await pool.query(
    `SELECT r.*, c.name AS company_name, c.tier AS company_tier
     FROM reviews r JOIN companies c ON c.id = r.company_id
     ORDER BY r.created_at DESC LIMIT $1`, [limit]
  );
  return rows;
}

// ---------- reports ----------

async function createReport({ reviewId, companyId, companyName, reason, details }) {
  const id = genId('ticket');
  const { rows } = await pool.query(
    `INSERT INTO reports (id, review_id, company_id, company_name, reason, details, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'open', now()) RETURNING *`,
    [id, reviewId, companyId ?? null, companyName ?? null, reason, details || '']
  );
  return rows[0];
}

// ---------- leaderboard ----------

async function getLeaderboard(tier) {
  const companies = await getCompanies(tier ? { tier } : {});
  const ranked = [];
  for (const c of companies) {
    const stats = await companyStats(c.id);
    if (stats.reviewCount > 0) ranked.push({ ...c, stats });
  }
  ranked.sort((a, b) => b.stats.avgRating - a.stats.avgRating);
  return ranked;
}

// ---------- contact ----------

async function createContactSubmission({ companyName, contactName, email, message }) {
  const id = genId('contact');
  const { rows } = await pool.query(
    `INSERT INTO contact_submissions (id, company_name, contact_name, email, message, created_at)
     VALUES ($1,$2,$3,$4,$5, now()) RETURNING *`,
    [id, companyName, contactName || '', email, message || '']
  );
  return rows[0];
}

module.exports = {
  pool,
  getCompanies, getCompanyById, createCompany, updateCompany, findOrCreateCompany,
  companyStats, getReviewsForCompany, getReviewById, createReview, deleteReview,
  getRecentReviews, createReport, getLeaderboard, createContactSubmission
};