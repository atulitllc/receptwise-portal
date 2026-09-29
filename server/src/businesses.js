'use strict';
// Data access for businesses + mapping DB rows to the shape the portal UI (assets/app.js) renders.
const db = require('./db');
const config = require('./config');

const STEPS = [
  ['number', 'AI number'],
  ['test', 'Receptionist test call'],
  ['forwarding', 'Forwarding'],
  ['calendar', 'Calendar'],
  ['texting', 'Texting registration'],
  ['email', 'Email domain'],
  ['reviews', 'Google review link'],
  ['gbp', 'Google Business Profile'],
  ['social', 'Facebook and Instagram'],
  ['website', 'Website'],
  ['billing', 'Billing']
];
const STEP_KEYS = STEPS.map((s) => s[0]);
const TEXTING_HOLD = 'Texting stays off until the final company tax ID is on file. Calls still work. Email is used instead.';

// Profile keys the UI may write. Anything else in a PUT body is ignored.
const PROFILE_KEYS = [
  'address', 'website', 'hours', 'staff', 'locations', 'tier', 'plan', 'price', 'minutesCap', 'setupFee',
  'card', 'nextInvoice', 'trial', 'owner', 'phone', 'greeting', 'voice', 'languages', 'transfer',
  'capabilities', 'services', 'faqs', 'blurb', 'template', 'domainStatus', 'reviewLink', 'socialAccounts',
  'reviews', 'posts', 'campaigns', 'contacts', 'suppressed', 'activity', 'paused'
];

function slugify(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'business';
}

function pickProfile(input) {
  const out = {};
  for (const k of PROFILE_KEYS) if (input && input[k] !== undefined) out[k] = input[k];
  // Phone "aiNumber" is owned by the server (phone_numbers table), never by the client.
  if (out.phone && typeof out.phone === 'object') {
    out.phone = Object.assign({}, out.phone);
    delete out.phone.aiNumber;
  }
  return out;
}

function defaultSteps(overrides) {
  const base = {
    number: { status: 'pending', detail: 'No AI number yet. Get one from the Receptionist tab once Twilio and Vapi are connected.' },
    test: { status: 'pending', detail: 'Test call has not been run.' },
    forwarding: { status: 'pending', detail: 'Forwarding is not turned on yet.', owner: 'Client' },
    calendar: { status: 'pending', detail: 'Calendar is not connected yet.', owner: 'Client' },
    texting: { status: 'action', detail: TEXTING_HOLD },
    email: { status: 'pending', detail: 'SPF and DKIM are not checked yet.' },
    reviews: { status: 'pending', detail: 'Google review link is not on file.' },
    gbp: { status: 'pending', detail: 'Google Business Profile access is not confirmed.', owner: 'Client' },
    social: { status: 'pending', detail: 'Facebook and Instagram are not connected yet.', owner: 'Client' },
    website: { status: 'pending', detail: 'Website is not published.' },
    billing: { status: 'pending', detail: 'Billing is not set up.' }
  };
  return Object.assign(base, overrides || {});
}

async function upsertSteps(client, businessId, steps) {
  for (const key of Object.keys(steps)) {
    if (!STEP_KEYS.includes(key)) continue;
    const s = steps[key] || {};
    const status = ['pending', 'action', 'connected'].includes(s.status) ? s.status : 'pending';
    await client.query(
      `INSERT INTO business_setup (business_id, step_key, status, detail, owner, is_next, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (business_id, step_key) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail,
         owner = EXCLUDED.owner, is_next = EXCLUDED.is_next, data = business_setup.data || EXCLUDED.data, updated_at = now()`,
      [businessId, key, status, String(s.detail || ''), s.owner === 'Client' ? 'Client' : 'Team', Boolean(s.next), s.data || {}]
    );
  }
}

async function setStep(businessId, key, status, detail, data) {
  await upsertSteps({ query: db.query }, businessId, { [key]: { status, detail, data } });
}

async function uniqueSlug(client, base) {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const { rows } = await client.query('SELECT 1 FROM businesses WHERE slug = $1', [slug]);
    if (!rows.length) return slug;
    slug = base + '-' + i;
  }
  return base + '-' + Date.now();
}

const WIZARD_STRINGS = [
  'name', 'category', 'address', 'city', 'website', 'hours', 'timezone', 'ownerName', 'ownerMobile', 'ownerEmail',
  'tier', 'plan', 'phoneMode', 'carrier', 'forwardType', 'businessNumber', 'areaCode', 'chosenNumber', 'chosenE164',
  'testStatus', 'testNote', 'calendar', 'greeting', 'services', 'faqs', 'transfer', 'voice', 'facebook', 'instagram',
  'gbp', 'siteChoice', 'domain', 'template', 'legalName', 'taxId', 'sampleSms', 'consent', 'createdId', 'draftId'
];
const WIZARD_BOOLS = ['pilot', 'multi', 'clientDone', 'spanish'];

function wizardFrom(input) {
  const src = Object.assign({}, (input && input.wizard) || {});
  const out = {};
  WIZARD_STRINGS.forEach((key) => {
    if (src[key] != null) out[key] = String(src[key]).slice(0, 8000);
  });
  WIZARD_BOOLS.forEach((key) => {
    if (src[key] != null) out[key] = Boolean(src[key]);
  });
  const raw = input && input.wizardStep != null ? input.wizardStep : src.step;
  const step = Number(raw);
  out.step = Number.isFinite(step) ? Math.max(0, Math.min(9, Math.floor(step))) : 0;
  return out;
}

function assertDraftIdentity(input) {
  const name = String((input && input.name) || '').trim();
  const category = String((input && input.category) || '').trim();
  if (!name) { const e = new Error('Business name is required.'); e.status = 400; throw e; }
  if (!category) { const e = new Error('Choose a business type.'); e.status = 400; throw e; }
}

function checklistFromClient(input) {
  const fromClient = {};
  (input.checklist || []).forEach((row) => {
    if (row && row.key && !['number', 'test'].includes(row.key)) fromClient[row.key] = row;
  });
  return fromClient;
}

async function createBusiness(input, userId, opts) {
  const name = String(input.name || '').trim();
  if (!name) { const e = new Error('Business name is required.'); e.status = 400; throw e; }
  const status = opts && opts.status === 'draft' ? 'draft' : 'setup';
  const profile = pickProfile(input);
  if (opts && opts.wizard) {
    profile.wizard = opts.wizard;
    profile.wizardStep = opts.wizard.step;
  }
  return db.tx(async (c) => {
    const slug = await uniqueSlug(c, slugify(input.slug || name));
    const { rows } = await c.query(
      `INSERT INTO businesses (slug, name, category, city, timezone, status, pilot, profile, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [slug, name, String(input.category || ''), String(input.city || ''), tzFromLabel(input.timezone),
        status, Boolean(input.pilot), profile, userId || null]
    );
    const biz = rows[0];
    // Client-supplied checklist is advisory; the number/test steps are server-owned.
    await upsertSteps(c, biz.id, defaultSteps(checklistFromClient(input)));
    await c.query('INSERT INTO audit_log (user_id, business_id, action) VALUES ($1, $2, $3)', [userId || null, biz.id, 'business.create']);
    return biz;
  });
}

async function updateBusiness(slug, input, userId) {
  const biz = await getBySlug(slug);
  if (!biz) return null;
  const profile = Object.assign({}, biz.profile, pickProfile(input));
  const fields = {
    name: input.name !== undefined ? String(input.name).trim() || biz.name : biz.name,
    category: input.category !== undefined ? String(input.category) : biz.category,
    city: input.city !== undefined ? String(input.city) : biz.city,
    timezone: input.timezone !== undefined ? tzFromLabel(input.timezone) : biz.timezone,
    // A draft stays a draft until the wizard is finished. A normal update cannot invent draft status either.
    status: biz.status === 'draft' ? 'draft' : (['setup', 'live', 'paused'].includes(input.status) ? input.status : biz.status)
  };
  const { rows } = await db.query(
    `UPDATE businesses SET name = $2, category = $3, city = $4, timezone = $5, status = $6, profile = $7, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [biz.id, fields.name, fields.category, fields.city, fields.timezone, fields.status, profile]
  );
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
    [userId || null, biz.id, 'business.update', { keys: Object.keys(input || {}).slice(0, 40) }]);
  return rows[0];
}

async function createDraft(input, userId) {
  assertDraftIdentity(input);
  return createBusiness(input, userId, { status: 'draft', wizard: wizardFrom(input) });
}

async function updateDraft(biz, input, userId) {
  if (!biz || biz.status !== 'draft') {
    const e = new Error('Only a draft can be updated this way.');
    e.status = 409;
    throw e;
  }
  assertDraftIdentity(input);
  const wizard = wizardFrom(input);
  const profile = Object.assign({}, biz.profile || {}, pickProfile(input), { wizard, wizardStep: wizard.step });
  const { rows } = await db.query(
    `UPDATE businesses SET name = $2, category = $3, city = $4, timezone = $5, pilot = $6, profile = $7, status = 'draft', updated_at = now()
     WHERE id = $1 RETURNING *`,
    [biz.id, String(input.name).trim(), String(input.category).trim(),
      input.city !== undefined ? String(input.city) : biz.city,
      input.timezone !== undefined ? tzFromLabel(input.timezone) : biz.timezone,
      input.pilot !== undefined ? Boolean(input.pilot) : biz.pilot,
      profile]
  );
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
    [userId || null, biz.id, 'business.draft', { wizardStep: wizard.step }]);
  return rows[0];
}

async function finishDraft(biz, input, userId) {
  if (!biz || biz.status !== 'draft') {
    const e = new Error('Only a draft can be finished this way.');
    e.status = 409;
    throw e;
  }
  assertDraftIdentity(input);
  const incoming = wizardFrom(Object.assign({}, input, { wizardStep: 9 }));
  const wizard = Object.assign({}, (biz.profile && biz.profile.wizard) || {}, incoming);
  wizard.step = 9;
  const profile = Object.assign({}, biz.profile || {}, pickProfile(input), { wizard, wizardStep: 9 });
  return db.tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE businesses SET name = $2, category = $3, city = $4, timezone = $5, pilot = $6, profile = $7, status = 'setup', updated_at = now()
       WHERE id = $1 RETURNING *`,
      [biz.id, String(input.name).trim(), String(input.category).trim(),
        input.city !== undefined ? String(input.city) : biz.city,
        input.timezone !== undefined ? tzFromLabel(input.timezone) : biz.timezone,
        input.pilot !== undefined ? Boolean(input.pilot) : biz.pilot,
        profile]
    );
    await upsertSteps(c, biz.id, checklistFromClient(input));
    await c.query('INSERT INTO audit_log (user_id, business_id, action) VALUES ($1, $2, $3)', [userId || null, biz.id, 'business.draft.finish']);
    return rows[0];
  });
}

async function deleteDraft(biz, userId) {
  if (!biz || biz.status !== 'draft') {
    const e = new Error('Only a draft can be deleted.');
    e.status = 409;
    throw e;
  }
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
    [userId || null, biz.id, 'business.draft.delete', { slug: biz.slug, name: biz.name }]);
  await db.query('DELETE FROM businesses WHERE id = $1 AND status = \'draft\'', [biz.id]);
  return { ok: true };
}

async function getBySlug(slug) {
  const { rows } = await db.query('SELECT * FROM businesses WHERE slug = $1 AND status <> \'archived\'', [slug]);
  return rows[0] || null;
}

const TZ_LABELS = {
  'Eastern Time': 'America/New_York', 'Central Time': 'America/Chicago', 'Mountain Time': 'America/Denver',
  'Pacific Time': 'America/Los_Angeles', 'Arizona Time': 'America/Phoenix', 'Alaska Time': 'America/Anchorage', 'Hawaii Time': 'Pacific/Honolulu'
};
function tzFromLabel(v) {
  if (!v) return 'America/New_York';
  if (TZ_LABELS[v]) return TZ_LABELS[v];
  return /^[A-Za-z]+\/[A-Za-z_]+$/.test(v) ? v : 'America/New_York';
}
function tzLabel(tz) {
  for (const k of Object.keys(TZ_LABELS)) if (TZ_LABELS[k] === tz) return k;
  return tz;
}

function prettyPhone(e164) {
  const d = String(e164 || '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (ten.length !== 10) return e164 || '';
  return '(' + ten.slice(0, 3) + ') ' + ten.slice(3, 6) + '-' + ten.slice(6);
}

function fmtWhen(date, tz) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}
function fmtDuration(sec) {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function callToUi(c, tz) {
  const lines = (Array.isArray(c.messages) ? c.messages : [])
    .filter((m) => m && (m.role === 'assistant' || m.role === 'bot' || m.role === 'user') && (m.message || m.content))
    .map((m) => [m.role === 'user' ? 'Caller' : 'Receptionist', m.message || m.content]);
  const pretty = prettyPhone(c.direction === 'outbound' ? c.to_number : c.from_number);
  const from = c.caller_name ? (pretty ? c.caller_name + ' · ' + pretty : c.caller_name) : (pretty || 'Unknown');
  return {
    time: fmtWhen(c.started_at || c.created_at, tz),
    from,
    duration: fmtDuration(c.duration_sec),
    outcome: c.outcome || (c.status === 'ended' ? 'Answered' : (c.status || '')),
    flag: c.ended_reason && /error|fail/i.test(c.ended_reason) ? c.ended_reason : '',
    summary: c.summary || '',
    lines,
    recordingUrl: c.recording_url || ''
  };
}

// Full UI object for one business row.
async function toUi(biz) {
  const tz = biz.timezone || 'America/New_York';
  const [steps, phones, calls, bookings, stats, assistant] = await Promise.all([
    db.query('SELECT * FROM business_setup WHERE business_id = $1', [biz.id]),
    db.query('SELECT * FROM phone_numbers WHERE business_id = $1 AND status = \'active\' ORDER BY id DESC LIMIT 1', [biz.id]),
    db.query('SELECT * FROM calls WHERE business_id = $1 ORDER BY coalesce(started_at, created_at) DESC LIMIT 50', [biz.id]),
    db.query('SELECT * FROM bookings WHERE business_id = $1 ORDER BY starts_at DESC NULLS LAST LIMIT 50', [biz.id]),
    db.query(
      `SELECT
         coalesce(sum(duration_sec) FILTER (WHERE started_at >= date_trunc('month', now() AT TIME ZONE $2) AT TIME ZONE $2), 0)::int AS month_sec,
         count(*) FILTER (WHERE started_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS today
       FROM calls WHERE business_id = $1`, [biz.id, tz]),
    db.query('SELECT vapi_assistant_id FROM assistants WHERE business_id = $1', [biz.id])
  ]);
  const bookedToday = await db.query(
    `SELECT count(*)::int AS n FROM bookings WHERE business_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2`, [biz.id, tz]);
  const p = biz.profile || {};
  const byKey = {};
  steps.rows.forEach((r) => { byKey[r.step_key] = r; });
  const checklist = STEPS.map(([key, label]) => {
    const r = byKey[key];
    return { key, label, status: r ? r.status : 'pending', detail: r ? r.detail : 'Not started', owner: r ? r.owner : 'Team', next: r ? r.is_next : false };
  });
  const phone = Object.assign({ mode: 'forward', carrier: '', forwardType: 'missed', businessNumber: '', tests: [] }, p.phone || {});
  phone.aiNumber = phones.rows[0] ? prettyPhone(phones.rows[0].e164) : '';
  const assistantPublished = Boolean(assistant.rows[0] && assistant.rows[0].vapi_assistant_id);
  const testStep = byKey.test;
  const setupProgress = [
    { key: 'details', label: 'Details', done: Boolean(biz.name && biz.category), step: 0 },
    { key: 'receptionist', label: 'Receptionist published', done: assistantPublished, step: 5 },
    { key: 'number', label: 'Number bought', done: Boolean(phones.rows[0]), step: 2 },
    { key: 'test', label: 'Test call', done: Boolean(testStep && testStep.status === 'connected'), step: 3 }
  ];
  return Object.assign({
    owner: { name: '', mobile: '', email: '' },
    greeting: '', voice: '', languages: ['English'], transfer: '',
    capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
    services: [], faqs: [], reviews: [], posts: [], campaigns: [], activity: [],
    socialAccounts: { facebook: '', instagram: '', gbp: '' },
    tier: 'Small', plan: 'Growth', price: 0, minutesCap: 1000, staff: 1, locations: 1,
    card: '', nextInvoice: '', trial: '', address: '', website: '', hours: '', blurb: '', template: '',
    domainStatus: '', reviewLink: '', contacts: 0, suppressed: 0, setupFee: 0
  }, p, {
    id: biz.slug,
    dbId: Number(biz.id),
    name: biz.name,
    category: biz.category,
    city: biz.city,
    timezone: tzLabel(tz),
    status: biz.status === 'draft' ? 'draft' : (p.paused ? 'paused' : biz.status),
    pilot: biz.pilot,
    wizardStep: Number(p.wizardStep != null ? p.wizardStep : (p.wizard && p.wizard.step) || 0),
    wizard: p.wizard || null,
    setupProgress,
    assistantPublished,
    phone,
    texts: 0,
    minutesUsed: Math.round((stats.rows[0].month_sec || 0) / 60),
    callsToday: stats.rows[0].today,
    bookingsToday: bookedToday.rows[0].n,
    calls: calls.rows.map((c) => callToUi(c, tz)),
    bookings: bookings.rows.map((b) => ({
      when: fmtWhen(b.starts_at, tz), customer: b.customer || '', service: b.service || '', source: b.source, status: b.status
    })),
    checklist,
    live: true
  });
}

async function listUi() {
  const { rows } = await db.query('SELECT * FROM businesses WHERE status <> \'archived\' ORDER BY pilot DESC, created_at');
  return Promise.all(rows.map(toUi));
}

function defaultReceptionist(biz) {
  const p = (biz && biz.profile) || {};
  const name = (biz && biz.name) || 'the business';
  return {
    greeting: p.greeting || ('Thanks for calling ' + name + '. This call may be recorded. I can answer questions, book a time, or take a message.'),
    businessName: name,
    hours: p.hours || 'Mon–Fri 9:00 AM – 6:00 PM',
    timezone: (biz && biz.timezone) || 'America/New_York',
    appointmentMinutes: 20,
    bookableDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    bookableStart: '09:00',
    bookableEnd: '18:00',
    bufferMinutes: 0,
    transferNumber: typeof p.transfer === 'string' ? p.transfer : '',
    faqs: Array.isArray(p.faqs) ? p.faqs : [],
    notes: p.blurb || ''
  };
}

// Links the pilot to the known Vapi assistant and Twilio number. Does not call Vapi.
async function ensurePilotBindings(businessId) {
  const { rows } = await db.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  const biz = rows[0];
  if (!biz) return;
  if (!biz.receptionist || !Object.keys(biz.receptionist).length) {
    await db.query('UPDATE businesses SET receptionist = $2 WHERE id = $1', [businessId, JSON.stringify(defaultReceptionist(biz))]);
  }
  await db.query(
    `INSERT INTO assistants (business_id, vapi_assistant_id, config)
     VALUES ($1, $2, $3)
     ON CONFLICT (business_id) DO UPDATE SET
       vapi_assistant_id = coalesce(assistants.vapi_assistant_id, EXCLUDED.vapi_assistant_id),
       updated_at = now()`,
    [businessId, config.pilot.assistantId, JSON.stringify({ name: config.pilot.assistantName })]
  );
  await db.query(
    `INSERT INTO phone_numbers (business_id, e164, provider, vapi_phone_number_id, sms_enabled, status)
     VALUES ($1, $2, 'twilio', $3, FALSE, 'active')
     ON CONFLICT (e164) DO NOTHING`,
    [businessId, config.pilot.phoneE164, config.pilot.phoneNumberId]
  );
  const step = await db.query("SELECT status FROM business_setup WHERE business_id = $1 AND step_key = 'number'", [businessId]);
  if (!step.rows[0] || step.rows[0].status === 'pending') {
    await setStep(businessId, 'number', 'action',
      prettyPhone(config.pilot.phoneE164) + ' is on file. Connect Vapi to confirm it is attached to the receptionist.',
      { e164: config.pilot.phoneE164 });
  }
}

// Pilot client #1. ReceptWise, Malden, MA, linked to the known receptionist number.
async function seedPilot() {
  let biz = await getBySlug('receptwise');
  if (!biz) {
    biz = await createBusiness({
    name: 'ReceptWise',
    slug: 'receptwise',
    category: 'Professional services',
    city: 'Malden, MA',
    timezone: 'America/New_York',
    pilot: true,
    address: 'Malden, MA',
    website: '',
    hours: 'Mon–Fri 9:00 AM – 6:00 PM',
    tier: 'Small', plan: 'Growth', price: 0, minutesCap: 700, setupFee: 0, staff: 1, locations: 1,
    card: 'Pilot · no card charged', nextInvoice: 'Pilot · $0', trial: 'Pilot',
    owner: { name: '', mobile: '', email: '' },
    phone: { mode: 'forward', carrier: '', forwardType: 'missed', businessNumber: '', tests: [] },
    greeting: 'Thanks for calling ReceptWise. I\'m the virtual assistant, and this call may be recorded. I can explain what we do, book a free 20-minute demo, or connect you with the team.',
    voice: '', languages: ['English'], transfer: '',
    capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
    services: [{ name: 'Intro demo', length: '20 min', price: '$0' }],
    faqs: [
      { q: 'What does ReceptWise do?', a: 'We answer the phone, book appointments, follow up for Google reviews, post on social, and host a simple website for local businesses.' },
      { q: 'Can I keep my current number?', a: 'Yes. We forward it to the receptionist, or we can move it later if you want that.' }
    ],
    blurb: 'An AI front desk and marketing service for local businesses.',
    template: 'Professional services',
    domainStatus: 'Not connected yet.',
    activity: [{ time: 'Setup', text: 'Pilot business created on the live server.' }]
    }, null);
    console.log('Seeded pilot business: ReceptWise (Malden, MA)');
  }
  await ensurePilotBindings(biz.id);
}

module.exports = {
  STEPS, STEP_KEYS, slugify, createBusiness, updateBusiness, createDraft, updateDraft, finishDraft, deleteDraft,
  getBySlug, toUi, listUi, seedPilot,
  setStep, prettyPhone, callToUi, tzFromLabel, defaultReceptionist
};
