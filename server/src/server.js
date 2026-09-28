'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const businesses = require('./businesses');
const provisioning = require('./provisioning');
const calls = require('./calls');

// The portal pages live at the repo root (also published as the GitHub Pages demo).
const SITE_ROOT = path.join(__dirname, '..', '..');
const PAGES = ['index', 'dashboard', 'clients', 'add', 'client', 'billing', 'team'];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function timingSafeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function teamList() {
  const { rows } = await db.query('SELECT id, email, name, role FROM users WHERE NOT disabled ORDER BY id');
  return rows.map((u) => ({
    name: u.name || u.email.split('@')[0],
    email: u.email,
    role: u.role === 'admin' ? 'Admin' : 'Team',
    scope: u.role === 'admin' ? 'All businesses, billing, and costs' : 'Assigned businesses'
  }));
}

// Calls per day for the last 7 days (oldest first, today last), in Eastern time.
async function callsByDay() {
  const { rows } = await db.query(
    `SELECT (now() AT TIME ZONE 'America/New_York')::date - (coalesce(started_at, created_at) AT TIME ZONE 'America/New_York')::date AS ago, count(*)::int AS n
     FROM calls WHERE coalesce(started_at, created_at) > now() - interval '8 days' GROUP BY 1`);
  const out = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach((r) => { if (r.ago >= 0 && r.ago <= 6) out[6 - r.ago] = r.n; });
  return out;
}

async function feedList() {
  const { rows } = await db.query(
    `SELECT c.*, b.slug, b.timezone FROM calls c JOIN businesses b ON b.id = c.business_id
     ORDER BY coalesce(c.started_at, c.created_at) DESC LIMIT 8`);
  return rows.map((c) => ({
    time: new Intl.DateTimeFormat('en-US', { timeZone: c.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(c.started_at || c.created_at)),
    businessId: c.slug,
    text: c.summary || (c.outcome || 'Call') + ' · ' + (c.from_number || 'unknown caller')
  }));
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // ---- Vapi webhooks (no session; authenticated by shared secret) ----
  app.post('/webhooks/vapi', express.json({ limit: '5mb' }), wrap(async (req, res) => {
    if (config.vapi.webhookSecret) {
      const given = req.get('X-Vapi-Secret') || String(req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!timingSafeEqual(given, config.vapi.webhookSecret)) return res.status(401).json({ error: 'bad secret' });
    } else if (config.production) {
      return res.status(503).json({ error: 'VAPI_WEBHOOK_SECRET is not set' });
    }
    const msg = (req.body && req.body.message) || {};
    if (msg.type === 'end-of-call-report' || msg.type === 'status-update') {
      const call = Object.assign({}, msg.call || {});
      if (msg.type === 'status-update' && msg.status) call.status = msg.status;
      if (msg.type === 'end-of-call-report') call.status = 'ended';
      await calls.upsertCall(call, msg.type === 'end-of-call-report' ? msg : null);
    }
    res.json({ ok: true });
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(wrap(auth.loadUser));

  // ---- API ----
  const api = express.Router();
  api.use(auth.requireAppHeader);

  api.get('/health', wrap(async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  }));
  api.post('/auth/login', wrap(auth.login));
  api.post('/auth/logout', wrap(auth.logout));
  api.get('/me', auth.requireUser, (req, res) => res.json({ user: req.user }));

  api.post('/me/password', auth.requireUser, wrap(async (req, res) => {
    const { current, next } = req.body || {};
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (String(next || '').length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(String(next), 12)]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true, signedOut: true });
  }));

  api.get('/users', auth.requireAdmin, wrap(async (_req, res) => res.json({ users: await teamList() })));
  api.post('/users', auth.requireAdmin, wrap(async (req, res) => {
    const u = await auth.createUser(req.body || {});
    if (!u) return res.status(409).json({ error: 'That email already has an account.' });
    res.status(201).json({ user: u });
  }));

  api.get('/integrations/status', auth.requireUser, (_req, res) => res.json(provisioning.status()));

  api.get('/businesses', auth.requireUser, wrap(async (_req, res) => res.json({ businesses: await businesses.listUi() })));
  api.post('/businesses', auth.requireUser, wrap(async (req, res) => {
    const biz = await businesses.createBusiness(req.body || {}, req.user.id);
    res.status(201).json({ business: await businesses.toUi(biz) });
  }));

  async function loadBiz(req, res, next) {
    const biz = await businesses.getBySlug(req.params.slug);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    req.biz = biz;
    next();
  }
  const withBiz = [auth.requireUser, wrap(loadBiz)];

  api.get('/businesses/:slug', withBiz, wrap(async (req, res) => res.json({ business: await businesses.toUi(req.biz) })));
  api.put('/businesses/:slug', withBiz, wrap(async (req, res) => {
    const updated = await businesses.updateBusiness(req.params.slug, req.body || {}, req.user.id);
    res.json({ business: await businesses.toUi(updated) });
  }));
  api.put('/businesses/:slug/setup/:step', withBiz, wrap(async (req, res) => {
    if (!businesses.STEP_KEYS.includes(req.params.step)) return res.status(400).json({ error: 'Unknown setup step.' });
    if (['number', 'test'].includes(req.params.step)) return res.status(400).json({ error: 'That step is updated by the server.' });
    if (req.params.step === 'texting' && req.body && req.body.status === 'connected' && !config.smsEnabled) {
      return res.status(400).json({ error: 'Texting stays off until SMS_ENABLED is turned on (after the EIN and A2P registration).' });
    }
    await businesses.setStep(req.biz.id, req.params.step, (req.body || {}).status, String((req.body || {}).detail || ''), {});
    res.json({ business: await businesses.toUi(req.biz) });
  }));

  api.post('/businesses/:slug/assistant/publish', withBiz, wrap(async (req, res) => {
    const result = await provisioning.publishAssistant(req.biz, req.user.id);
    res.json(Object.assign({ ok: true }, result));
  }));
  api.get('/businesses/:slug/numbers/search', withBiz, wrap(async (req, res) => {
    res.json({ numbers: await provisioning.searchNumbers(req.query.areaCode ? String(req.query.areaCode).replace(/\D/g, '').slice(0, 3) : '') });
  }));
  // Spends money: admins only.
  api.post('/businesses/:slug/numbers/provision', auth.requireAdmin, wrap(loadBiz), wrap(async (req, res) => {
    const result = await provisioning.provisionNumber(req.biz, req.body || {}, req.user.id);
    res.status(201).json(Object.assign({ ok: true }, result, { business: await businesses.toUi(req.biz) }));
  }));
  api.post('/businesses/:slug/test-call', withBiz, wrap(async (req, res) => {
    res.json(Object.assign({ ok: true }, await provisioning.testCall(req.biz, (req.body || {}).to, req.user.id)));
  }));
  api.post('/businesses/:slug/calls/sync', withBiz, wrap(async (req, res) => {
    const result = await provisioning.syncCalls(req.biz);
    res.json(Object.assign({ ok: true }, result, { business: await businesses.toUi(req.biz) }));
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---- Portal ----
  // Live data replaces the demo's sample data: plans come from the static file, everything else from Postgres.
  const staticData = fs.readFileSync(path.join(SITE_ROOT, 'assets', 'data.js'), 'utf8');
  app.get('/assets/data.js', wrap(async (req, res) => {
    let payload = { live: { user: null, integrations: {} }, businesses: [], team: [], feed: [], callsByDay: [] };
    if (req.user) {
      const [list, team, feed, byDay] = await Promise.all([businesses.listUi(), teamList(), feedList(), callsByDay()]);
      payload = { live: { user: req.user, integrations: provisioning.status() }, businesses: list, team, feed, callsByDay: byDay };
    }
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(staticData + '\n;(function (L) {\n  window.RW_LIVE = L.live;\n  window.RW_DATA.businesses = L.businesses;\n  window.RW_DATA.team = L.team;\n  window.RW_DATA.feed = L.feed;\n  window.RW_DATA.callsByDay = L.callsByDay;\n})(' + safeJson(payload) + ');\n');
  }));
  app.use('/assets', express.static(path.join(SITE_ROOT, 'assets'), { index: false, maxAge: '5m' }));
  app.get('/', (_req, res) => res.sendFile(path.join(SITE_ROOT, 'index.html')));
  PAGES.forEach((p) => app.get('/' + p + '.html', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(SITE_ROOT, p + '.html'));
  }));

  app.use((_req, res) => res.status(404).send('Not found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    const body = { error: status >= 500 && !err.code ? 'Server error.' : err.message };
    if (err.code === 'NOT_CONFIGURED') { body.code = err.code; body.missing = err.missing; }
    if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) res.status(status).json(body);
    else res.status(status).send(body.error);
  });
  return app;
}

module.exports = { createApp };
