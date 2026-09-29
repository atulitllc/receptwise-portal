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
const settings = require('./settings');
const metrics = require('./metrics');
const phoneView = require('./phoneView');
const social = require('./social');
const meta = require('./integrations/meta');
const trelloSync = require('./trelloSync');
const exportData = require('./exportData');

// The portal pages live at the repo root (also published as the GitHub Pages demo).
const SITE_ROOT = path.join(__dirname, '..', '..');
const PAGES = ['index', 'dashboard', 'clients', 'add', 'client', 'billing', 'team', 'phone', 'settings', 'integrations'];

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

async function callsByDay() {
  const { rows } = await db.query(
    `SELECT (now() AT TIME ZONE 'America/New_York')::date - (coalesce(started_at, created_at) AT TIME ZONE 'America/New_York')::date AS ago, count(*)::int AS n
     FROM calls WHERE coalesce(started_at, created_at) > now() - interval '8 days' GROUP BY 1`);
  const out = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach((r) => { if (r.ago >= 0 && r.ago <= 6) out[6 - r.ago] = r.n; });
  return out;
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
      const stored = await calls.upsertCall(call, msg.type === 'end-of-call-report' ? msg : null);
      if (stored) await trelloSync.onCallStored(stored);
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

  api.get('/export', auth.requireAdmin, wrap(exportData.send));
  api.get('/users', auth.requireAdmin, wrap(async (_req, res) => res.json({ users: await teamList() })));
  api.post('/users', auth.requireAdmin, wrap(async (req, res) => {
    const u = await auth.createUser(req.body || {});
    if (!u) return res.status(409).json({ error: 'That email already has an account.' });
    res.status(201).json({ user: u });
  }));

  api.get('/integrations/status', auth.requireUser, (_req, res) => res.json(provisioning.status()));

  // Search only. Buying stays on POST /businesses/:slug/numbers/provision.
  api.get('/numbers/search', auth.requireAdmin, wrap(async (req, res) => {
    const areaCode = String(req.query.areaCode || '').replace(/\D/g, '').slice(0, 3);
    if (!/^[2-9]\d{2}$/.test(areaCode)) return res.status(400).json({ error: 'Enter a 3-digit area code.' });
    res.json({ numbers: await provisioning.searchNumbers(areaCode) });
  }));

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
    await require('./audit').record(req.user.id, req.biz.id, 'call.sync', result);
    res.json(Object.assign({ ok: true }, result, { business: await businesses.toUi(req.biz) }));
  }));

  api.get('/businesses/:slug/settings', withBiz, wrap(async (req, res) => {
    res.json(await settings.getSettings(req.biz));
  }));
  api.put('/businesses/:slug/settings', withBiz, wrap(async (req, res) => {
    res.json(await settings.saveAndPush(req.biz, req.body || {}, req.user.id));
  }));
  api.get('/businesses/:slug/phone', withBiz, wrap(async (req, res) => {
    res.json(await phoneView.liveNumbers(req.biz));
  }));
  api.get('/businesses/:slug/integrations', withBiz, wrap(async (req, res) => {
    const accounts = await social.listForBusiness(req.biz.id);
    res.json(Object.assign(accounts, { trello: await trelloSync.publicStatus(req.biz.id) }));
  }));
  api.get('/businesses/:slug/trello', withBiz, wrap(async (req, res) => {
    res.json(await trelloSync.publicStatus(req.biz.id));
  }));
  api.put('/businesses/:slug/trello/credentials', withBiz, wrap(async (req, res) => {
    res.json(await trelloSync.saveCredentials(req.biz, req.body || {}, req.user.id));
  }));
  api.delete('/businesses/:slug/trello/credentials', withBiz, wrap(async (req, res) => {
    res.json(await trelloSync.removeCredentials(req.biz, req.user.id));
  }));
  api.post('/businesses/:slug/trello/test', withBiz, wrap(async (req, res) => {
    res.json(await trelloSync.testConnection(req.biz, req.user.id));
  }));
  api.get('/businesses/:slug/trello/boards', withBiz, wrap(async (req, res) => {
    res.json(await trelloSync.listBoards(req.biz));
  }));
  api.get('/businesses/:slug/trello/boards/:boardId/lists', withBiz, wrap(async (req, res) => {
    res.json(await trelloSync.listLists(req.biz, req.params.boardId));
  }));
  api.put('/businesses/:slug/trello', withBiz, wrap(async (req, res) => {
    res.json(await trelloSync.saveDestination(req.biz, req.body || {}, req.user.id));
  }));
  api.put('/businesses/:slug/integrations/:provider', withBiz, wrap(async (req, res) => {
    res.json(await social.recordManual(req.biz, req.params.provider, req.body || {}, req.user.id));
  }));
  api.delete('/businesses/:slug/integrations/:provider', withBiz, wrap(async (req, res) => {
    res.json(await social.removeIntegration(req.biz, req.params.provider, req.user.id));
  }));

  api.get('/metrics', auth.requireUser, wrap(async (req, res) => {
    if (!req.query.business) return res.json(await metrics.collect(null));
    const biz = await businesses.getBySlug(String(req.query.business));
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    res.json(await metrics.collect(biz.id));
  }));
  api.post('/calls/sync', auth.requireUser, wrap(async (req, res) => {
    const slug = req.body && req.body.business;
    if (slug) {
      const biz = await businesses.getBySlug(String(slug));
      if (!biz) return res.status(404).json({ error: 'Business not found.' });
      const result = await provisioning.syncCalls(biz);
      await require('./audit').record(req.user.id, biz.id, 'call.sync', result);
      return res.json(Object.assign({ ok: true }, result));
    }
    res.json(Object.assign({ ok: true }, await provisioning.syncAll(req.user.id)));
  }));

  api.get('/integrations/meta/start', auth.requireUser, wrap(async (req, res) => {
    const biz = await businesses.getBySlug(String(req.query.business || ''));
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    res.redirect(await social.beginMeta(biz, req.user.id));
  }));
  api.get('/integrations/meta/callback', wrap(async (req, res) => {
    if (req.query.error) {
      const message = String(req.query.error_description || req.query.error || 'Meta declined the connection.');
      return res.redirect('/integrations.html?error=' + encodeURIComponent(message));
    }
    try {
      const result = await social.finishMeta(String(req.query.code || ''), String(req.query.state || ''));
      res.redirect('/integrations.html?id=' + encodeURIComponent(result.slug) + '&connected=1');
    } catch (err) {
      res.redirect('/integrations.html?error=' + encodeURIComponent(err.message || 'Meta connection failed.'));
    }
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---- Portal ----
  // Live data replaces the demo's sample data: plans come from the static file, everything else from Postgres.
  const staticData = fs.readFileSync(path.join(SITE_ROOT, 'assets', 'data.js'), 'utf8');
  app.get('/assets/data.js', wrap(async (req, res) => {
    let payload = { live: { user: null, integrations: {} }, businesses: [], team: [], feed: [], callsByDay: [] };
    if (req.user) {
      const [list, team, byDay, dash] = await Promise.all([
        businesses.listUi(), teamList(), callsByDay(), metrics.collect(null)
      ]);
      const integrations = Object.assign(provisioning.status(), {
        meta: meta.configured(),
        encryption: Boolean(config.tokenKey)
      });
      payload = {
        live: { user: req.user, integrations },
        businesses: list,
        team,
        feed: dash.activity.map((item) => ({ time: item.time, businessId: item.businessId, text: item.text })),
        callsByDay: byDay,
        metrics: dash
      };
    }
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(staticData + '\n;(function (L) {\n  window.RW_LIVE = L.live;\n  window.RW_DATA.businesses = L.businesses;\n  window.RW_DATA.team = L.team;\n  window.RW_DATA.feed = L.feed;\n  window.RW_DATA.callsByDay = L.callsByDay;\n  window.RW_DATA.metrics = L.metrics || null;\n})(' + safeJson(payload) + ');\n');
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
    if (err.fields) body.fields = err.fields;
    if (err.saved) body.saved = true;
    if (err.backupId) body.backupId = err.backupId;
    if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) res.status(status).json(body);
    else res.status(status).send(body.error);
  });
  return app;
}

module.exports = { createApp };
