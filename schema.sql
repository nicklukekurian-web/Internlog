-- InternLog database schema
-- Run this once in Supabase: Dashboard -> SQL Editor -> paste -> Run.

CREATE TABLE IF NOT EXISTS companies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  tier       INTEGER,
  industry   TEXT,
  verified   BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  rating            INTEGER NOT NULL,
  difficulty_to_get INTEGER,
  hourly_pay        NUMERIC,
  location          TEXT DEFAULT '',
  start_date        DATE,
  end_date          DATE,
  pros              TEXT DEFAULT '',
  cons              TEXT DEFAULT '',
  day_in_life       TEXT DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  review_id    TEXT NOT NULL,
  company_id   TEXT,
  company_name TEXT,
  reason       TEXT NOT NULL,
  details      TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id           TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  email        TEXT NOT NULL,
  message      TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_company_id ON reviews(company_id);
CREATE INDEX IF NOT EXISTS idx_reports_review_id  ON reports(review_id);

-- Fraud/quality scoring (written by the server on each new review; flag-only, never auto-rejects)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS spam_score   INTEGER;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS spam_level   TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS spam_reasons TEXT;

-- Row Level Security: enabled with no policies, so the public anon/authenticated API roles
-- can read and write nothing. The Express server connects as a privileged role and bypasses RLS.
ALTER TABLE companies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
