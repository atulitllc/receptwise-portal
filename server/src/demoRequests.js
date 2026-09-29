'use strict';
// Public lead capture for the marketing site contact form, plus the admin list.
// No mail is sent: this app has no NOTIFY_EMAIL and no email provider.
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const audit = require('./audit');
const businesses = require('./businesses');
const vapi = require('./integrations/vapi');

const BODY_LIMIT = '16kb';
const MAX_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;
const STATUSES = ['new', 'contacted', 'closed'];

const FIXED_ORIGINS = new Set([
  'https://receptwise.com',
  'https://www.receptwise.com',
  'https://atulitllc.github.io'
]);

// Aliases cover the live marketing form (name, business, phone, email, time, plan)
// and the camelCase / snake_case names a later form might send.
const FIELDS = {
  name: ['name', 'fullName', 'full_name'],
  businessName: ['businessName', 'business_name', 'business', 'company', 'companyName', 'company_name'],
  phone: ['phone', 'phoneNumber', 'phone_number', 'mobile', 'tel'],
  email: ['email', 'emailAddress', 'email_address'],
  businessType: ['businessType', 'business_type', 'category'],
  preferredTime: ['preferredTime', 'preferred_time', 'time', 'preferred'],
  message: ['message', 'notes', 'comment', 'comments', 'details'],
  plan: ['plan'],
  sourcePage: ['sourcePage', 'source_page', 'source', 'page', 'pageUrl', 'page_url']
};

const LIMITS = {
  name: 120,
  businessName: 160,
  phone: 40,
  email: 254,
  businessType: 80,
  preferredTime: 120,
  message: 2000,
  plan: 40,
  sourcePage: 500
};

const LABELS = {
  name: 'Name',
  businessName: 'Business name',
  phone: 'Phone',
  email: 'Email',
  businessType: 'Business type',
  preferredTime: 'Preferred time',
  message: 'Message',
  plan: 'Plan',
  sourcePage: 'Source page'
};

// Hidden field the marketing form should include and leave empty.
const HONEYPOT_KEYS = ['company_website', 'companyWebsite', '_honeypot'];

const hits = new Map();

function knownKeys() {
  const keys = new Set(HONEYPOT_KEYS);
  Object.keys(FIELDS).forEach((field) => FIELDS[field].forEach((key) => keys.add(key)));
  return keys;
}

function originAllowed(origin) {
  if (typeof origin !== 'string' || !origin || origin.length > 200) return false;
  let url;
  try { url = new URL(origin); } catch (e) { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  if (url.origin !== origin) return false;
  if (FIXED_ORIGINS.has(origin)) return true;
  const host = url.hostname;
  if (!/^[a-z0-9.-]+\.pages\.dev$/.test(host)) return false;
  if (host.includes('..') || host.includes('.-') || host.includes('-.')) return false;
  return true;
}

function publicCors(req, res, next) {
  const origin = req.get('origin');
  res.set('Vary', 'Origin');
  if (origin) {
    if (!originAllowed(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    res.set('Access-Control-Allow-Origin', origin);
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  next();
}

function requireJson(req, res, next) {
  if (!/^\s*application\/json\b/i.test(String(req.get('content-type') || ''))) {
    return res.status(415).json({ error: 'Send JSON (Content-Type: application/json).' });
  }
  next();
}

function allowIp(ip, now = Date.now()) {
  const key = String(ip || 'unknown');
  const fresh = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_PER_HOUR) {
    hits.set(key, fresh);
    return false;
  }
  fresh.push(now);
  hits.set(key, fresh);
  return true;
}

function resetLimits() {
  hits.clear();
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex');
}

function clean(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function readField(body, keys) {
  for (const key of keys) {
    if (body[key] == null || typeof body[key] === 'object') continue;
    const text = clean(body[key]);
    if (text) return text;
  }
  return '';
}

function honeypotFilled(body) {
  return HONEYPOT_KEYS.some((key) => {
    const value = body[key];
    if (value == null || value === false) return false;
    if (typeof value === 'object') return true;
    return clean(value) !== '';
  });
}

function validEmail(value) {
  return value.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function extraFields(body) {
  const known = knownKeys();
  const keys = Object.keys(body).filter((key) => !known.has(key));
  if (keys.length > 12) return { error: 'Too many fields.', field: 'extra' };
  const extra = {};
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
    const value = body[key];
    if (value == null || typeof value === 'object') continue;
    const text = clean(value);
    if (!text) continue;
    if (text.length > 500) return { error: 'A field is too long.', field: key };
    extra[key] = text;
  }
  return { extra };
}

// Returns { action: 'honeypot' }, { action: 'error', status, error, field }, or { action: 'store', lead }.
function prepareLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { action: 'error', status: 400, error: 'Send a JSON object.' };
  }
  if (honeypotFilled(body)) return { action: 'honeypot' };

  const lead = {};
  for (const field of Object.keys(FIELDS)) {
    lead[field] = readField(body, FIELDS[field]);
    if (lead[field].length > LIMITS[field]) {
      return { action: 'error', status: 400, error: LABELS[field] + ' is too long.', field };
    }
  }
  if (!lead.name) return { action: 'error', status: 400, error: 'Name is required.', field: 'name' };
  if (lead.email && !validEmail(lead.email)) {
    return { action: 'error', status: 400, error: 'Enter a valid email.', field: 'email' };
  }
  const phone = lead.phone ? vapi.toE164(lead.phone) : '';
  if (lead.phone && !phone) {
    return { action: 'error', status: 400, error: 'Enter a valid US phone number.', field: 'phone' };
  }
  if (!phone && !lead.email) {
    return { action: 'error', status: 400, error: 'Add a phone number or an email.', field: 'contact' };
  }
  const extra = extraFields(body);
  if (extra.error) return { action: 'error', status: 400, error: extra.error, field: extra.field };
  lead.phone = phone;
  lead.email = lead.email.toLowerCase();
  lead.extra = extra.extra;
  return { action: 'store', lead };
}

function clipHeader(value, max) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

async function insertLead(lead, meta) {
  const { rows } = await db.query(
    `INSERT INTO demo_requests
      (name, business_name, phone, email, business_type, preferred_time, message, plan, extra, source_page, user_agent, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
     RETURNING id`,
    [
      lead.name, lead.businessName, lead.phone, lead.email, lead.businessType, lead.preferredTime,
      lead.message, lead.plan, JSON.stringify(lead.extra || {}),
      meta.sourcePage, meta.userAgent, meta.ipHash
    ]
  );
  return Number(rows[0].id);
}

async function receive(req, res) {
  const ip = req.ip || 'unknown';
  if (!allowIp(ip)) return res.status(429).json({ error: 'Too many requests. Try again in an hour.' });
  const prepared = prepareLead(req.body);
  if (prepared.action === 'honeypot') return res.json({ ok: true });
  if (prepared.action === 'error') {
    return res.status(prepared.status || 400).json({ error: prepared.error, field: prepared.field || '' });
  }
  const lead = prepared.lead;
  await insertLead(lead, {
    sourcePage: lead.sourcePage || clipHeader(req.get('referer') || req.get('referrer') || '', LIMITS.sourcePage),
    userAgent: clipHeader(req.get('user-agent') || '', 300),
    ipHash: hashIp(ip)
  });
  res.json({ ok: true });
}

function mountPublic(app, wrap) {
  const parse = express.json({ limit: BODY_LIMIT });
  app.options('/api/public/demo-requests', publicCors);
  app.post('/api/public/demo-requests', publicCors, requireJson, parse, wrap(receive));
}

function toPublic(row) {
  const extra = row.extra && typeof row.extra === 'object' && !Array.isArray(row.extra) ? row.extra : {};
  return {
    id: Number(row.id),
    name: row.name,
    businessName: row.business_name,
    phone: row.phone,
    phonePretty: businesses.prettyPhone(row.phone),
    email: row.email,
    businessType: row.business_type,
    preferredTime: row.preferred_time,
    message: row.message,
    plan: row.plan || '',
    extra,
    sourcePage: row.source_page,
    userAgent: row.user_agent,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function list() {
  const { rows } = await db.query(
    `SELECT id, name, business_name, phone, email, business_type, preferred_time, message, plan, extra,
            source_page, user_agent, status, created_at, updated_at
     FROM demo_requests
     ORDER BY created_at DESC, id DESC
     LIMIT 500`
  );
  return rows.map(toPublic);
}

async function setStatus(idRaw, status, userId) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id < 1) {
    const err = new Error('Demo request not found.');
    err.status = 404;
    throw err;
  }
  if (!STATUSES.includes(status)) {
    const err = new Error('Status must be new, contacted, or closed.');
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    'UPDATE demo_requests SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, status]
  );
  if (!rows[0]) {
    const err = new Error('Demo request not found.');
    err.status = 404;
    throw err;
  }
  await audit.record(userId, null, 'demo_request.status', { id, status });
  return toPublic(rows[0]);
}

module.exports = {
  mountPublic, list, setStatus, prepareLead, originAllowed, allowIp, resetLimits, hashIp,
  BODY_LIMIT, MAX_PER_HOUR, WINDOW_MS, HONEYPOT_KEYS, STATUSES
};
