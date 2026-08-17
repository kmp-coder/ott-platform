/* RangManch OTT — shared front-end helpers */
const API = {
  async call(url, opts = {}) {
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const tokenKey = opts.tokenKey || 'sub_token';
    const t = localStorage.getItem(tokenKey);
    if (t) opts.headers['x-token'] = t;
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
    if (opts.body instanceof FormData) delete opts.headers['Content-Type'];
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'Something went wrong. Please try again.'); err.code = data.code; err.status = res.status; throw err; }
    return data;
  }
};

function toast(msg, kind) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = kind || '';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4200);
}

/* Request an OTP and show the demo code next to the button */
async function requestOtp(channel, destination, hintEl) {
  try {
    const r = await API.call('/api/otp/request', { method: 'POST', body: { channel, destination } });
    if (hintEl) hintEl.textContent = r.demoOtp ? 'DEMO OTP: ' + r.demoOtp + ' (in the real system this arrives by ' + (channel === 'aadhaar' ? 'the Aadhaar-linked mobile' : channel) + ')' : 'OTP sent!';
    toast('OTP generated', 'ok');
    return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}

const TYPE_EMOJI = { song: '🎵', short: '🎬', movie: '🍿', series: '📺' };

/* Cinematic gradient "poster art" — hue derived from the title so every card
   gets its own stable, muted film-poster colour. */
function titleHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function posterBg(c) {
  if (c.thumbnail) return "background-image:url('" + c.thumbnail + "')";
  const h = titleHue(c.title || '');
  return 'background:' +
    'radial-gradient(ellipse 90% 70% at 78% 18%, hsla(' + ((h + 45) % 360) + ',55%,42%,.5), transparent 62%),' +
    'radial-gradient(ellipse 80% 90% at 12% 88%, hsla(' + h + ',60%,30%,.55), transparent 66%),' +
    'linear-gradient(155deg, hsl(' + h + ',34%,20%) 0%, hsl(' + ((h + 25) % 360) + ',40%,11%) 55%, #0b0c10 100%)';
}

function posterCard(c, onClick) {
  const div = document.createElement('div');
  div.className = 'poster';
  div.innerHTML =
    '<div class="thumb" style="' + posterBg(c) + '">' +
      '<span class="p-rating">' + (c.ageRating || 'U') + '</span>' +
      '<div class="p-lang"></div><div class="p-title"></div>' +
    '</div>' +
    '<div class="p-meta"><span class="by"></span><span class="views">' + (c.views || 0) + ' views</span></div>';
  div.querySelector('.p-lang').textContent = c.language || '';
  div.querySelector('.p-title').textContent = c.title;
  div.querySelector('.by').textContent = c.creatorName || (c.typeLabel || '');
  if (onClick) div.onclick = () => onClick(c);
  return div;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function dt(s) { return s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

/* Download an authenticated file (Excel report) via token header */
async function downloadReport(url, tokenKey, filename) {
  try {
    const res = await fetch(url, { headers: { 'x-token': localStorage.getItem(tokenKey) || '' } });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Download failed.'); }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('📥 Excel report downloaded', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* demo badge */
document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/meta').then(r => r.json()).then(m => {
    if (m.demoMode) {
      const b = document.createElement('div');
      b.className = 'demo-badge';
      b.textContent = '🧪 DEMO MODE — OTPs shown on screen';
      document.body.appendChild(b);
    }
  }).catch(() => {});
});
