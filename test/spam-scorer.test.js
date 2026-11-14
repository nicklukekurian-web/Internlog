'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { scoreReview } = require('../spamScorer');

const existing = [
  { id: 'r_a', pros: 'Software, training, people', cons: 'None', dayInLife: 'Working on building your own business or agency' },
  { id: 'r_b', pros: 'Good mentorship and real project ownership from week one', cons: 'Pay was on the lower end for the Dallas area', dayInLife: 'Standups in the morning, then heads-down dev work, code review in the afternoon' }
];

describe('fraud scorer: reviews that should be flagged', () => {
  test('a thin all-"good" review with an extreme rating is high risk', () => {
    const r = scoreReview({ id: 'n', rating: 10, pros: 'good', cons: 'none', dayInLife: 'good' }, existing);
    assert.equal(r.level, 'high');
    assert.ok(r.spamScore >= 60);
    assert.ok(r.reasons.some((x) => /Extremely short/.test(x)));
    assert.ok(r.reasons.some((x) => /Extreme rating/.test(x)));
  });

  test('identical pros/cons/day-in-life text is flagged', () => {
    const r = scoreReview({ id: 'n', rating: 9, pros: 'Very good', cons: 'Very good', dayInLife: 'Very good' }, existing);
    assert.notEqual(r.level, 'low');
    assert.ok(r.reasons.some((x) => /identical/.test(x)));
  });

  test('a lightly edited copy of an existing review is flagged as a near-duplicate', () => {
    const r = scoreReview({
      id: 'n', rating: 8,
      pros: 'Software, training, people', cons: 'None',
      dayInLife: 'Working on building your own business or your own agency'
    }, existing);
    assert.notEqual(r.level, 'low');
    assert.ok(r.reasons.some((x) => /existing review r_a/.test(x)));
  });

  test('promotional links are flagged, abused TLDs more so', () => {
    const r = scoreReview({
      id: 'n', rating: 10,
      pros: 'Great place, also check out www.totally-legit-deals.xyz for free stuff',
      cons: 'none', dayInLife: 'visit www.totally-legit-deals.xyz'
    }, existing);
    assert.notEqual(r.level, 'low');
    assert.ok(r.reasons.some((x) => /URL/.test(x)));
    assert.ok(r.reasons.some((x) => /TLD/.test(x)));
  });
});

describe('fraud scorer: reviews that should NOT be flagged', () => {
  test('a detailed, realistic review scores zero', () => {
    const r = scoreReview({
      id: 'n', rating: 8,
      pros: 'Learned a ton about networking and got hands-on with real client tickets, team was patient with questions',
      cons: 'Commute was rough and the office was pretty quiet/isolated some days',
      dayInLife: 'Morning ticket triage, shadowing senior techs, occasional on-site visits with the team lead'
    }, existing);
    assert.equal(r.spamScore, 0);
    assert.equal(r.level, 'low');
    assert.deepEqual(r.reasons, []);
  });

  test('a short but specific review stays low', () => {
    const r = scoreReview({
      id: 'n', rating: 7,
      pros: 'Manager actually cared about my growth and gave real feedback every week',
      cons: 'Unpaid, and the office was far from campus',
      dayInLife: 'Mostly research and writing reports, some client calls toward the end'
    }, existing);
    assert.equal(r.level, 'low');
  });

  test('"na" inside ordinary words is not treated as the generic phrase "na"', () => {
    // regression: substring matching once turned "own agency" into a false "n a" hit
    const r = scoreReview({
      id: 'n', rating: 6,
      pros: 'Worked on my own agency style campaigns with real budgets and weekly reviews',
      cons: 'Long hours near deadlines and limited mentorship in the first month',
      dayInLife: 'Planning in the morning, content production after lunch, analytics review before leaving'
    }, existing);
    assert.ok(!r.reasons.some((x) => /Generic/.test(x)));
  });

  test('a review is never compared against itself', () => {
    const same = { id: 'r_a', pros: existing[0].pros, cons: existing[0].cons, dayInLife: existing[0].dayInLife };
    const r = scoreReview(same, existing);
    assert.ok(!r.reasons.some((x) => /existing review r_a/.test(x)));
  });
});

describe('fraud scorer: contract', () => {
  test('returns a bounded score, a level and reasons, and nothing that rejects', () => {
    const r = scoreReview({ id: 'n', rating: 10, pros: '', cons: '', dayInLife: '' }, existing);
    assert.deepEqual(Object.keys(r).sort(), ['level', 'reasons', 'spamScore']);
    assert.ok(r.spamScore >= 0 && r.spamScore <= 100);
    assert.ok(['low', 'medium', 'high'].includes(r.level));
  });

  test('level boundaries: 30 is medium, 60 is high', () => {
    // very short (15) + one generic phrase (15) = 30 -> medium
    const medium = scoreReview({ id: 'n', rating: 5, pros: 'Very good', cons: 'ok then', dayInLife: 'a day' }, []);
    assert.equal(medium.spamScore, 30);
    assert.equal(medium.level, 'medium');
  });
});
