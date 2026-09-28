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

async function createUser({ email, password, name, role }) {
  if (!email || !password) throw new Error('email and password are required');
  if (password.length < 10) throw new Error('password must be at least 10 characters');
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await db.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(email)) DO NOTHING RETURNING id, email, name, role`,
    [email.trim(), name || '', role === 'team' ? 'team' : 'admin', hash]
  );
  return rows[0] || null;
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
  const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = lower($1) AND NOT disabled', [email]);
  const user = rows[0];
  // Compare against a dummy hash when the user doesn't exist to keep timing similar.
  const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash());
  if (!user || !ok) {
    recordFailure(key);
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 24 * 3600 * 1000);
  await db.query('INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)',
    [hashToken(token), user.id, expires, String(req.headers['user-agent'] || '').slice(0, 300)]);
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  res.cookie(COOKIE, token, cookieOptions());
  res.json({ user: publicUser(user) });
}

async function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

function publicUser(u) {
  return { id: Number(u.id), email: u.email, name: u.name || nameFromEmail(u.email), role: u.role };
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
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.expires_at > now() AND NOT u.disabled`, [hashToken(token)]);
      if (rows[0]) req.user = publicUser(rows[0]);
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

// CSRF defence for cookie-authenticated writes: SameSite=Lax cookie + a custom header that
// cross-site forms cannot set without a CORS preflight (which this server never grants).
function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-RW-Client') !== 'portal') return res.status(403).json({ error: 'Missing client header.' });
  next();
}

module.exports = {
  login, logout, loadUser, requireUser, requireAdmin, requireAppHeader,
  createUser, ensureBootstrapAdmin, parseCookies, hashToken, COOKIE
};
