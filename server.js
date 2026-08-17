/*
 * RangManch OTT — demo platform server
 * Node/Express, JSON file storage, no build step.
 * DEMO MODE: OTPs are generated locally and shown on screen instead of being
 * sent by SMS/e-mail/UIDAI. Swap in licensed providers before going live.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- tiny JSON store ---------- */
function load(name, fallback) {
  const file = path.join(DATA_DIR, name + '.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(name, value) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(value, null, 2));
}

let creators = load('creators', []);
let subscribers = load('subscribers', []);
let content = load('content', []);
let views = load('views', []);          // { contentId, subscriberId, at }
let sessions = load('sessions', {});    // token -> { role, userId }
let settings = load('settings', null);
if (!settings) {
  settings = {
    platformName: 'RangManch',
    tagline: 'Unlimited entertainment, in your language',
    adminPassword: 'admin123',
    demoMode: true
  };
  save('settings', settings);
}

const otps = new Map(); // key -> { code, expires }

/* ---------- helpers ---------- */
const LANGS = ['Hindi', 'English', 'Gujarati', 'Bhojpuri', 'Marathi', 'Punjabi', 'Tamil', 'Telugu', 'Bengali', 'Kannada'];
const TYPES = { song: 'Songs & Albums', short: 'Short Movies & Videos', movie: 'Movies', series: 'Web Series' };
const PLANS = {
  monthly: { label: '1 Month', months: 1, price: 19 },
  yearly: { label: '12 Months', months: 12, price: 30 }
};

const id = () => crypto.randomBytes(8).toString('hex');
const token = () => crypto.randomBytes(24).toString('hex');
const now = () => new Date().toISOString();

function makeOtp(key) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otps.set(key, { code, expires: Date.now() + 10 * 60 * 1000 });
  return code;
}
function checkOtp(key, code) {
  const rec = otps.get(key);
  if (!rec || rec.expires < Date.now() || rec.code !== String(code)) return false;
  otps.delete(key);
  return true;
}
function auth(role) {
  return (req, res, next) => {
    const t = req.headers['x-token'] || req.query.token;
    const s = t && sessions[t];
    if (!s || (role && s.role !== role)) return res.status(401).json({ error: 'Please log in again.' });
    req.session = s;
    next();
  };
}
function addMonths(fromIso, months) {
  const d = new Date(fromIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}
function subActive(s) {
  return !!(s.subscription && new Date(s.subscription.expiresAt) > new Date());
}
function totalPaid(s) {
  return (s.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}
function ageFromDob(dob) {
  const d = new Date(dob);
  if (isNaN(d)) return null;
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
  return a;
}
function validViews(contentId) {
  return views.filter(v => v.contentId === contentId).length; // stored views are already unique + valid
}
function earningsFor(item) {
  if (item.status !== 'approved' || !item.paymentPlan) return 0;
  if (item.paymentPlan.mode === 'upfront') return Number(item.paymentPlan.amount) || 0;
  return validViews(item.id) * (Number(item.paymentPlan.rate) || 0);
}
function publicContent(item) {
  const c = creators.find(x => x.id === item.creatorId);
  return {
    id: item.id, title: item.title, description: item.description,
    type: item.type, typeLabel: TYPES[item.type] || item.type,
    language: item.language, ageRating: item.ageRating,
    seriesName: item.seriesName || '', episode: item.episode || '',
    videoUrl: item.videoUrl, thumbnail: item.thumbnail || '',
    creatorName: c ? c.name : 'Unknown', views: validViews(item.id),
    approvedAt: item.approvedAt
  };
}

/* ---------- middleware ---------- */
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

/* ---------- public ---------- */
app.get('/api/meta', (req, res) => {
  res.json({ platformName: settings.platformName, tagline: settings.tagline, demoMode: settings.demoMode, languages: LANGS, types: TYPES, plans: PLANS });
});

app.get('/api/content', (req, res) => {
  let list = content.filter(c => c.status === 'approved').map(publicContent);
  if (req.query.language) list = list.filter(c => c.language === req.query.language);
  if (req.query.type) list = list.filter(c => c.type === req.query.type);
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    list = list.filter(c => (c.title + ' ' + c.description + ' ' + c.creatorName).toLowerCase().includes(q));
  }
  list.sort((a, b) => (b.approvedAt || '').localeCompare(a.approvedAt || ''));
  res.json(list);
});

/* ---------- OTP (demo) ---------- */
app.post('/api/otp/request', (req, res) => {
  const { channel, destination } = req.body; // channel: email | mobile | aadhaar
  if (!destination) return res.status(400).json({ error: 'Destination required.' });
  if (channel === 'aadhaar' && !/^\d{12}$/.test(destination)) return res.status(400).json({ error: 'Aadhaar must be a 12-digit number.' });
  if (channel === 'mobile' && !/^\d{10}$/.test(destination)) return res.status(400).json({ error: 'Mobile must be a 10-digit number.' });
  if (channel === 'email' && !/^\S+@\S+\.\S+$/.test(destination)) return res.status(400).json({ error: 'Enter a valid e-mail address.' });
  const code = makeOtp(channel + ':' + destination);
  // DEMO MODE: return the OTP so the UI can display it. In production this is
  // sent via SMS gateway / e-mail / UIDAI and never returned in the response.
  res.json({ sent: true, demoOtp: settings.demoMode ? code : undefined });
});

/* ---------- creator ---------- */
app.post('/api/creator/signup', (req, res) => {
  const b = req.body;
  const required = ['name', 'email', 'mobile', 'emailOtp', 'aadhaar', 'aadhaarOtp', 'pan', 'accountHolder', 'accountNumber', 'ifsc', 'bankName', 'branch'];
  for (const f of required) if (!b[f]) return res.status(400).json({ error: 'Please fill every field (missing: ' + f + ').' });
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(b.pan.toUpperCase())) return res.status(400).json({ error: 'PAN format looks wrong. Example: ABCDE1234F' });
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifsc.toUpperCase())) return res.status(400).json({ error: 'IFSC format looks wrong. Example: SBIN0001234' });
  if (!/^\d{9,18}$/.test(b.accountNumber)) return res.status(400).json({ error: 'Account number should be 9–18 digits.' });
  if (creators.find(c => c.email === b.email.toLowerCase() || c.mobile === b.mobile)) return res.status(400).json({ error: 'A creator with this e-mail or mobile already exists. Please log in.' });
  if (!checkOtp('email:' + b.email.toLowerCase(), b.emailOtp) && !checkOtp('mobile:' + b.mobile, b.emailOtp))
    return res.status(400).json({ error: 'E-mail/mobile OTP is wrong or expired.' });
  if (!checkOtp('aadhaar:' + b.aadhaar, b.aadhaarOtp)) return res.status(400).json({ error: 'Aadhaar OTP is wrong or expired.' });

  const creator = {
    id: id(), name: b.name.trim(), email: b.email.toLowerCase(), mobile: b.mobile,
    aadhaarLast4: b.aadhaar.slice(-4), aadhaarVerified: true,
    pan: b.pan.toUpperCase(),
    bank: { accountHolder: b.accountHolder, accountNumber: b.accountNumber, ifsc: b.ifsc.toUpperCase(), bankName: b.bankName, branch: b.branch },
    createdAt: now()
  };
  creators.push(creator); save('creators', creators);
  const t = token(); sessions[t] = { role: 'creator', userId: creator.id }; save('sessions', sessions);
  res.json({ token: t, name: creator.name });
});

app.post('/api/creator/login', (req, res) => {
  const { identifier, otp } = req.body;
  const idf = String(identifier || '').toLowerCase();
  const creator = creators.find(c => c.email === idf || c.mobile === identifier);
  if (!creator) return res.status(400).json({ error: 'No creator account found for this e-mail/mobile. Please sign up first.' });
  const ok = checkOtp('email:' + creator.email, otp) || checkOtp('mobile:' + creator.mobile, otp);
  if (!ok) return res.status(400).json({ error: 'OTP is wrong or expired.' });
  const t = token(); sessions[t] = { role: 'creator', userId: creator.id }; save('sessions', sessions);
  res.json({ token: t, name: creator.name });
});

app.get('/api/creator/me', auth('creator'), (req, res) => {
  const c = creators.find(x => x.id === req.session.userId);
  if (!c) return res.status(404).json({ error: 'Account not found.' });
  const mine = content.filter(x => x.creatorId === c.id).map(item => ({
    id: item.id, title: item.title, type: item.type, typeLabel: TYPES[item.type],
    language: item.language, status: item.status, rejectReason: item.rejectReason || '',
    uploadedAt: item.uploadedAt, approvedAt: item.approvedAt || null,
    paymentPlan: item.paymentPlan || null,
    views: validViews(item.id), earnings: earningsFor(item),
    thumbnail: item.thumbnail || '', ageRating: item.ageRating
  }));
  const totalEarnings = mine.reduce((s, m) => s + m.earnings, 0);
  res.json({
    profile: { name: c.name, email: c.email, mobile: c.mobile, aadhaarLast4: c.aadhaarLast4, pan: c.pan, bank: c.bank },
    content: mine, totalEarnings
  });
});

app.post('/api/creator/content', auth('creator'), upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), (req, res) => {
  const b = req.body;
  if (!b.title || !b.type || !b.language) return res.status(400).json({ error: 'Title, type and language are required.' });
  if (!TYPES[b.type]) return res.status(400).json({ error: 'Unknown content type.' });
  let videoUrl = (b.videoUrl || '').trim();
  if (req.files && req.files.video && req.files.video[0]) videoUrl = '/uploads/' + req.files.video[0].filename;
  if (!videoUrl) return res.status(400).json({ error: 'Upload a video file or give a video link.' });
  let thumbnail = '';
  if (req.files && req.files.thumbnail && req.files.thumbnail[0]) thumbnail = '/uploads/' + req.files.thumbnail[0].filename;
  const item = {
    id: id(), creatorId: req.session.userId,
    title: b.title.trim(), description: (b.description || '').trim(),
    type: b.type, language: b.language, ageRating: b.ageRating || 'U',
    seriesName: (b.seriesName || '').trim(), episode: (b.episode || '').trim(),
    videoUrl, thumbnail,
    status: 'pending', uploadedAt: now()
  };
  content.push(item); save('content', content);
  res.json({ ok: true, id: item.id });
});

/* ---------- subscriber ---------- */
app.post('/api/subscriber/signup', (req, res) => {
  const b = req.body;
  const required = ['name', 'email', 'mobile', 'contactOtp', 'aadhaar', 'aadhaarOtp', 'dob', 'plan'];
  for (const f of required) if (!b[f]) return res.status(400).json({ error: 'Please fill every field (missing: ' + f + ').' });
  const plan = PLANS[b.plan];
  if (!plan) return res.status(400).json({ error: 'Please choose a subscription plan.' });
  const age = ageFromDob(b.dob);
  if (age === null) return res.status(400).json({ error: 'Date of birth looks invalid.' });
  if (age < 13) return res.status(400).json({ error: 'You must be at least 13 years old to subscribe.' });
  if (subscribers.find(s => s.email === b.email.toLowerCase() || s.mobile === b.mobile)) return res.status(400).json({ error: 'An account with this e-mail or mobile already exists. Please log in.' });
  if (!checkOtp('email:' + b.email.toLowerCase(), b.contactOtp) && !checkOtp('mobile:' + b.mobile, b.contactOtp))
    return res.status(400).json({ error: 'E-mail/mobile OTP is wrong or expired.' });
  if (!checkOtp('aadhaar:' + b.aadhaar, b.aadhaarOtp)) return res.status(400).json({ error: 'Aadhaar OTP is wrong or expired.' });
  const startedAt = now();
  const sub = {
    id: id(), name: b.name.trim(), email: b.email.toLowerCase(), mobile: b.mobile,
    dob: b.dob, age, aadhaarLast4: b.aadhaar.slice(-4), aadhaarVerified: true, createdAt: startedAt,
    subscription: { plan: b.plan, label: plan.label, price: plan.price, startedAt, expiresAt: addMonths(startedAt, plan.months) },
    payments: [{ plan: b.plan, label: plan.label, amount: plan.price, at: startedAt }]
  };
  subscribers.push(sub); save('subscribers', subscribers);
  const t = token(); sessions[t] = { role: 'subscriber', userId: sub.id }; save('sessions', sessions);
  res.json({ token: t, name: sub.name, age, subscription: sub.subscription });
});

app.post('/api/subscriber/login', (req, res) => {
  const { identifier, otp } = req.body;
  const idf = String(identifier || '').toLowerCase();
  const sub = subscribers.find(s => s.email === idf || s.mobile === identifier);
  if (!sub) return res.status(400).json({ error: 'No subscriber account found. Please sign up first.' });
  const ok = checkOtp('email:' + sub.email, otp) || checkOtp('mobile:' + sub.mobile, otp);
  if (!ok) return res.status(400).json({ error: 'OTP is wrong or expired.' });
  const t = token(); sessions[t] = { role: 'subscriber', userId: sub.id }; save('sessions', sessions);
  res.json({ token: t, name: sub.name, age: sub.age });
});

app.get('/api/subscriber/me', auth('subscriber'), (req, res) => {
  const s = subscribers.find(x => x.id === req.session.userId);
  if (!s) return res.status(404).json({ error: 'Account not found.' });
  res.json({ name: s.name, age: s.age, email: s.email, subscription: s.subscription || null, active: subActive(s) });
});

/* Renew / change plan (demo payment — no real money moves) */
app.post('/api/subscriber/renew', auth('subscriber'), (req, res) => {
  const s = subscribers.find(x => x.id === req.session.userId);
  if (!s) return res.status(404).json({ error: 'Account not found.' });
  const plan = PLANS[req.body.plan];
  if (!plan) return res.status(400).json({ error: 'Please choose a subscription plan.' });
  const from = subActive(s) ? s.subscription.expiresAt : now(); // active plans extend, expired ones restart
  s.subscription = { plan: req.body.plan, label: plan.label, price: plan.price, startedAt: now(), expiresAt: addMonths(from, plan.months) };
  s.payments = s.payments || [];
  s.payments.push({ plan: req.body.plan, label: plan.label, amount: plan.price, at: now() });
  save('subscribers', subscribers);
  res.json({ subscription: s.subscription });
});

app.get('/api/watch/:id', auth('subscriber'), (req, res) => {
  const item = content.find(c => c.id === req.params.id && c.status === 'approved');
  if (!item) return res.status(404).json({ error: 'This content is not available.' });
  const s = subscribers.find(x => x.id === req.session.userId);
  if (!subActive(s)) return res.status(402).json({ error: 'Your subscription has expired. Please renew to continue watching.', code: 'SUB_EXPIRED' });
  if (item.ageRating === 'A' && s.age < 18) return res.status(403).json({ error: 'This content is rated 18+. Your verified age does not permit it.' });
  const alreadyViewed = views.some(v => v.contentId === item.id && v.subscriberId === s.id);
  res.json({ ...publicContent(item), alreadyViewed });
});

/*
 * View counting rules (as per payment policy):
 *  - the video must be watched fully, with NO fast-forwarding (client reports this,
 *    server only accepts completed=true and fastForwarded=false)
 *  - one subscriber counts as ONE view for a piece of content, no matter how many
 *    times they re-watch it (enforced by the uniqueness check below)
 */
app.post('/api/watch/:id/complete', auth('subscriber'), (req, res) => {
  const item = content.find(c => c.id === req.params.id && c.status === 'approved');
  if (!item) return res.status(404).json({ error: 'Content not found.' });
  const { completed, fastForwarded, watchedSeconds, duration } = req.body;
  if (!completed || fastForwarded) return res.json({ counted: false, reason: 'View counts only when watched in full without fast-forwarding.' });
  if (duration && watchedSeconds < duration * 0.9) return res.json({ counted: false, reason: 'Not enough of the video was actually watched.' });
  if (views.some(v => v.contentId === item.id && v.subscriberId === req.session.userId))
    return res.json({ counted: false, reason: 'You have already been counted for this content (1 view per subscriber).' });
  views.push({ contentId: item.id, subscriberId: req.session.userId, at: now() });
  save('views', views);
  res.json({ counted: true });
});

/* ---------- admin ---------- */
app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== settings.adminPassword) return res.status(401).json({ error: 'Wrong admin password.' });
  const t = token(); sessions[t] = { role: 'admin', userId: 'admin' }; save('sessions', sessions);
  res.json({ token: t });
});

app.get('/api/admin/overview', auth('admin'), (req, res) => {
  const approved = content.filter(c => c.status === 'approved');
  const pending = content.filter(c => c.status === 'pending');
  const totalPayout = content.reduce((s, c) => s + earningsFor(c), 0);
  const subscriptionRevenue = subscribers.reduce((s, x) => s + totalPaid(x), 0);
  res.json({
    counts: {
      creators: creators.length, subscribers: subscribers.length,
      activeSubscribers: subscribers.filter(subActive).length,
      contentTotal: content.length, approved: approved.length,
      pending: pending.length, rejected: content.filter(c => c.status === 'rejected').length,
      totalViews: views.length, totalPayout, subscriptionRevenue
    }
  });
});

app.get('/api/admin/creators', auth('admin'), (req, res) => {
  res.json(creators.map(c => {
    const mine = content.filter(x => x.creatorId === c.id);
    return {
      id: c.id, name: c.name, email: c.email, mobile: c.mobile,
      aadhaarLast4: c.aadhaarLast4, aadhaarVerified: c.aadhaarVerified, pan: c.pan, bank: c.bank,
      createdAt: c.createdAt, contentCount: mine.length,
      earnings: mine.reduce((s, m) => s + earningsFor(m), 0)
    };
  }));
});

app.get('/api/admin/subscribers', auth('admin'), (req, res) => {
  res.json(subscribers.map(s => ({
    id: s.id, name: s.name, email: s.email, mobile: s.mobile, age: s.age,
    aadhaarLast4: s.aadhaarLast4, aadhaarVerified: s.aadhaarVerified, createdAt: s.createdAt,
    plan: s.subscription ? s.subscription.label : '—',
    expiresAt: s.subscription ? s.subscription.expiresAt : null,
    active: subActive(s), totalPaid: totalPaid(s),
    viewsCounted: views.filter(v => v.subscriberId === s.id).length
  })));
});

app.get('/api/admin/content', auth('admin'), (req, res) => {
  res.json(content.map(item => {
    const c = creators.find(x => x.id === item.creatorId);
    return {
      id: item.id, title: item.title, description: item.description,
      type: item.type, typeLabel: TYPES[item.type], language: item.language,
      ageRating: item.ageRating, seriesName: item.seriesName, episode: item.episode,
      videoUrl: item.videoUrl, thumbnail: item.thumbnail,
      status: item.status, rejectReason: item.rejectReason || '',
      creatorName: c ? c.name : 'Unknown', creatorId: item.creatorId,
      uploadedAt: item.uploadedAt, approvedAt: item.approvedAt || null,
      paymentPlan: item.paymentPlan || null,
      views: validViews(item.id), earnings: earningsFor(item)
    };
  }).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')));
});

app.post('/api/admin/content/:id/decision', auth('admin'), (req, res) => {
  const item = content.find(c => c.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Content not found.' });
  const { action, paymentMode, amount, rate, reason } = req.body;
  if (action === 'approve') {
    if (paymentMode === 'upfront') {
      if (!(Number(amount) > 0)) return res.status(400).json({ error: 'Enter the upfront amount (₹).' });
      item.paymentPlan = { mode: 'upfront', amount: Number(amount) };
    } else if (paymentMode === 'perview') {
      if (!(Number(rate) > 0)) return res.status(400).json({ error: 'Enter the per-view rate (₹).' });
      item.paymentPlan = { mode: 'perview', rate: Number(rate) };
    } else return res.status(400).json({ error: 'Choose a payment plan: upfront or per-view.' });
    item.status = 'approved'; item.approvedAt = now(); item.rejectReason = '';
  } else if (action === 'reject') {
    item.status = 'rejected'; item.rejectReason = (reason || '').trim() || 'Did not meet platform guidelines.';
    item.paymentPlan = null; item.approvedAt = null;
  } else return res.status(400).json({ error: 'Unknown action.' });
  save('content', content);
  res.json({ ok: true });
});

/* ---------- Excel report downloads ---------- */
function sheetFromRows(wb, name, header, rows) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({ wch: Math.max(h.length + 2, ...rows.map(r => String(r[i] == null ? '' : r[i]).length + 2), 10) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}
function sendWorkbook(res, wb, filename) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}
const d10 = s => s ? String(s).slice(0, 10) : '';
function planCell(p) {
  if (!p) return 'Not set';
  return p.mode === 'upfront' ? 'Upfront Rs.' + p.amount : 'Per-view Rs.' + p.rate;
}

app.get('/api/admin/report.xlsx', auth('admin'), (req, res) => {
  const wb = XLSX.utils.book_new();
  const subscriptionRevenue = subscribers.reduce((s, x) => s + totalPaid(x), 0);
  const totalPayout = content.reduce((s, c) => s + earningsFor(c), 0);
  sheetFromRows(wb, 'Overview', ['Metric', 'Value'], [
    ['Report generated', new Date().toLocaleString('en-IN')],
    ['Creators', creators.length],
    ['Subscribers', subscribers.length],
    ['Active subscribers', subscribers.filter(subActive).length],
    ['Subscription revenue (Rs.)', subscriptionRevenue],
    ['Total uploads', content.length],
    ['Live titles', content.filter(c => c.status === 'approved').length],
    ['Awaiting review', content.filter(c => c.status === 'pending').length],
    ['Rejected', content.filter(c => c.status === 'rejected').length],
    ['Verified views', views.length],
    ['Creator payout liability (Rs.)', totalPayout]
  ]);
  sheetFromRows(wb, 'Creators',
    ['Name', 'Email', 'Mobile', 'Aadhaar (masked)', 'PAN', 'Account Holder', 'Account No', 'IFSC', 'Bank', 'Branch', 'Joined', 'Uploads', 'Earnings (Rs.)'],
    creators.map(c => {
      const mine = content.filter(x => x.creatorId === c.id);
      return [c.name, c.email, c.mobile, 'XXXX-' + c.aadhaarLast4, c.pan, c.bank.accountHolder, c.bank.accountNumber, c.bank.ifsc, c.bank.bankName, c.bank.branch, d10(c.createdAt), mine.length, mine.reduce((s, m) => s + earningsFor(m), 0)];
    }));
  sheetFromRows(wb, 'Subscribers',
    ['Name', 'Email', 'Mobile', 'Age', 'Aadhaar (masked)', 'Plan', 'Status', 'Expires', 'Total Paid (Rs.)', 'Views Counted', 'Joined'],
    subscribers.map(s => [s.name, s.email, s.mobile, s.age, 'XXXX-' + s.aadhaarLast4, s.subscription ? s.subscription.label : '-', subActive(s) ? 'Active' : 'Expired', s.subscription ? d10(s.subscription.expiresAt) : '-', totalPaid(s), views.filter(v => v.subscriberId === s.id).length, d10(s.createdAt)]));
  sheetFromRows(wb, 'Content',
    ['Title', 'Creator', 'Type', 'Language', 'Rating', 'Status', 'Payment Plan', 'Verified Views', 'Earnings (Rs.)', 'Uploaded', 'Approved'],
    content.map(item => {
      const c = creators.find(x => x.id === item.creatorId);
      return [item.title, c ? c.name : '?', TYPES[item.type], item.language, item.ageRating, item.status, planCell(item.paymentPlan), validViews(item.id), earningsFor(item), d10(item.uploadedAt), d10(item.approvedAt)];
    }));
  sheetFromRows(wb, 'Payouts',
    ['Creator', 'PAN', 'Account Holder', 'Account No', 'IFSC', 'Bank', 'Branch', 'Payable (Rs.)'],
    creators.map(c => [c.name, c.pan, c.bank.accountHolder, c.bank.accountNumber, c.bank.ifsc, c.bank.bankName, c.bank.branch, content.filter(x => x.creatorId === c.id).reduce((s, m) => s + earningsFor(m), 0)]));
  sendWorkbook(res, wb, 'rangmanch-admin-report.xlsx');
});

app.get('/api/creator/report.xlsx', auth('creator'), (req, res) => {
  const c = creators.find(x => x.id === req.session.userId);
  if (!c) return res.status(404).json({ error: 'Account not found.' });
  const mine = content.filter(x => x.creatorId === c.id);
  const wb = XLSX.utils.book_new();
  sheetFromRows(wb, 'My Account', ['Field', 'Value'], [
    ['Report generated', new Date().toLocaleString('en-IN')],
    ['Name', c.name], ['Email', c.email], ['Mobile', c.mobile],
    ['Aadhaar', 'XXXX-' + c.aadhaarLast4 + ' (verified)'], ['PAN', c.pan],
    ['Account holder', c.bank.accountHolder], ['Account number', c.bank.accountNumber],
    ['IFSC', c.bank.ifsc], ['Bank & branch', c.bank.bankName + ', ' + c.bank.branch],
    ['Total earnings (Rs.)', mine.reduce((s, m) => s + earningsFor(m), 0)]
  ]);
  sheetFromRows(wb, 'My Content & Earnings',
    ['Title', 'Type', 'Language', 'Rating', 'Status', 'Rejection Reason', 'Payment Plan', 'Verified Views', 'Earnings (Rs.)', 'Uploaded', 'Approved'],
    mine.map(item => [item.title, TYPES[item.type], item.language, item.ageRating, item.status, item.rejectReason || '', planCell(item.paymentPlan), validViews(item.id), earningsFor(item), d10(item.uploadedAt), d10(item.approvedAt)]));
  sendWorkbook(res, wb, 'my-rangmanch-earnings.xlsx');
});

/* ---------- seed demo data on first run ---------- */
function seed() {
  if (creators.length || content.length) return;
  const demo = {
    id: id(), name: 'RangManch Studios (Demo)', email: 'demo@rangmanch.example', mobile: '9000000000',
    aadhaarLast4: '0001', aadhaarVerified: true, pan: 'ABCDE1234F',
    bank: { accountHolder: 'RangManch Studios', accountNumber: '123456789012', ifsc: 'SBIN0001234', bankName: 'State Bank of India', branch: 'Mumbai Main' },
    createdAt: now()
  };
  creators.push(demo);
  const g = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/';
  const items = [
    ['Big Buck Bunny', 'movie', 'English', 'U', g + 'BigBuckBunny.mp4', 'A giant rabbit takes gentle revenge on three bullying rodents in this classic animated short film.'],
    ['Elephants Dream', 'movie', 'English', 'UA', g + 'ElephantsDream.mp4', 'Two strange characters explore a surreal mechanical world in this open-source animated film.'],
    ['Sintel', 'movie', 'Hindi', 'UA', g + 'Sintel.mp4', 'Ek ladki apne kho gaye dragon ki talaash mein nikalti hai — dil chhoo lene wali kahani.'],
    ['Tears of Steel', 'series', 'English', 'A', g + 'TearsOfSteel.mp4', 'Sci-fi web series pilot: a group of warriors and scientists fight to save the future. Episode 1.'],
    ['Jaltarang – Title Song', 'song', 'Hindi', 'U', g + 'ForBiggerBlazes.mp4', 'Romantic melody from the upcoming album Jaltarang.'],
    ['Garba Raat Album Mix', 'song', 'Gujarati', 'U', g + 'ForBiggerEscapes.mp4', 'Navratri special non-stop garba mix — full energy, full masti!'],
    ['Bhauji Ke Mehndi', 'song', 'Bhojpuri', 'U', g + 'ForBiggerFun.mp4', 'Shaadi season superhit Bhojpuri geet.'],
    ['Chai Pe Charcha', 'short', 'Hindi', 'U', g + 'ForBiggerJoyrides.mp4', 'Ek chhoti si mulakat, ek badi si baat — award-winning short film.'],
    ['The Last Local', 'short', 'English', 'UA', g + 'ForBiggerMeltdowns.mp4', 'Two strangers on Mumbai\'s last local train of the night. A short film about chance.'],
    ['Safar', 'short', 'Gujarati', 'U', g + 'SubaruOutbackOnStreetAndDirt.mp4', 'Ek road trip jે jindagi badli nakhe — Gujarati short film.'],
    ['Dil Ki Dhun', 'song', 'Hindi', 'U', g + 'WeAreGoingOnBullrun.mp4', 'Romantic track — dil se bana, dil tak pahuncha.'],
    ['Raat Ka Safar', 'movie', 'Hindi', 'UA', g + 'VolkswagenGTIReview.mp4', 'Ek raat, ek highway, aur ek anjaan musafir. Thriller jo aakhri minute tak bandhe rakhe.'],
    ['Lavani Nights', 'song', 'Marathi', 'U', g + 'ForBiggerEscapes.mp4', 'Paramparik lavani la aadhunik touch — full josh, full thumka!'],
    ['Pind Di Shaan', 'song', 'Punjabi', 'U', g + 'ForBiggerJoyrides.mp4', 'Bhangra beats te dhol di goonj — Punjab di shaan!'],
    ['Chennai Beats', 'song', 'Tamil', 'U', g + 'ForBiggerMeltdowns.mp4', 'Kollywood kuthu beats — Chennai style!'],
    ['Hyderabad Diaries', 'short', 'Telugu', 'U', g + 'SubaruOutbackOnStreetAndDirt.mp4', 'Charminar nunchi Hitech City daaka — oka roju Hyderabad lo.'],
    ['Kolkata Junction', 'short', 'Bengali', 'UA', g + 'BigBuckBunny.mp4', 'Howrah bridge er niche duto ojana golpo mile jay.'],
    ['Bengaluru Days', 'movie', 'Kannada', 'U', g + 'Sintel.mp4', 'Ondu techie, ondu kanasu — Bengaluru nagaradalli ondu payana.'],
    ['Mumbai Local', 'series', 'Hindi', 'UA', g + 'ElephantsDream.mp4', 'Har din wahi train, har din nayi kahani. Episode 1: Pehli Mulakat.', 'Mumbai Local', '1'],
    ['Tears of Steel', 'series', 'English', 'A', g + 'TearsOfSteel.mp4', 'The warriors return for the final stand. Episode 2 of the sci-fi saga.', 'Tears of Steel', '2'],
    // last two stay "pending" so the admin approval queue has work to demo
    ['Apna Gaam', 'short', 'Gujarati', 'U', g + 'WhatCarCanYouGetForAGrand.mp4', 'Gaam ni yaadon par ek dil sparshi short film.', '', '', 'pending'],
    ['Sur Sangam', 'song', 'Marathi', 'U', g + 'ForBiggerFun.mp4', 'Shastriya ani lok sangeet cha sundar sangam.', '', '', 'pending']
  ];
  for (const [title, type, language, ageRating, videoUrl, description, sName, ep, st] of items) {
    const status = st || 'approved';
    const item = {
      id: id(), creatorId: demo.id, title, description, type, language, ageRating,
      seriesName: sName || (type === 'series' ? 'Tears of Steel' : ''), episode: ep || (type === 'series' ? '1' : ''),
      videoUrl, thumbnail: '', status, uploadedAt: now(), approvedAt: status === 'approved' ? now() : null,
      paymentPlan: status === 'approved' ? { mode: 'perview', rate: 2 } : null, rejectReason: ''
    };
    content.push(item);
  }
  save('creators', creators); save('content', content);
  console.log('Seeded demo creator + ' + items.length + ' demo titles.');
}
seed();

app.listen(PORT, () => console.log(settings.platformName + ' OTT running at http://localhost:' + PORT + '  (demo mode: ' + settings.demoMode + ')'));
