const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

const COMPANIES_FILE = path.join(__dirname, 'data', 'companies.json');
const REVIEWS_FILE = path.join(__dirname, 'data', 'reviews.json');
const CONTACT_FILE = path.join(__dirname, 'data', 'contact-submissions.json');
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');

const WORD_LIMIT = 250;

// CHANGE THIS before you launch — lets you manually delete a review via curl
// (there is no admin login UI anymore; moderation happens by email review).
// Anyone with this key can delete any review, so keep it private.
// Set as an environment variable — never hardcode this, since anything hardcoded
// here would be exposed if this repo is ever pushed to a public GitHub repo.
// export ADMIN_KEY="your-real-private-key" before npm start (see EMAIL setup notes below).
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-before-launch';
if (ADMIN_KEY === 'change-me-before-launch') {
  console.warn('WARNING: ADMIN_KEY is still the placeholder value. Set a real ADMIN_KEY environment variable before launch.');
}

// Business email that gets notified for every new review AND every report.
// Requires a Gmail address + App Password set as environment variables
// before real emails will send — see the setup notes at the bottom of this file.
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
  console.warn('EMAIL_PASS not set — review/report emails will be logged to the console instead of sent. See setup notes in server.js.');
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
// baseline: applies to every /api/* endpoint, generous enough for normal browsing
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please slow down and try again in a few minutes.' }
});
app.use('/api/', generalLimiter);

// tighter: for actions that create content, to block spam/abuse specifically
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this device. Please wait a while before submitting again.' }
});

// tightest: admin-key-protected actions, to slow down anyone guessing ADMIN_KEY
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a while and try again.' }
});

function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8').trim();
  return raw ? JSON.parse(raw) : [];
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function wordCount(str) {
  return (str || '').trim().split(/\s+/).filter(Boolean).length;
}

function companyStats(companyId) {
  const reviews = readJSON(REVIEWS_FILE).filter(r => r.companyId === companyId);
  const count = reviews.length;
  const avgRating = count ? (reviews.reduce((s, r) => s + Number(r.rating), 0) / count) : null;
  const difficultyReviews = reviews.filter(r => r.difficultyToGet !== null && r.difficultyToGet !== undefined);
  const avgDifficulty = difficultyReviews.length
    ? (difficultyReviews.reduce((s, r) => s + Number(r.difficultyToGet), 0) / difficultyReviews.length)
    : null;

  const roleCounts = {};
  reviews.forEach(r => {
    const key = (r.role || 'Unknown').trim();
    roleCounts[key] = (roleCounts[key] || 0) + 1;
  });
  let mostCommonRole = null, max = 0;
  Object.entries(roleCounts).forEach(([role, c]) => { if (c > max) { max = c; mostCommonRole = role; } });

  return {
    reviewCount: count,
    avgRating: avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
    avgDifficulty: avgDifficulty !== null ? Math.round(avgDifficulty * 10) / 10 : null,
    mostCommonRole
  };
}

function findOrCreateCompany(name) {
  const companies = readJSON(COMPANIES_FILE);
  const trimmed = (name || '').trim();
  if (!trimmed) return null;

  const existing = companies.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;

  const newCompany = {
    id: genId('c'),
    name: trimmed,
    tier: null,
    industry: 'Unverified',
    verified: false
  };
  companies.push(newCompany);
  writeJSON(COMPANIES_FILE, companies);
  return newCompany;
}

// ---------- companies ----------

app.get('/api/companies', (req, res) => {
  const { search, tier, role } = req.query;
  let companies = readJSON(COMPANIES_FILE);
  const reviews = readJSON(REVIEWS_FILE);

  if (search) {
    const s = search.toLowerCase();
    companies = companies.filter(c => c.name.toLowerCase().includes(s));
  }
  if (tier) {
    companies = companies.filter(c => String(c.tier) === String(tier));
  }
  if (role) {
    const r = role.toLowerCase();
    const companyIdsWithRole = new Set(
      reviews.filter(rv => (rv.role || '').toLowerCase().includes(r)).map(rv => rv.companyId)
    );
    companies = companies.filter(c => companyIdsWithRole.has(c.id));
  }

  res.json(companies.map(c => ({ ...c, stats: companyStats(c.id) })));
});

app.get('/api/companies/:id', (req, res) => {
  const companies = readJSON(COMPANIES_FILE);
  const company = companies.find(c => c.id === req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json({ ...company, stats: companyStats(company.id) });
});

app.post('/api/companies', writeLimiter, (req, res) => {
  const { name, tier, industry, verified } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (tier !== undefined && tier !== null && ![1, 2, 3].includes(Number(tier))) {
    return res.status(400).json({ error: 'tier must be 1, 2, 3, or null' });
  }

  const companies = readJSON(COMPANIES_FILE);
  const newCompany = {
    id: genId('c'),
    name,
    tier: tier === undefined || tier === null ? null : Number(tier),
    industry: industry || 'Other',
    verified: verified === undefined ? true : Boolean(verified)
  };
  companies.push(newCompany);
  writeJSON(COMPANIES_FILE, companies);
  res.status(201).json(newCompany);
});

app.patch('/api/companies/:id', adminLimiter, (req, res) => {
  const { tier, verified, industry } = req.body;
  const companies = readJSON(COMPANIES_FILE);
  const idx = companies.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Company not found' });

  if (tier !== undefined) {
    if (tier !== null && ![1, 2, 3].includes(Number(tier))) {
      return res.status(400).json({ error: 'tier must be 1, 2, 3, or null' });
    }
    companies[idx].tier = tier === null ? null : Number(tier);
  }
  if (verified !== undefined) companies[idx].verified = Boolean(verified);
  if (industry !== undefined) companies[idx].industry = industry;

  writeJSON(COMPANIES_FILE, companies);
  res.json(companies[idx]);
});

// ---------- reviews ----------

app.get('/api/companies/:id/reviews', (req, res) => {
  const { role } = req.query;
  let reviews = readJSON(REVIEWS_FILE).filter(r => r.companyId === req.params.id);
  if (role) {
    const r = role.toLowerCase();
    reviews = reviews.filter(rv => (rv.role || '').toLowerCase().includes(r));
  }
  reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(reviews);
});

app.post('/api/reviews', writeLimiter, async (req, res) => {
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

  const prosWords = wordCount(pros);
  const consWords = wordCount(cons);
  const dayInLifeWords = wordCount(dayInLife);
  const overLimitFields = [];
  if (prosWords > WORD_LIMIT) overLimitFields.push(`Pros (${prosWords} words)`);
  if (consWords > WORD_LIMIT) overLimitFields.push(`Cons (${consWords} words)`);
  if (dayInLifeWords > WORD_LIMIT) overLimitFields.push(`A day in the life (${dayInLifeWords} words)`);
  if (overLimitFields.length) {
    return res.status(400).json({ error: `Please keep each section under ${WORD_LIMIT} words. Over the limit: ${overLimitFields.join(', ')}.` });
  }

  let company;
  if (companyId) {
    const companies = readJSON(COMPANIES_FILE);
    company = companies.find(c => c.id === companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
  } else {
    company = findOrCreateCompany(companyName);
    if (!company) return res.status(400).json({ error: 'companyName is required' });
  }

  const reviews = readJSON(REVIEWS_FILE);
  const newReview = {
    id: genId('r'),
    companyId: company.id,
    role,
    rating: ratingNum,
    difficultyToGet: difficultyToGet ? Number(difficultyToGet) : null,
    hourlyPay: hourlyPay ? Number(hourlyPay) : null,
    location: location || '',
    startDate: startDate || null,
    endDate: endDate || null,
    pros: pros || '',
    cons: cons || '',
    dayInLife: dayInLife || '',
    createdAt: new Date().toISOString()
  };
  reviews.push(newReview);
  writeJSON(REVIEWS_FILE, reviews);

  // fire-and-forget notification — every new review gets emailed for manual screening
  sendEmail(
    `New Internlog review — ${company.name}`,
    `A new review was just posted.\n\n` +
    `Company: ${company.name} (${company.id})\n` +
    `Role: ${role}\n` +
    `Rating: ${ratingNum}/10\n` +
    `Difficulty to get: ${difficultyToGet || 'not given'}\n` +
    `Hourly pay: ${hourlyPay || 'not disclosed'}\n` +
    `Location: ${location || 'not given'}\n` +
    `Dates: ${startDate || '?'} to ${endDate || '?'}\n\n` +
    `Pros: ${pros}\n\nCons: ${cons}\n\nDay in the life: ${dayInLife}\n\n` +
    `Review ID: ${newReview.id}\n` +
    `To remove this review: curl -X DELETE http://localhost:3000/api/reviews/${newReview.id} -H "Content-Type: application/json" -d '{"adminKey":"YOUR_ADMIN_KEY"}'`
  );

  res.status(201).json({ ...newReview, company });
});

// remove a review — curl-only, no UI. Requires the ADMIN_KEY set above.
app.delete('/api/reviews/:id', adminLimiter, (req, res) => {
  const { adminKey } = req.body || {};
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Incorrect admin key.' });
  }
  const reviews = readJSON(REVIEWS_FILE);
  const idx = reviews.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Review not found' });

  const [removed] = reviews.splice(idx, 1);
  writeJSON(REVIEWS_FILE, reviews);
  res.json({ success: true, removed });
});

// ---------- reports (moderation tickets) ----------

app.post('/api/reviews/:id/report', writeLimiter, async (req, res) => {
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'A reason is required.' });

  const reviews = readJSON(REVIEWS_FILE);
  const review = reviews.find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const companies = readJSON(COMPANIES_FILE);
  const company = companies.find(c => c.id === review.companyId);

  const reports = readJSON(REPORTS_FILE);
  const ticket = {
    id: genId('ticket'),
    reviewId: review.id,
    companyId: review.companyId,
    companyName: company ? company.name : 'Unknown',
    reason,
    details: details || '',
    status: 'open',
    createdAt: new Date().toISOString()
  };
  reports.push(ticket);
  writeJSON(REPORTS_FILE, reports);

  sendEmail(
    `[Ticket ${ticket.id}] Review reported — ${ticket.companyName}`,
    `A review was just reported.\n\n` +
    `Ticket ID: ${ticket.id}\n` +
    `Company: ${ticket.companyName} (${review.companyId})\n` +
    `Reason: ${reason}\n` +
    `Details from reporter: ${details || 'none given'}\n\n` +
    `--- Reported review content ---\n` +
    `Role: ${review.role}\n` +
    `Rating: ${review.rating}/10\n` +
    `Pros: ${review.pros}\n` +
    `Cons: ${review.cons}\n` +
    `Day in the life: ${review.dayInLife}\n\n` +
    `Review ID: ${review.id}\n` +
    `To remove this review: curl -X DELETE http://localhost:3000/api/reviews/${review.id} -H "Content-Type: application/json" -d '{"adminKey":"YOUR_ADMIN_KEY"}'`
  );

  res.status(201).json({ success: true, ticketId: ticket.id });
});

// most recent reviews across all companies, with company name/tier attached —
// powers the scrolling review rail on the homepage
app.get('/api/reviews/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 12, 40);
  const companies = readJSON(COMPANIES_FILE);
  const companyById = Object.fromEntries(companies.map(c => [c.id, c]));

  const reviews = readJSON(REVIEWS_FILE)
    .filter(r => companyById[r.companyId])
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(r => ({
      ...r,
      companyName: companyById[r.companyId].name,
      companyTier: companyById[r.companyId].tier
    }));

  res.json(reviews);
});

// ---------- leaderboard ----------

app.get('/api/leaderboard', (req, res) => {
  const { tier } = req.query;
  let companies = readJSON(COMPANIES_FILE);
  if (tier) companies = companies.filter(c => String(c.tier) === String(tier));

  const ranked = companies
    .map(c => ({ ...c, stats: companyStats(c.id) }))
    .filter(c => c.stats.reviewCount > 0)
    .sort((a, b) => b.stats.avgRating - a.stats.avgRating);

  res.json(ranked);
});

// ---------- contact us ----------

app.post('/api/contact', writeLimiter, async (req, res) => {
  const { companyName, contactName, email, message } = req.body;
  if (!companyName || !email) {
    return res.status(400).json({ error: 'companyName and email are required' });
  }
  const submissions = readJSON(CONTACT_FILE);
  submissions.push({
    id: genId('contact'),
    companyName,
    contactName: contactName || '',
    email,
    message: message || '',
    createdAt: new Date().toISOString()
  });
  writeJSON(CONTACT_FILE, submissions);

  sendEmail(
    `New Internlog contact form submission — ${companyName}`,
    `Company: ${companyName}\nFrom: ${contactName || 'not given'} <${email}>\n\nMessage:\n${message || 'none'}`
  );

  res.status(201).json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Internlog server running at http://localhost:${PORT}`);
});

/*
 ---------- EMAIL SETUP (do this before launch) ----------
 1. Use a Gmail account (internlogged@gmail.com) and turn on 2-Step Verification
    at https://myaccount.google.com/security
 2. Create an "App Password" at https://myaccount.google.com/apppasswords
    (choose "Mail" as the app) — Google gives you a 16-character code.
 3. Set THREE environment variables before running the server:
      export EMAIL_USER="internlogged@gmail.com"
      export EMAIL_PASS="the16characterapppassword"
      export ADMIN_KEY="pick-a-real-private-password-here"
      npm start
    Do this every time in the same terminal session before npm start, or
    add them to a .env-loading setup later. Until EMAIL_PASS is set, the
    server just logs what it WOULD have emailed to the console instead —
    it will never crash from a missing email setup. Until ADMIN_KEY is
    set, it falls back to a placeholder and prints a warning on startup.
*/