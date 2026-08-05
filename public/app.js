async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) { const err = await res.json().catch(() => ({ error: 'Something went wrong' })); throw new Error(err.error || 'Request failed'); }
  return res.json();
}
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str ?? ''; return div.innerHTML; }
function getQueryParam(name) { return new URLSearchParams(window.location.search).get(name); }

function wordCount(str) { return (str || '').trim().split(/\s+/).filter(Boolean).length; }

// rating 1-10 -> color class
function ratingClass(rating) {
  if (rating === null || rating === undefined) return 'rating-neutral';
  if (rating >= 7) return 'rating-green';
  if (rating >= 4) return 'rating-yellow';
  return 'rating-red';
}

const TIER_NAMES = { 3: 'Gold', 2: 'Silver', 1: 'Bronze' };

// small 8-bit style pixel trophy, one per tier. Returns an inline <svg> string.
// tier: 3 (gold), 2 (silver), 1 (bronze), or null/undefined (unranked - shows a dim "?" trophy)
function medalIcon(tier, size = 22) {
  const palettes = {
    3: { body: '#e3b23c', dark: '#a9790f', light: '#fbe6ad' },
    2: { body: '#aab4bf', dark: '#6d7a8c', light: '#e7ebef' },
    1: { body: '#c07a3f', dark: '#7a4620', light: '#e8b98a' },
    unranked: { body: '#c7cdd8', dark: '#8891a0', light: '#eef1f6' }
  };
  const p = palettes[tier] || palettes.unranked;

  const grid = [
    '0111110',
    '1111111',
    '0111110',
    '0011100',
    '0011100',
    '0001000',
    '0011100',
    '0111110',
    '0111110'
  ];
  const px = 4;
  let rects = '';
  grid.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === '1') {
        const shade = (y === 0 || x === 0) ? p.light : (y >= 7 ? p.dark : p.body);
        rects += `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${shade}"/>`;
      }
    });
  });

  const label = tier ? `Tier ${tier} · ${TIER_NAMES[tier]}` : 'Not yet ranked';
  return `<svg width="${size}" height="${size * (9 / 7)}" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="${label}"><title>${label}</title>${rects}</svg>`;
}

function verifiedBadge() {
  return `<span class="verified-badge" title="Verified company page"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10" fill="#2e8b4f"/><path d="M6 10.5L8.5 13L14 7" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Verified</span>`;
}

function pendingBadge() {
  return `<span class="pending-badge" title="Not yet verified by Internlog">Pending verification</span>`;
}

// formats two YYYY-MM-DD strings (either may be missing) into "Jun 2025 – Aug 2025"
function formatDateRange(startDate, endDate) {
  if (!startDate && !endDate) return '';
  const fmt = (d) => {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  if (startDate && endDate) return `<span>${fmt(startDate)} – ${fmt(endDate)}</span>`;
  if (startDate) return `<span>Started ${fmt(startDate)}</span>`;
  return `<span>Ended ${fmt(endDate)}</span>`;
}
// rich multi-column footer, injected into every page's <footer> tag so it
// only needs to be maintained in one place
document.addEventListener('DOMContentLoaded', () => {
  const footer = document.querySelector('footer');
  if (!footer) return;

  footer.classList.add('site-footer');
  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <div class="footer-wordmark">Intern<span class="accent">Log</span></div>
        <p>Honest, anonymous internship reviews by students, for students.</p>
      </div>
      <div class="footer-links">
        <a href="index.html">Browse</a>
        <a href="submit.html">Write a review</a>
        <a href="leaderboard.html">Leaderboards</a>
        <a href="contact.html">Contact us</a>
        <a href="terms.html">Terms</a>
        <a href="privacy.html">Privacy</a>
      </div>
      <div class="footer-meta">© 2026 Internlog</div>
    </div>
  `;
});