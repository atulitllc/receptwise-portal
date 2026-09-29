'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

const COOKIE = 'rw_sid';
let dummy = null;
function dummyHash() {
  if (!dummy) dummy = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
  return dummy;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    path: '/',
    maxAge: config.sessionDays * 24 * 3600 * 1000
  };
}

async function createUser({ email, password, name, role, businessId, business }) {
  if (!email || !password) throw new Error('email and password are required');
  if (password.length < 10) throw new Error('password must be at least 10 characters');
  const storedRole = role === 'team' || role === 'owner' || role === 'staff' ? role : 'admin';
  const scoped = storedRole === 'owner' || storedRole === 'staff';
  let linkedId = null;
  if (scoped) {
    const raw = business || businessId;
    if (raw == null || String(raw).trim() === '') {
      const err = new Error('Owner and staff accounts belong to one business.');
      err.status = 400;
      throw err;
    }
    if (/^\d+$/.test(String(raw))) linkedId = Number(raw);
    else {
      const found = await db.query(
        "SELECT id FROM businesses WHERE slug = $1 AND status <> 'archived'",
        [String(raw).trim()]
      );
      if (!found.rows[0]) {
        const err = new Error('That business was not found.');
        err.status = 400;
        throw err;
      }
      linkedId = found.rows[0].id;
    }
  }
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await db.query(
    `INSERT INTO users (email, name, role, password_hash, business_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lower(email)) DO NOTHING RETURNING id, email, name, role, business_id`,
    [email.trim(), name || '', storedRole, hash, linkedId]
  );
  if (!rows[0]) return null;
  return publicUser(rows[0]);
}

// First boot: create the admin from ADMIN_EMAIL / ADMIN_PASSWORD when the users table is empty.
async function ensureBootstrapAdmin() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  if (!config.admin.email || !config.admin.password) {
    console.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (or run npm run create-user) to create the first admin.');
    return;
  }
  await createUser({ email: config.admin.email, password: config.admin.password, name: config.admin.name, role: 'admin' });
  console.log('Created first admin', config.admin.email);
}

// Simple in-memory limiter: 10 failed attempts per email+IP per 15 minutes.
const failures = new Map();
function limited(key) {
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec || now - rec.first > 15 * 60 * 1000) return false;
  return rec.count >= 10;
}
function recordFailure(key) {
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec || now - rec.first > 15 * 60 * 1000) failures.set(key, { first: now, count: 1 });
  else rec.count += 1;
}

async function login(req, res) {
  const email = String((req.body && req.body.email) || '').trim();
  const password = String((req.body && req.body.password) || '');
  const key = email.toLowerCase() + '|' + req.ip;
  if (limited(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { rows } = await db.query(
    `SELECT u.*, b.slug AS business_slug
     FROM users u
     LEFT JOIN businesses b ON b.id = u.business_id
     WHERE lower(u.email) = lower($1) AND NOT u.disabled`,
    [email]
  );
  const user = rows[0];
  // Compare against a dummy hash when the user doesn't exist to keep timing similar.
  const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash());
  if (!user || !ok) {
    recordFailure(key);
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  const portal = req.customerPortal && req.customerPortal.business;
  if (portal && (user.role === 'owner' || user.role === 'staff') && Number(user.business_id) !== Number(portal.id)) {
    return res.status(403).json({ error: 'This account is not for this business.' });
  }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 24 * 3600 * 1000);
  await db.query('INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)',
    [hashToken(token), user.id, expires, String(req.headers['user-agent'] || '').slice(0, 300)]);
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  res.cookie(COOKIE, token, cookieOptions());
  const pub = await publicUser(user);
  const home = (pub.role === 'owner' || pub.role === 'staff') && pub.businessSlug
    ? 'client.html?id=' + encodeURIComponent(pub.businessSlug)
    : 'dashboard.html';
  res.json({ user: pub, home });
}

async function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

async function publicUser(u) {
  let slug = u.business_slug || null;
  if (!slug && u.business_id) {
    const { rows } = await db.query('SELECT slug FROM businesses WHERE id = $1', [u.business_id]);
    slug = rows[0] ? rows[0].slug : null;
  }
  return {
    id: Number(u.id),
    email: u.email,
    name: u.name || nameFromEmail(u.email),
    role: u.role,
    businessId: u.business_id == null ? null : Number(u.business_id),
    businessSlug: slug
  };
}

function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].replace(/[._+-]+/g, ' ').trim();
  return local.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Team member';
}

// Attaches req.user when a valid session cookie is present. Never rejects.
async function loadUser(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const { rows } = await db.query(
        `SELECT u.*, b.slug AS business_slug
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN businesses b ON b.id = u.business_id
         WHERE s.id = $1 AND s.expires_at > now() AND NOT u.disabled`, [hashToken(token)]);
      if (rows[0]) req.user = await publicUser(rows[0]);
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

function isPublicDemoRequest(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return path === '/api/public/demo-requests';
}

// CSRF defence for cookie-authenticated writes: SameSite=Lax cookie + a custom header that
// cross-site forms cannot set without a CORS preflight. The marketing form is the exception:
// POST and OPTIONS /api/public/demo-requests are public and do not send X-RW-Client.
function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (isPublicDemoRequest(req)) return next();
  if (req.get('X-RW-Client') !== 'portal') return res.status(403).json({ error: 'Missing client header.' });
  next();
}

module.exports = {
  login, logout, loadUser, requireUser, requireAdmin, requireAppHeader, isPublicDemoRequest,
  createUser, ensureBootstrapAdmin, parseCookies, hashToken, COOKIE
};
