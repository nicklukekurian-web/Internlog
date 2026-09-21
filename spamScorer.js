/**
 * Internlog Stage 1 spam/quality scorer.
 *
 * Transparent, rule-based (NOT a trained ML model). Computes a 0-100
 * spam_score plus a list of human-readable reasons for a submitted review.
 * Never auto-rejects — this is meant to prioritize/annotate the existing
 * moderation email, nothing more.
 *
 * Dependency-free: no npm packages, so it drops straight into an existing
 * Express + pg project with zero new installs.
 */

'use strict';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const n = normalize(text);
  return n.length ? n.split(' ') : [];
}

// Word-level shingles (n-grams) used for near-duplicate detection.
function shingles(text, n = 3) {
  const tokens = tokenize(text);
  if (tokens.length < n) return new Set(tokens.length ? [tokens.join(' ')] : []);
  const set = new Set();
  for (let i = 0; i <= tokens.length - n; i++) {
    set.add(tokens.slice(i, i + n).join(' '));
  }
  return set;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Combine a review's free-text fields into one blob for text-level checks.
function reviewText(review) {
  return [review.pros, review.cons, review.dayInLife]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Feature 1: length / vocabulary diversity
// ---------------------------------------------------------------------------
// Very short reviews, and reviews that repeat the same few words over and
// over, tend to be low-effort or fake. We score two things:
//   - raw length (too short is suspicious)
//   - type-token ratio (unique words / total words) on the reasonably-sized
//     part of the text (too repetitive is suspicious)

function scoreLengthAndDiversity(review) {
  const text = reviewText(review);
  const tokens = tokenize(text);
  const charLen = text.trim().length;

  let points = 0;
  const reasons = [];

  if (charLen < 20) {
    points += 30;
    reasons.push('Extremely short review text (<20 chars)');
  } else if (charLen < 60) {
    points += 15;
    reasons.push('Very short review text (<60 chars)');
  } else if (charLen < 120) {
    points += 5;
  }

  if (tokens.length >= 6) {
    const unique = new Set(tokens);
    const ttr = unique.size / tokens.length;
    if (ttr < 0.4) {
      points += 15;
      reasons.push(`Low vocabulary diversity (${(ttr * 100).toFixed(0)}% unique words)`);
    }
  }

  // Same field repeated verbatim across pros/cons/dayInLife (e.g. "Very good"
  // / "Cery Good" / "Very good" style low-effort submissions).
  const fields = [review.pros, review.cons, review.dayInLife]
    .filter(Boolean)
    .map((f) => normalize(f));
  const nonEmptyFields = fields.filter((f) => f.length > 0);
  if (nonEmptyFields.length >= 2) {
    const uniqueFields = new Set(nonEmptyFields);
    if (uniqueFields.size === 1) {
      points += 20;
      reasons.push('Pros/cons/day-in-life fields are identical or near-identical');
    }
  }

  return { points, reasons };
}

// ---------------------------------------------------------------------------
// Feature 2: rating extremity
// ---------------------------------------------------------------------------
// A single extreme rating isn't suspicious by itself, but an extreme rating
// (1 or 10) combined with thin/generic text is a classic low-effort or
// fake-review pattern (bombing a company, or a friend farming a "good"
// review). We only add points here in combination with thin text, scored
// in the combine step below — this function just reports the raw signal.

function scoreRatingExtremity(review) {
  const rating = Number(review.rating);
  const isExtreme = rating === 1 || rating === 10 || rating === 0;
  return { isExtreme, rating };
}

// ---------------------------------------------------------------------------
// Feature 3: generic / templated language
// ---------------------------------------------------------------------------

const GENERIC_PHRASES = [
  'very good', 'really good', 'pretty good', 'so good', 'good experience',
  'great experience', 'good company', 'great company', 'nice people',
  'learned a lot', 'chill', 'easy job', 'not bad', 'it was fine',
  'good job', 'na', 'none', 'nothing', 'no comment',
];

// Word-boundary-aware match so short phrases like "na" or "chill" don't
// false-positive on substrings inside unrelated words (e.g. "own agency").
function phraseBoundaryMatch(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\s)${escaped}($|\\s)`);
  return re.test(text);
}

function scoreGenericLanguage(review) {
  const text = normalize(reviewText(review));
  if (!text) return { points: 0, reasons: [] };

  const tokens = tokenize(text);
  const hits = GENERIC_PHRASES.filter((phrase) => phraseBoundaryMatch(text, phrase));
  const genericHits = hits.length;

  let points = 0;
  const reasons = [];

  if (genericHits === 0) return { points, reasons };

  // Share of the review made of generic phrases is the real signal: one
  // generic phrase in a short review is a bigger tell than one in a long,
  // otherwise-detailed review.
  const shortReview = tokens.length > 0 && tokens.length <= 15;
  const mediumReview = tokens.length > 15 && tokens.length <= 30;

  if (shortReview) {
    points += 15 * Math.min(genericHits, 2);
    reasons.push(`Generic/templated phrasing ("${hits[0]}")`);
  } else if (mediumReview && genericHits >= 2) {
    points += 15;
    reasons.push(`Multiple generic/templated phrases ("${hits.join('", "')}")`);
  } else if (genericHits >= 3) {
    points += 10;
    reasons.push('Multiple generic/templated phrases');
  }

  return { points, reasons };
}

// ---------------------------------------------------------------------------
// Feature 4: near-duplicate detection
// ---------------------------------------------------------------------------
// Compares the new review's text against a set of existing reviews (ideally
// scoped to the same company, but works against any provided list) using
// Jaccard similarity over word 3-grams. Cheap, dependency-free stand-in for
// TF-IDF cosine similarity, good enough for catching copy-pasted or
// lightly-edited duplicate submissions.

function scoreDuplicate(review, existingReviews) {
  const text = reviewText(review);
  const newShingles = shingles(text, 3);
  if (newShingles.size === 0 || !existingReviews || existingReviews.length === 0) {
    return { points: 0, reasons: [], maxSimilarity: 0 };
  }

  let maxSimilarity = 0;
  let matchedId = null;
  for (const existing of existingReviews) {
    if (existing.id && review.id && existing.id === review.id) continue;
    const existingText = reviewText(existing);
    if (!existingText) continue;
    const sim = jaccardSimilarity(newShingles, shingles(existingText, 3));
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      matchedId = existing.id;
    }
  }

  let points = 0;
  const reasons = [];
  if (maxSimilarity >= 0.8) {
    points += 40;
    reasons.push(`Near-duplicate of existing review ${matchedId || ''} (${(maxSimilarity * 100).toFixed(0)}% similar)`.trim());
  } else if (maxSimilarity >= 0.5) {
    points += 20;
    reasons.push(`Overlaps significantly with existing review ${matchedId || ''} (${(maxSimilarity * 100).toFixed(0)}% similar)`.trim());
  } else if (maxSimilarity >= 0.3) {
    points += 8;
    reasons.push(`Some overlap with an existing review (${(maxSimilarity * 100).toFixed(0)}% similar)`);
  }

  return { points, reasons, maxSimilarity };
}

// ---------------------------------------------------------------------------
// Feature 5: promotional / spam links
// ---------------------------------------------------------------------------

const URL_RE = /(https?:\/\/|www\.)[^\s]+/gi;
const SUSPICIOUS_TLD_RE = /\.(xyz|top|click|loan|work|men|gq|tk|ml|cf|ga)(\/|\s|$)/i;

function scoreLinks(review) {
  const text = reviewText(review);
  const matches = text.match(URL_RE) || [];

  let points = 0;
  const reasons = [];

  if (matches.length > 0) {
    points += 25;
    reasons.push(`Contains ${matches.length} URL${matches.length > 1 ? 's' : ''} in review text`);
    if (matches.some((m) => SUSPICIOUS_TLD_RE.test(m))) {
      points += 20;
      reasons.push('Link uses a commonly-abused TLD');
    }
  }

  return { points, reasons };
}

// ---------------------------------------------------------------------------
// Combine
// ---------------------------------------------------------------------------

function scoreReview(review, existingReviews = []) {
  const lengthResult = scoreLengthAndDiversity(review);
  const genericResult = scoreGenericLanguage(review);
  const dupResult = scoreDuplicate(review, existingReviews);
  const linkResult = scoreLinks(review);
  const { isExtreme, rating } = scoreRatingExtremity(review);

  let points = lengthResult.points + genericResult.points + dupResult.points + linkResult.points;
  const reasons = [
    ...lengthResult.reasons,
    ...genericResult.reasons,
    ...dupResult.reasons,
    ...linkResult.reasons,
  ];

  // Extreme rating + thin text combo (classic fake-review shape).
  const text = reviewText(review);
  if (isExtreme && text.trim().length < 100) {
    points += 15;
    reasons.push(`Extreme rating (${rating}/10) paired with thin review text`);
  }

  const spamScore = Math.max(0, Math.min(100, Math.round(points)));

  let level;
  if (spamScore >= 60) level = 'high';
  else if (spamScore >= 30) level = 'medium';
  else level = 'low';

  return { spamScore, level, reasons };
}

module.exports = {
  scoreReview,
  // exported for testing / reuse
  normalize,
  tokenize,
  shingles,
  jaccardSimilarity,
  reviewText,
};