'use strict';
// First-party site analytics. The beacon posts here with no session and no cookie.
// A visitor id is the sha256 of a salt, the site key, the New York calendar day, the IP, and the
// user agent. The raw IP and user agent are not stored. The hash changes the next day.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const businesses = require('./businesses');
const demoRequests = require('./demoRequests');
const privacy = require('./privacy');

const BODY_LIMIT = '8kb';
const MAX_PER_WINDOW = 60;
const WINDOW_MS = 60 * 1000;
const RETAIN_DAYS = 180;
const MARKETING_KEY = 'receptwise';
const PANEL_ORIGIN = 'https://panel.receptwise.com';
const EVENTS = ['pageview', 'call_click', 'form_submit', 'demo_request', 'browser_call'];
const FORM_EVENTS = ['form_submit', 'demo_request'];
const HONEYPOT_KEYS = ['hp', 'company_website', 'companyWebsite'];
const BEACON_PATH = path.join(__dirname, '..', 'public', 'analytics.js');

const hits = new Map();
const originCache = new Map();
let cleanedAt = 0;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nyToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function shiftDay(iso, delta) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

function eachDay(from, to) {
  const days = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = shiftDay(cursor, 1);
  }
  return days;
}

function salt() {
  return config.tokenKey || 'receptwise-analytics-v1';
}

function visitorHash(siteKey, day, ip, userAgent) {
  return crypto.createHash('sha256')
    .update([salt(), siteKey, day, String(ip || ''), String(userAgent || '')].join('\n'))
    .digest('hex');
}

function hostOf(value) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].split('#')[0];
  raw = raw.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) return '';
  return raw;
}

function cleanPath(value) {
  let path = String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!path) return '/';
  path = path.split('?')[0];
  if (!path.startsWith('/')) {
    try {
      const url = new URL(path);
      path = url.pathname + (url.hash || '');
    } catch (e) {
      path = '/' + path.replace(/^\/+/, '');
    }
  }
  path = path.slice(0, 200);
  return path || '/';
}

function pathFromSource(sourcePage) {
  const raw = String(sourcePage || '').trim();
  if (!raw) return '/';
  try {
    const url = new URL(raw);
    return cleanPath(url.pathname + (url.hash || ''));
  } catch (e) {
    return cleanPath(raw);
  }
}

function referrerHost(value) {
  const raw = String(value || '').trim().slice(0, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host.length > 200) return '';
    return host;
  } catch (e) {
    return '';
  }
}

function utm(value) {
  const text = clean(value, 80);
  if (!text) return '';
  if (!/^[A-Za-z0-9._~+-]{1,80}$/.test(text)) return '';
  return text;
}

function honeypotFilled(body) {
  return HONEYPOT_KEYS.some((key) => {
    const value = body[key];
    if (value == null || value === false) return false;
    if (typeof value === 'object') return true;
    return clean(value, 200) !== '';
  });
}

function classifyOrigin(origin) {
  if (typeof origin !== 'string' || !origin || origin.length > 200) return { decision: 'deny' };
  let url;
  try { url = new URL(origin); } catch (e) { return { decision: 'deny' }; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return { decision: 'deny' };
  if (url.origin !== origin) return { decision: 'deny' };
  if (demoRequests.originAllowed(origin)) return { decision: 'allow' };
  const host = url.hostname.toLowerCase();
  const hosted = host.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.receptwise\.com$/);
  if (hosted) {
    const slug = hosted[1];
    if (slug === 'panel' || slug === 'www' || slug === 'api' || slug.endsWith('-admin')) return { decision: 'deny' };
    return { decision: 'hosted', slug };
  }
  if (host.endsWith('.pages.dev')) {
    const labels = host.slice(0, -'.pages.dev'.length).split('.');
    if (labels.length < 1 || labels.length > 2) return { decision: 'deny' };
    if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return { decision: 'deny' };
    return { decision: 'pages', project: labels[labels.length - 1] };
  }
  if (!hostOf(host)) return { decision: 'deny' };
  return { decision: 'custom', host };
}

function hostAliases(host) {
  const names = [host];
  if (host.startsWith('www.') && host.length > 4) names.push(host.slice(4));
  else names.push('www.' + host);
  return names;
}

async function pagesProjectKnown(project) {
  const { rows } = await db.query(
    'SELECT 1 FROM business_websites WHERE lower(cloudflare_project) = lower($1) LIMIT 1',
    [project]
  );
  return rows.length > 0;
}

async function customHostKnown(host) {
  const names = hostAliases(host);
  const needle = host.startsWith('www.') ? host.slice(4) : host;
  const web = await db.query(
    'SELECT 1 FROM business_websites WHERE lower(cloudflare_domain) = ANY($1::text[]) LIMIT 1',
    [names]
  );
  if (web.rows.length) return true;
  const found = await db.query(
    `SELECT profile FROM businesses
     WHERE status <> 'archived'
       AND (
         strpos(lower(coalesce(profile->>'domain', '')), $1) > 0
         OR strpos(lower(coalesce(profile->>'customDomain', '')), $1) > 0
         OR strpos(lower(coalesce(profile#>>'{wizard,domain}', '')), $1) > 0
       )
     LIMIT 20`,
    [needle]
  );
  return found.rows.some((row) => {
    const profile = row.profile || {};
    const wizard = profile.wizard && typeof profile.wizard === 'object' ? profile.wizard : {};
    return [profile.domain, profile.customDomain, wizard.domain].some((value) => names.includes(hostOf(value)));
  });
}

async function originAllowed(origin) {
  const kind = classifyOrigin(origin);
  if (kind.decision === 'allow') return true;
  if (kind.decision === 'deny') return false;
  const cached = originCache.get(origin);
  const now = Date.now();
  if (cached && cached.exp > now) return cached.ok;
  let ok = false;
  try {
    if (kind.decision === 'hosted') ok = Boolean(await businesses.getBySubdomain(kind.slug));
    else if (kind.decision === 'pages') ok = await pagesProjectKnown(kind.project);
    else if (kind.decision === 'custom') ok = await customHostKnown(kind.host);
  } catch (err) {
    console.error('analytics origin lookup failed', err.message);
    ok = false;
  }
  if (originCache.size > 500) originCache.clear();
  originCache.set(origin, { ok, exp: now + 60 * 1000 });
  return ok;
}

function resetOriginCache() {
  originCache.clear();
}

async function publicCors(req, res, next) {
  try {
    const origin = req.get('origin');
    res.set('Vary', 'Origin');
    if (origin) {
      if (!(await originAllowed(origin))) return res.status(403).json({ error: 'Origin is not allowed.' });
      res.set('Access-Control-Allow-Origin', origin);
    }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '86400');
      return res.status(204).end();
    }
    next();
  } catch (err) {
    next(err);
  }
}

function parseBody(req, res, next) {
  const type = String(req.get('content-type') || '');
  if (/^\s*application\/json\b/i.test(type)) return express.json({ limit: BODY_LIMIT })(req, res, next);
  if (/^\s*text\/plain\b/i.test(type)) {
    return express.text({ limit: BODY_LIMIT, type: '*/*' })(req, res, (err) => {
      if (err) return next(err);
      try {
        req.body = JSON.parse(String(req.body || ''));
      } catch (e) {
        return res.status(400).json({ error: 'Send a JSON object.' });
      }
      next();
    });
  }
  return res.status(415).json({ error: 'Send JSON (Content-Type: application/json).' });
}

function allowIp(ip, now = Date.now()) {
  const key = String(ip || 'unknown');
  const fresh = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_PER_WINDOW) {
    hits.set(key, fresh);
    return false;
  }
  fresh.push(now);
  if (hits.size > 5000) {
    for (const [name, times] of hits) {
      const kept = times.filter((t) => now - t < WINDOW_MS);
      if (kept.length) hits.set(name, kept);
      else hits.delete(name);
    }
  }
  hits.set(key, fresh);
  return true;
}

function resetLimits() {
  hits.clear();
}

async function resolveKey(raw) {
  let key = String(raw || '').trim().toLowerCase();
  if (!key || key.length > 63) return null;
  let businessId = null;
  if (/^\d+$/.test(key)) {
    const { rows } = await db.query(
      "SELECT id, subdomain FROM businesses WHERE id = $1 AND status <> 'archived'",
      [Number(key)]
    );
    if (!rows[0] || !rows[0].subdomain) return null;
    businessId = Number(rows[0].id);
    key = String(rows[0].subdomain).toLowerCase();
  }
  if (key === MARKETING_KEY) return { siteKey: MARKETING_KEY, businessId: null };
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(key)) return null;
  if (businessId == null) {
    const biz = await businesses.getBySubdomain(key);
    if (!biz || !biz.subdomain) return null;
    businessId = Number(biz.id);
    key = String(biz.subdomain).toLowerCase();
  }
  return { siteKey: key, businessId };
}

function prepareEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { action: 'error', status: 400, error: 'Send a JSON object.' };
  }
  if (Object.keys(body).length > 20) return { action: 'error', status: 400, error: 'Too many fields.' };
  if (honeypotFilled(body)) return { action: 'honeypot' };
  const event = String(body.event || '').trim().toLowerCase();
  if (!EVENTS.includes(event)) return { action: 'error', status: 400, error: 'Unknown event.' };
  const siteKey = body.site_key != null ? body.site_key : body.siteKey;
  if (siteKey == null || typeof siteKey === 'object') return { action: 'error', status: 400, error: 'Unknown site.' };
  let label = '';
  if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) && body.meta.label != null) {
    if (typeof body.meta.label !== 'object') label = clean(body.meta.label, 80);
  }
  return {
    action: 'store',
    event: {
      event,
      siteKey: String(siteKey),
      path: cleanPath(body.path),
      referrer: referrerHost(body.referrer),
      utmSource: utm(body.utm_source || body.utmSource),
      utmMedium: utm(body.utm_medium || body.utmMedium),
      utmCampaign: utm(body.utm_campaign || body.utmCampaign),
      label
    }
  };
}

async function maybePrune() {
  const now = Date.now();
  if (now - cleanedAt < 60 * 60 * 1000) return;
  cleanedAt = now;
  await db.query('DELETE FROM analytics_events WHERE day < (CURRENT_DATE - $1::int)', [RETAIN_DAYS]);
}

async function insertEvent(row) {
  await db.query(
    `INSERT INTO analytics_events
      (site_key, business_id, event, day, path, referrer_host, utm_source, utm_medium, utm_campaign, visitor_hash, meta)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      row.siteKey, row.businessId, row.event, row.day, row.path, row.referrer,
      row.utmSource, row.utmMedium, row.utmCampaign, row.visitorHash,
      JSON.stringify(row.label ? { label: row.label } : {})
    ]
  );
  maybePrune().catch((err) => console.error('analytics prune failed', err.message));
}

async function receive(req, res) {
  const ip = req.ip || 'unknown';
  if (!allowIp(ip)) return res.status(429).json({ error: 'Too many events. Try again in a minute.' });
  const prepared = prepareEvent(req.body);
  if (prepared.action === 'honeypot') return res.json({ ok: true });
  if (prepared.action === 'error') return res.status(prepared.status || 400).json({ error: prepared.error });
  const site = await resolveKey(prepared.event.siteKey);
  if (!site) return res.status(404).json({ error: 'Unknown site.' });
  const day = nyToday();
  const userAgent = clean(req.get('user-agent') || '', 300);
  await insertEvent({
    siteKey: site.siteKey,
    businessId: site.businessId,
    event: prepared.event.event,
    day,
    path: prepared.event.path,
    referrer: prepared.event.referrer,
    utmSource: prepared.event.utmSource,
    utmMedium: prepared.event.utmMedium,
    utmCampaign: prepared.event.utmCampaign,
    visitorHash: visitorHash(site.siteKey, day, ip, userAgent),
    label: prepared.event.label
  });
  res.json({ ok: true });
}

function mountPublic(app, wrap) {
  app.options('/api/public/analytics/event', publicCors);
  app.post('/api/public/analytics/event', publicCors, parseBody, wrap(receive));
}

function sendBeacon(_req, res) {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(fs.readFileSync(BEACON_PATH));
}

async function recordDemoRequest(meta) {
  try {
    const day = nyToday();
    const ip = meta && meta.ip || '';
    const userAgent = clean(meta && meta.userAgent || '', 300);
    await insertEvent({
      siteKey: MARKETING_KEY,
      businessId: null,
      event: 'demo_request',
      day,
      path: pathFromSource(meta && meta.sourcePage),
      referrer: '',
      utmSource: '',
      utmMedium: '',
      utmCampaign: '',
      visitorHash: visitorHash(MARKETING_KEY, day, ip, userAgent),
      label: ''
    });
  } catch (err) {
    console.error('analytics demo event failed', err.message);
  }
}

function emptyReport(scope) {
  const to = nyToday();
  const from = shiftDay(to, -(scope.days - 1));
  const series = eachDay(from, to).map((day) => ({
    day, pageviews: 0, visitors: 0, calls: 0, forms: 0, browserCalls: 0
  }));
  return {
    siteKey: scope.siteKey,
    label: scope.label,
    businessName: scope.businessName,
    days: scope.days,
    from,
    to,
    pageviews: 0,
    visitors: 0,
    calls: 0,
    forms: 0,
    browserCalls: 0,
    conversions: 0,
    conversionRate: 0,
    series,
    pages: [],
    referrers: []
  };
}

async function summarize(scope) {
  const to = nyToday();
  const from = shiftDay(to, -(scope.days - 1));
  if (!scope.siteKey) return emptyReport(scope);
  const params = [scope.siteKey, from, to];
  const [totals, byDay, pages, referrers] = await Promise.all([
    db.query(
      `SELECT
         count(*) FILTER (WHERE event = 'pageview')::int AS pageviews,
         count(DISTINCT visitor_hash) FILTER (WHERE event = 'pageview' AND visitor_hash <> '')::int AS visitors,
         count(*) FILTER (WHERE event = 'call_click')::int AS calls,
         count(*) FILTER (WHERE event IN ('form_submit', 'demo_request'))::int AS forms,
         count(*) FILTER (WHERE event = 'browser_call')::int AS browser_calls
       FROM analytics_events
       WHERE site_key = $1 AND day >= $2::date AND day <= $3::date`,
      params
    ),
    db.query(
      `SELECT day::text AS day,
         count(*) FILTER (WHERE event = 'pageview')::int AS pageviews,
         count(DISTINCT visitor_hash) FILTER (WHERE event = 'pageview' AND visitor_hash <> '')::int AS visitors,
         count(*) FILTER (WHERE event = 'call_click')::int AS calls,
         count(*) FILTER (WHERE event IN ('form_submit', 'demo_request'))::int AS forms,
         count(*) FILTER (WHERE event = 'browser_call')::int AS browser_calls
       FROM analytics_events
       WHERE site_key = $1 AND day >= $2::date AND day <= $3::date
       GROUP BY day`,
      params
    ),
    db.query(
      `SELECT path, count(*)::int AS pageviews
       FROM analytics_events
       WHERE site_key = $1 AND day >= $2::date AND day <= $3::date AND event = 'pageview'
       GROUP BY path
       ORDER BY pageviews DESC, path ASC
       LIMIT 8`,
      params
    ),
    db.query(
      `SELECT referrer_host AS host, count(*)::int AS pageviews
       FROM analytics_events
       WHERE site_key = $1 AND day >= $2::date AND day <= $3::date AND event = 'pageview' AND referrer_host <> ''
       GROUP BY referrer_host
       ORDER BY pageviews DESC, referrer_host ASC
       LIMIT 8`,
      params
    )
  ]);
  const by = new Map(byDay.rows.map((row) => [String(row.day).slice(0, 10), row]));
  const series = eachDay(from, to).map((day) => {
    const row = by.get(day);
    return {
      day,
      pageviews: row ? row.pageviews : 0,
      visitors: row ? row.visitors : 0,
      calls: row ? row.calls : 0,
      forms: row ? row.forms : 0,
      browserCalls: row ? row.browser_calls : 0
    };
  });
  const total = totals.rows[0] || {};
  const pageviews = total.pageviews || 0;
  const calls = total.calls || 0;
  const forms = total.forms || 0;
  const browserCalls = total.browser_calls || 0;
  const conversions = calls + forms + browserCalls;
  const conversionRate = pageviews ? Math.round((conversions / pageviews) * 1000) / 10 : 0;
  return {
    siteKey: scope.siteKey,
    label: scope.label,
    businessName: scope.businessName,
    days: scope.days,
    from,
    to,
    pageviews,
    visitors: total.visitors || 0,
    calls,
    forms,
    browserCalls,
    conversions,
    conversionRate,
    series,
    pages: pages.rows.map((row) => ({ path: row.path, pageviews: row.pageviews })),
    referrers: referrers.rows.map((row) => ({ host: row.host, pageviews: row.pageviews }))
  };
}

function scopeFromBusiness(biz, days) {
  const key = biz && biz.subdomain ? String(biz.subdomain).toLowerCase() : '';
  return {
    siteKey: key,
    label: key ? key + '.receptwise.com' : (biz && biz.name) || 'This business',
    businessName: (biz && biz.name) || '',
    days
  };
}

async function reportFor(req) {
  const days = String(req.query.days || '') === '30' ? 30 : 7;
  const asked = String(req.query.business || '').trim();
  const portal = req.customerPortal && req.customerPortal.business;
  if (portal) {
    if (asked && asked !== portal.slug && asked !== 'all') throw httpError(404, 'Business not found.');
    return summarize(scopeFromBusiness(portal, days));
  }
  if (privacy.isBusinessUser(req.user)) {
    const biz = req.user.businessSlug ? await businesses.getBySlug(req.user.businessSlug) : null;
    if (!biz) throw httpError(404, 'Business not found.');
    if (asked && asked !== biz.slug && asked !== 'all') throw httpError(404, 'Business not found.');
    return summarize(scopeFromBusiness(biz, days));
  }
  if (!privacy.isReceptwise(req.user)) throw httpError(403, 'Sign in required.');
  if (!asked || asked === MARKETING_KEY || asked === 'marketing') {
    return summarize({
      siteKey: MARKETING_KEY,
      label: 'www.receptwise.com',
      businessName: 'ReceptWise marketing site',
      days
    });
  }
  const biz = await businesses.getBySlug(asked);
  if (!biz) throw httpError(404, 'Business not found.');
  return summarize(scopeFromBusiness(biz, days));
}

function siteKeyFor(biz) {
  return businesses.normalizeSubdomain(biz && biz.subdomain) || businesses.normalizeSubdomain(biz && biz.slug) || '';
}

function scriptSrc() {
  const base = (config.appBaseUrl || PANEL_ORIGIN).replace(/\/+$/, '');
  return base + '/analytics.js';
}

module.exports = {
  mountPublic,
  sendBeacon,
  receive,
  recordDemoRequest,
  reportFor,
  prepareEvent,
  resolveKey,
  classifyOrigin,
  originAllowed,
  resetOriginCache,
  allowIp,
  resetLimits,
  visitorHash,
  cleanPath,
  referrerHost,
  pathFromSource,
  siteKeyFor,
  scriptSrc,
  nyToday,
  MARKETING_KEY,
  EVENTS,
  FORM_EVENTS,
  HONEYPOT_KEYS,
  MAX_PER_WINDOW,
  WINDOW_MS,
  BODY_LIMIT,
  BEACON_PATH
};
