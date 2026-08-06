require('dotenv').config();
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const WORD_LIMIT = 250;

// CHANGE THIS before you launch — lets you manually delete a review via curl
// (there is no admin login UI anymore; moderation happens by email review).
// Anyone with this key can delete any review, so keep it private.
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-before-launch';
if (ADMIN_KEY === 'change-me-before-launch') {
  console.warn('WARNING: ADMIN_KEY is still the placeholder value. Set a real ADMIN_KEY environment variable before launch.');
}

// Business email that gets notified for every new review AND every report.
const BUSINESS_EMAIL = 'internlogged@gmail.com';
const EMAIL_USER = process.env.EMAIL_USER || BUSINESS_EMAIL;
const EMAIL_PASS = process.env.EMAIL_PASS || '';

let transporter = null;
if (EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
} else {
  console.warn('EMAIL_PASS not set — review/report emails will be logged to the console instead of sent.');
}

async function sendEmail(subject, text) {
  if (!transporter) {
    console.log(`[EMAIL NOT CONFIGURED] Would have sent: "${subject}"\n${text}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: EMAIL_USER, to: BUSINESS_EMAIL, subject, text });
  } catch (err) {
    console.error('Failed to send email:', err.message);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- rate limiting ----------
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please slow down and try again in a few minutes.' }
});
app.use('/api/', generalLimiter);

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this device. Please wait a while before submitting again.' }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a while and try again.' }
});

function wordCount(str) {
  return (str || '').trim().split(/\s+/).filter(Boolean).length;
}

// ---------- shape mappers: DB (snake_case) -> API (camelCase) ----------
// keeps the existing frontend completely unchanged

function toApiCompany(row, stats) {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    industry: row.industry,
    verified: row.verified,
    ...(stats ? { stats } : {})
  };
}

function toApiReview(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    role: row.role,
    rating: row.rating,
    difficultyToGet: row.difficulty_to_get,
    hourlyPay: row.hourly_pay !== null ? Number(row.hourly_pay) : null,
    location: row.location || '',
    startDate: row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : null,
    endDate: row.end_date ? new Date(row.end_date).toISOString().slice(0, 10) : null,
    pros: row.pros || '',
    cons: row.cons || '',
    dayInLife: row.day_in_life || '',
    createdAt: row.created_at
  };
}

// wraps every async route so a thrown error becomes a clean 500 instead of crashing the server
function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  });
}

// ---------- companies ----------

app.get('/api/companies', asyncRoute(async (req, res) => {
  const { search, tier, role } = req.query;
  const companies = await db.getCompanies({ search, tier, role });
  const withStats = await Promise.all(companies.map(async c => toApiCompany(c, await db.companyStats(c.id))));
  res.json(withStats);
}));

app.get('/api/companies/:id', asyncRoute(async (req, res) => {
  const company = await db.getCompanyById(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const stats = await db.companyStats(company.id);
  res.json(toApiCompany(company, stats));
}));

app.post('/api/companies', writeLimiter, asyncRoute(async (req, res) => {
  const { name, tier, industry, verified } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (tier !== undefined && tier !== null && ![1, 2, 3].includes(Number(tier))) {
    return res.status(400).json({ error: 'tier must be 1, 2, 3, or null' });
  }
  const company = await db.createCompany({ name, tier, industry, verified });
  res.status(201).json(toApiCompany(company));
}));

app.patch('/api/companies/:id', adminLimiter, asyncRoute(async (req, res) => {
  const { tier, verified, industry } = req.body;
  if (tier !== undefined && tier !== null && ![1, 2, 3].includes(Number(tier))) {
    return res.status(400).json({ error: 'tier must be 1, 2, 3, or null' });
  }
  const updated = await db.updateCompany(req.params.id, { tier, verified, industry });
  if (!updated) return res.status(404).json({ error: 'Company not found' });
  res.json(toApiCompany(updated));
}));

// ---------- reviews ----------

app.get('/api/companies/:id/reviews', asyncRoute(async (req, res) => {
  const reviews = await db.getReviewsForCompany(req.params.id, req.query.role);
  res.json(reviews.map(toApiReview));
}));

app.post('/api/reviews', writeLimiter, asyncRoute(async (req, res) => {
  const { companyId, companyName, role, rating, difficultyToGet, hourlyPay, location, startDate, endDate, pros, cons, dayInLife, agreedToPolicy } = req.body;

  if ((!companyId && !companyName) || !role || rating === undefined) {
    return res.status(400).json({ error: 'a company, role, and rating are required' });
  }
  if (!agreedToPolicy) {
    return res.status(400).json({ error: 'You must confirm the review policy checkbox before submitting.' });
  }

  const ratingNum = Number(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 10) {
    return res.status(400).json({ error: 'rating must be a number 1-10' });
  }
  if (difficultyToGet !== undefined && difficultyToGet !== '' && (isNaN(Number(difficultyToGet)) || Number(difficultyToGet) < 1 || Number(difficultyToGet) > 10)) {
    return res.status(400).json({ error: 'difficultyToGet must be a number 1-10' });
  }

  const overLimitFields = [];
  const prosWords = wordCount(pros), consWords = wordCount(cons), dayWords = wordCount(dayInLife);
  if (prosWords > WORD_LIMIT) overLimitFields.push(`Pros (${prosWords} words)`);
  if (consWords > WORD_LIMIT) overLimitFields.push(`Cons (${consWords} words)`);
  if (dayWords > WORD_LIMIT) overLimitFields.push(`A day in the life (${dayWords} words)`);
  if (overLimitFields.length) {
    return res.status(400).json({ error: `Please keep each section under ${WORD_LIMIT} words. Over the limit: ${overLimitFields.join(', ')}.` });
  }

  let company;
  if (companyId) {
    company = await db.getCompanyById(companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
  } else {
    company = await db.findOrCreateCompany(companyName);
    if (!company) return res.status(400).json({ error: 'companyName is required' });
  }

  const newReview = await db.createReview({
    companyId: company.id, role, rating: ratingNum,
    difficultyToGet: difficultyToGet ? Number(difficultyToGet) : null,
    hourlyPay: hourlyPay ? Number(hourlyPay) : null,
    location, startDate: startDate || null, endDate: endDate || null,
    pros, cons, dayInLife
  });

  sendEmail(
    `New Internlog review — ${company.name}`,
    `A new review was just posted.\n\n` +
    `Company: ${company.name} (${company.id})\n` +
    `Role: ${role}\nRating: ${ratingNum}/10\n` +
    `Difficulty to get: ${difficultyToGet || 'not given'}\n` +
    `Hourly pay: ${hourlyPay || 'not disclosed'}\n` +
    `Location: ${location || 'not given'}\n` +
    `Dates: ${startDate || '?'} to ${endDate || '?'}\n\n` +
    `Pros: ${pros}\n\nCons: ${cons}\n\nDay in the life: ${dayInLife}\n\n` +
    `Review ID: ${newReview.id}\n` +
    `To remove this review: curl -X DELETE http://localhost:3000/api/reviews/${newReview.id} -H "Content-Type: application/json" -d '{"adminKey":"YOUR_ADMIN_KEY"}'`
  );

  res.status(201).json({ ...toApiReview(newReview), company: toApiCompany(company) });
}));

app.delete('/api/reviews/:id', adminLimiter, asyncRoute(async (req, res) => {
  const { adminKey } = req.body || {};
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Incorrect admin key.' });
  }
  const removed = await db.deleteReview(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Review not found' });
  res.json({ success: true, removed: toApiReview(removed) });
}));

// ---------- reports ----------

app.post('/api/reviews/:id/report', writeLimiter, asyncRoute(async (req, res) => {
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'A reason is required.' });

  const review = await db.getReviewById(req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const company = await db.getCompanyById(review.company_id);

  const ticket = await db.createReport({
    reviewId: review.id, companyId: review.company_id,
    companyName: company ? company.name : 'Unknown', reason, details
  });

  sendEmail(
    `[Ticket ${ticket.id}] Review reported — ${ticket.company_name}`,
    `A review was just reported.\n\n` +
    `Ticket ID: ${ticket.id}\nCompany: ${ticket.company_name} (${review.company_id})\n` +
    `Reason: ${reason}\nDetails from reporter: ${details || 'none given'}\n\n` +
    `--- Reported review content ---\n` +
    `Role: ${review.role}\nRating: ${review.rating}/10\n` +
    `Pros: ${review.pros}\nCons: ${review.cons}\nDay in the life: ${review.day_in_life}\n\n` +
    `Review ID: ${review.id}\n` +
    `To remove this review: curl -X DELETE http://localhost:3000/api/reviews/${review.id} -H "Content-Type: application/json" -d '{"adminKey":"YOUR_ADMIN_KEY"}'`
  );

  res.status(201).json({ success: true, ticketId: ticket.id });
}));

app.get('/api/reviews/recent', asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 12, 40);
  const rows = await db.getRecentReviews(limit);
  res.json(rows.map(r => ({ ...toApiReview(r), companyName: r.company_name, companyTier: r.company_tier })));
}));

// ---------- leaderboard ----------

app.get('/api/leaderboard', asyncRoute(async (req, res) => {
  const ranked = await db.getLeaderboard(req.query.tier);
  res.json(ranked.map(r => toApiCompany(r, r.stats)));
}));

// ---------- contact us ----------

app.post('/api/contact', writeLimiter, asyncRoute(async (req, res) => {
  const { companyName, contactName, email, message } = req.body;
  if (!companyName || !email) {
    return res.status(400).json({ error: 'companyName and email are required' });
  }
  await db.createContactSubmission({ companyName, contactName, email, message });
  sendEmail(
    `New Internlog contact form submission — ${companyName}`,
    `Company: ${companyName}\nFrom: ${contactName || 'not given'} <${email}>\n\nMessage:\n${message || 'none'}`
  );
  res.status(201).json({ success: true });
}));

app.listen(PORT, () => {
  console.log(`Internlog server running at http://localhost:${PORT}`);
});